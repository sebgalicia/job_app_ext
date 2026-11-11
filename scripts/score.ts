import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { validateAnswers } from '../src/validation';
import { defaultThresholds, matchQuestion, type MatchCandidate } from '../src/matching/matcher';
import { chooseFactOption, detectPolarity, type ChoiceOption } from '../src/matching/polarity';
import { chooseSavedAnswerOption, chooseYesNoOption } from '../src/preview/text-preview';
import { answerEntryKey, resolveTopicFact } from '../src/matching/topics';

type AnswerEntry = { id?: string; questions: string[]; type: 'text' | 'choice' | 'yesno'; answer: string | boolean };
type AnswersFile = { facts?: Record<string, string | number | boolean>; answers?: AnswerEntry[] };
type InputRow = Record<string, string> & { question?: string; options?: string; expected_key?: string; expected_value?: string };
type OutputRow = Record<string, string>;

const outputColumns = [
  'question', 'best_key', 'best_score', 'second_key', 'second_score', 'confidence',
  'detected_topic', 'polarity_flips', 'resolved_key', 'chosen_option',
];

export function scoreQuestions(answers: AnswersFile, rows: InputRow[], expectedColumns: string[]): OutputRow[] {
  // Mirror the extension: blank answers never compete for a match.
  const entries = (answers.answers ?? []).filter((entry) => typeof entry.answer === 'boolean' || entry.answer.trim());
  const keyOf = (entry: AnswerEntry) => answerEntryKey(entry, (answers.answers ?? []).indexOf(entry));
  const allCandidates: MatchCandidate[] = entries.map((entry) => ({ key: keyOf(entry), questions: entry.questions }));
  const choiceCandidates = entries.flatMap((entry) =>
    entry.type === 'choice' || entry.type === 'yesno'
      ? [{ key: keyOf(entry), questions: entry.questions }]
      : [],
  );
  const entryByKey = new Map(entries.map((entry) => [keyOf(entry), entry]));

  return rows.map((row) => {
    const question = row.question?.trim() ?? '';
    const match = matchQuestion(question, allCandidates, defaultThresholds);
    const choiceMatch = matchQuestion(question, choiceCandidates, defaultThresholds);
    const matchedChoice = choiceMatch.confidence === 'none' ? undefined : entryByKey.get(choiceMatch.bestKey ?? '');
    const polarity = detectPolarity(question);
    const topicFact = resolveTopicFact(question, answers);
    const booleanAnswer = topicFact?.value ?? (typeof matchedChoice?.answer === 'boolean' ? matchedChoice.answer : undefined);
    const resolvedKey = topicFact?.source
      ?? (matchedChoice ? choiceMatch.bestKey : match.confidence === 'none' ? undefined : match.bestKey) ?? '';
    const options: ChoiceOption[] = (row.options ?? '').split('|').map((label) => label.trim()).filter(Boolean).map((label) => ({ label }));
    let chosenOption = '';

    if (options.length && booleanAnswer !== undefined) {
      chosenOption = (topicFact
        ? chooseFactOption(question, options, booleanAnswer)
        : chooseYesNoOption(options, booleanAnswer))?.label ?? '';
    } else if (options.length && typeof matchedChoice?.answer === 'string') {
      chosenOption = chooseSavedAnswerOption(
        matchedChoice.answer,
        options,
        choiceMatch.bestScore,
        choiceMatch.secondScore,
      )?.label ?? '';
    }

    const output: OutputRow = {
      question,
      best_key: match.bestKey ?? '',
      best_score: match.bestScore.toFixed(4),
      second_key: match.secondKey ?? '',
      second_score: match.secondScore.toFixed(4),
      confidence: match.confidence,
      detected_topic: polarity.topic ?? '',
      polarity_flips: String(polarity.flips),
      resolved_key: resolvedKey,
      chosen_option: chosenOption,
    };
    for (const column of expectedColumns) output[column] = row[column] ?? '';
    return output;
  });
}

export type ScoreSummary = { labeled: number; correct: number; wrong: number; abstained: number; wrongRows: OutputRow[] };

/**
 * Summarize rows that carry an expected_key. "none" means the extension should abstain.
 * A row is correct when the resolved answer key matches and, if given, the chosen option matches.
 */
export function summarizeScores(rows: OutputRow[]): ScoreSummary {
  const summary: ScoreSummary = { labeled: 0, correct: 0, wrong: 0, abstained: 0, wrongRows: [] };
  for (const row of rows) {
    const expected = row.expected_key?.trim();
    if (!expected) continue;
    summary.labeled += 1;
    const resolved = row.resolved_key ?? '';
    if (expected === 'none') {
      if (resolved) { summary.wrong += 1; summary.wrongRows.push(row); } else summary.correct += 1;
      continue;
    }
    const valueOk = !row.expected_value || row.chosen_option === row.expected_value;
    if (!resolved || (resolved === expected && row.options && !row.chosen_option)) summary.abstained += 1;
    else if (resolved === expected && valueOk) summary.correct += 1;
    else { summary.wrong += 1; summary.wrongRows.push(row); }
  }
  return summary;
}

function parseArguments(args: string[]): { answersPath: string; inputPath: string; outputPath: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!['--answers', '--input', '--out'].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const answersPath = values.get('--answers');
  const inputPath = values.get('--input');
  const outputPath = values.get('--out');
  if (!answersPath || !inputPath || !outputPath) {
    throw new Error('Usage: npm run score -- --answers answers.json --input examples/questions.csv --out results.csv');
  }
  return { answersPath, inputPath, outputPath };
}

async function main(): Promise<void> {
  const { answersPath, inputPath, outputPath } = parseArguments(process.argv.slice(2));
  const rawAnswers: unknown = JSON.parse(await readFile(resolve(answersPath), 'utf8').then((text) => text.replace(/^\uFEFF/, '')));
  const validation = validateAnswers(rawAnswers);
  if (!validation.valid) throw new Error(`Invalid answers file:\n${validation.errors.join('\n')}`);
  const answers = rawAnswers as AnswersFile;
  const parsed = Papa.parse<InputRow>(await readFile(resolve(inputPath), 'utf8'), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) throw new Error(`Could not parse questions CSV: ${parsed.errors.map((error) => error.message).join('; ')}`);
  if (!parsed.meta.fields?.includes('question')) throw new Error('Questions CSV must include a "question" column.');
  const expectedColumns = ['expected_key', 'expected_value'].filter((column) => parsed.meta.fields?.includes(column));
  const rows = scoreQuestions(answers, parsed.data, expectedColumns);
  const columns = [...outputColumns, ...expectedColumns];
  const csv = Papa.unparse({ fields: columns, data: rows.map((row) => columns.map((column) => row[column] ?? '')) });
  await writeFile(resolve(outputPath), `${csv}\n`, 'utf8');
  console.log(`Scored ${rows.length} questions. Results saved to ${resolve(outputPath)}.`);
  const summary = summarizeScores(rows);
  if (summary.labeled > 0) {
    console.log(`Labeled: ${summary.labeled}  correct: ${summary.correct}  wrong: ${summary.wrong}  abstained: ${summary.abstained}`);
    for (const row of summary.wrongRows) {
      console.log(`  WRONG  ${row.question}  -> ${row.resolved_key || '(no answer)'} ${row.chosen_option}  expected ${row.expected_key} ${row.expected_value ?? ''}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
