import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { validateAnswers } from '../src/validation';
import {
  defaultThresholds,
  matchQuestion,
  matchQuestionWithFeedback,
  type MatchCandidate,
  type MatchResult,
} from '../src/matching/matcher';
import { calibrateFeedbackConfidence, feedbackPreferences, type SuggestionFeedbackRecord } from '../src/feedback';
import { chooseFactOption } from '../src/matching/polarity';
import {
  chooseSavedAnswerOption,
  makeCandidates,
  profileCandidates,
  workHistoryCandidates,
  type StoredAnswers,
  type StoredJobHistory,
} from '../src/preview/text-preview';

type AnswerEntry = NonNullable<StoredAnswers['answers']>[number];
type WorkHistoryFile = { jobs?: StoredJobHistory[] };
type InputRow = Record<string, string> & {
  question?: string;
  options?: string;
  field_type?: string;
  expected_key?: string;
  expected_value?: string;
};
type ResultRow = Record<string, string>;

const resultColumns = [
  'question', 'field_type', 'expected_key',
  'baseline_key', 'baseline_score', 'baseline_confidence_score', 'baseline_confidence', 'baseline_option',
  'adapted_key', 'adapted_score', 'adapted_confidence_score', 'adapted_confidence', 'adapted_option',
  'baseline_correct', 'adapted_correct', 'expected_value',
];

function parseFeedback(value: unknown): SuggestionFeedbackRecord[] {
  const records = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { records?: unknown }).records)
      ? (value as { records: unknown[] }).records
      : undefined;
  if (!records) throw new Error('Feedback JSON must be an array or an exported object containing a records array.');
  return records as SuggestionFeedbackRecord[];
}

function match(
  question: string,
  candidates: MatchCandidate[],
  feedback: SuggestionFeedbackRecord[],
  fieldType: 'text' | 'choice' | 'yesno',
  adapted: boolean,
): MatchResult {
  if (!adapted) return matchQuestion(question, candidates, defaultThresholds);
  const preferences = feedbackPreferences(question, fieldType, new Set(candidates.map(({ key }) => key)), feedback);
  const result = matchQuestionWithFeedback(question, candidates, defaultThresholds, preferences);
  return calibrateFeedbackConfidence(result, question, fieldType, feedback);
}

function selectedOption(
  result: MatchResult,
  answersByKey: Map<string, string | number | boolean>,
  options: string[],
  question: string,
  profileAlternates?: StoredAnswers['profileAlternates'],
): string {
  const answer = answersByKey.get(result.bestKey ?? '');
  const choiceOptions = options.map((label) => ({ label }));
  if (answer === undefined || options.length === 0 || result.confidence === 'none') return '';
  if (typeof answer === 'boolean') return chooseFactOption(question, choiceOptions, answer)?.label ?? '';
  const profileKey = result.bestKey?.startsWith('profile.') ? result.bestKey.slice('profile.'.length) : undefined;
  return chooseSavedAnswerOption(
    String(answer), choiceOptions, result.bestScore, result.secondScore,
    profileKey ? profileAlternates?.[profileKey] ?? [] : [],
  )?.label ?? '';
}

function correct(result: MatchResult, expectedKey: string): string {
  if (!expectedKey) return '';
  return result.confidence !== 'none' && result.bestKey === expectedKey ? 'true' : 'false';
}

export function compareFeedback(
  answers: StoredAnswers,
  rows: InputRow[],
  feedback: SuggestionFeedbackRecord[],
  history: StoredJobHistory[] = [],
): { rows: ResultRow[]; metrics: { labeled: number; baselineCorrect: number; adaptedCorrect: number; baselineAbstentions: number; adaptedAbstentions: number; changed: number } } {
  const entries = answers.answers ?? [];
  const shared = makeCandidates(answers, {}, history);
  const allCandidates = shared.candidates;
  const choiceCandidates: MatchCandidate[] = [
    ...profileCandidates(answers.profile, answers.profileQuestions),
    ...workHistoryCandidates(history),
    ...entries.flatMap((entry, index) => entry.type === 'choice' || entry.type === 'yesno'
      ? [{ key: `answers[${index}]`, questions: entry.questions }]
      : []),
  ];
  const answersByKey = new Map<string, string | number | boolean>(shared.answerByKey);
  entries.forEach((entry, index) => answersByKey.set(`answers[${index}]`, entry.answer));
  let labeled = 0;
  let baselineCorrect = 0;
  let adaptedCorrect = 0;
  let baselineAbstentions = 0;
  let adaptedAbstentions = 0;
  let changed = 0;

  const resultRows = rows.map((row): ResultRow => {
    const question = row.question?.trim() ?? '';
    const options = (row.options ?? '').split('|').map((option) => option.trim()).filter(Boolean);
    // Yes/no controls are recorded by the extension as choice feedback.
    const fieldType: 'text' | 'choice' = row.field_type === 'choice' || row.field_type === 'yesno' || options.length > 0
      ? 'choice'
      : 'text';
    const candidates = fieldType === 'text' ? allCandidates : choiceCandidates;
    const baseline = match(question, candidates, feedback, fieldType, false);
    const adapted = match(question, candidates, feedback, fieldType, true);
    const expectedKey = row.expected_key?.trim() ?? '';
    const baselineIsCorrect = correct(baseline, expectedKey) === 'true';
    const adaptedIsCorrect = correct(adapted, expectedKey) === 'true';
    if (expectedKey) {
      labeled += 1;
      if (baselineIsCorrect) baselineCorrect += 1;
      if (adaptedIsCorrect) adaptedCorrect += 1;
      if (baseline.confidence === 'none') baselineAbstentions += 1;
      if (adapted.confidence === 'none') adaptedAbstentions += 1;
    }
    if (baseline.bestKey !== adapted.bestKey || baseline.confidence !== adapted.confidence) changed += 1;

    return {
      question,
      field_type: fieldType,
      expected_key: expectedKey,
      baseline_key: baseline.bestKey ?? '',
      baseline_score: baseline.bestScore.toFixed(4),
      baseline_confidence_score: baseline.bestScore.toFixed(4),
      baseline_confidence: baseline.confidence,
      baseline_option: selectedOption(baseline, answersByKey, options, question, answers.profileAlternates),
      adapted_key: adapted.bestKey ?? '',
      adapted_score: adapted.bestScore.toFixed(4),
      adapted_confidence_score: (adapted.confidenceScore ?? adapted.bestScore).toFixed(4),
      adapted_confidence: adapted.confidence,
      adapted_option: selectedOption(adapted, answersByKey, options, question, answers.profileAlternates),
      baseline_correct: correct(baseline, expectedKey),
      adapted_correct: correct(adapted, expectedKey),
      expected_value: row.expected_value ?? '',
    };
  });

  return { rows: resultRows, metrics: { labeled, baselineCorrect, adaptedCorrect, baselineAbstentions, adaptedAbstentions, changed } };
}

function parseArguments(args: string[]): { answers: string; input: string; feedback: string; output: string; workHistory?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--answers', '--input', '--feedback', '--out', '--work-history'].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const answers = values.get('--answers');
  const input = values.get('--input');
  const feedback = values.get('--feedback');
  const output = values.get('--out');
  if (!answers || !input || !feedback || !output) {
    throw new Error('Usage: npm run compare:feedback -- --answers answers.private.json --input my-labeled-questions.csv --feedback job-autofill-feedback.json --out feedback-comparison.csv [--work-history work-history.private.json]');
  }
  return { answers, input, feedback, output, workHistory: values.get('--work-history') };
}

async function main(): Promise<void> {
  const paths = parseArguments(process.argv.slice(2));
  const rawAnswers: unknown = JSON.parse(await readFile(resolve(paths.answers), 'utf8').then((text) => text.replace(/^\uFEFF/, '')));
  const validation = validateAnswers(rawAnswers);
  if (!validation.valid) throw new Error(`Invalid answers file:\n${validation.errors.join('\n')}`);
  const rawFeedback: unknown = JSON.parse(await readFile(resolve(paths.feedback), 'utf8').then((text) => text.replace(/^\uFEFF/, '')));
  const feedback = parseFeedback(rawFeedback);
  const history = paths.workHistory
    ? (JSON.parse(await readFile(resolve(paths.workHistory), 'utf8').then((text) => text.replace(/^\uFEFF/, ''))) as WorkHistoryFile).jobs ?? []
    : [];
  const parsed = Papa.parse<InputRow>(await readFile(resolve(paths.input), 'utf8'), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) throw new Error(`Could not parse questions CSV: ${parsed.errors.map((error) => error.message).join('; ')}`);
  if (!parsed.meta.fields?.includes('question')) throw new Error('Questions CSV must include a "question" column.');

  const comparison = compareFeedback(rawAnswers as StoredAnswers, parsed.data, feedback, history);
  const csv = Papa.unparse({ fields: resultColumns, data: comparison.rows.map((row) => resultColumns.map((column) => row[column] ?? '')) });
  await writeFile(resolve(paths.output), `${csv}\n`, 'utf8');
  const { labeled, baselineCorrect, adaptedCorrect, baselineAbstentions, adaptedAbstentions, changed } = comparison.metrics;
  const percent = (value: number) => labeled ? `${(100 * value / labeled).toFixed(1)}%` : 'n/a';
  console.log(`Compared ${labeled} labeled questions using ${feedback.length} local feedback records.`);
  console.log(`Correct suggestions: baseline ${baselineCorrect}/${labeled} (${percent(baselineCorrect)}); adapted ${adaptedCorrect}/${labeled} (${percent(adaptedCorrect)}).`);
  console.log(`Abstentions: baseline ${baselineAbstentions}/${labeled}; adapted ${adaptedAbstentions}/${labeled}. Changed result or confidence: ${changed}.`);
  console.log(`Detailed comparison saved to ${resolve(paths.output)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
