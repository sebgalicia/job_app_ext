import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { validateAnswers } from '../src/validation';
import { defaultThresholds, matchQuestion, type MatchCandidate } from '../src/matching/matcher';
import { chooseFactOption, detectPolarity, type ChoiceOption } from '../src/matching/polarity';
import { chooseSavedAnswerOption } from '../src/preview/text-preview';

type AnswerEntry = { questions: string[]; type: 'text' | 'choice' | 'yesno'; answer: string | boolean };
type AnswersFile = { facts?: Record<string, string | number | boolean>; answers?: AnswerEntry[] };
type InputRow = Record<string, string> & { question?: string; options?: string; expected_key?: string; expected_value?: string };
type OutputRow = Record<string, string>;

const outputColumns = [
  'question', 'best_key', 'best_score', 'second_key', 'second_score', 'confidence',
  'detected_topic', 'polarity_flips', 'chosen_option',
];

export function scoreQuestions(answers: AnswersFile, rows: InputRow[], expectedColumns: string[]): OutputRow[] {
  const entries = answers.answers ?? [];
  const allCandidates: MatchCandidate[] = entries.map((entry, index) => ({ key: `answers[${index}]`, questions: entry.questions }));
  const choiceCandidates = entries.flatMap((entry, index) =>
    entry.type === 'choice' || entry.type === 'yesno'
      ? [{ key: `answers[${index}]`, questions: entry.questions }]
      : [],
  );
  const entryByKey = new Map(entries.map((entry, index) => [`answers[${index}]`, entry]));

  return rows.map((row) => {
    const question = row.question?.trim() ?? '';
    const match = matchQuestion(question, allCandidates, defaultThresholds);
    const choiceMatch = matchQuestion(question, choiceCandidates, defaultThresholds);
    const matchedChoice = choiceMatch.confidence === 'none' ? undefined : entryByKey.get(choiceMatch.bestKey ?? '');
    const polarity = detectPolarity(question);
    const topicValue = polarity.topic ? answers.facts?.[polarity.topic] : undefined;
    const booleanAnswer = matchedChoice?.type === 'yesno' && typeof matchedChoice.answer === 'boolean'
      ? matchedChoice.answer
      : typeof topicValue === 'boolean' ? topicValue : undefined;
    const options: ChoiceOption[] = (row.options ?? '').split('|').map((label) => label.trim()).filter(Boolean).map((label) => ({ label }));
    let chosenOption = '';

    if (options.length && booleanAnswer !== undefined) {
      chosenOption = chooseFactOption(question, options, booleanAnswer)?.label ?? '';
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
      chosen_option: chosenOption,
    };
    for (const column of expectedColumns) output[column] = row[column] ?? '';
    return output;
  });
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
    throw new Error('Usage: npm run score -- --answers answers.json --input questions.csv --out results.csv');
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
