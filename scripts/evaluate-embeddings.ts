import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { pipeline } from '@huggingface/transformers';
import { validateAnswers } from '../src/validation';
import { defaultThresholds, matchQuestion } from '../src/matching/matcher';

const modelId = 'Xenova/all-MiniLM-L6-v2';
type AnswerEntry = { questions: string[] };
type AnswersFile = { answers?: AnswerEntry[] };
type QuestionRow = { question?: string; expected_key?: string; [column: string]: string | undefined };
type EvaluationRow = Record<string, string>;

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
    throw new Error('Usage: npm run evaluate:embeddings -- --answers answers.json --input questions.csv --out embedding-results.csv');
  }
  return { answersPath, inputPath, outputPath };
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0;
  for (const item of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const itemPath = resolve(path, item.name);
    if (item.isDirectory()) total += await directoryBytes(itemPath);
    else total += (await stat(itemPath)).size;
  }
  return total;
}

async function main(): Promise<void> {
  const { answersPath, inputPath, outputPath } = parseArguments(process.argv.slice(2));
  const rawAnswers: unknown = JSON.parse(await readFile(resolve(answersPath), 'utf8').then((text) => text.replace(/^\uFEFF/, '')));
  const validation = validateAnswers(rawAnswers);
  if (!validation.valid) throw new Error(`Invalid answers file:\n${validation.errors.join('\n')}`);
  const answers = rawAnswers as AnswersFile;
  const entries = answers.answers ?? [];
  const parsed = Papa.parse<QuestionRow>(await readFile(resolve(inputPath), 'utf8'), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) throw new Error(`Could not parse questions CSV: ${parsed.errors.map((error) => error.message).join('; ')}`);
  if (!parsed.meta.fields?.includes('question')) throw new Error('Questions CSV must include a "question" column.');
  if (!parsed.meta.fields.includes('expected_key')) throw new Error('Evaluation CSV must include an "expected_key" column.');
  const rows = parsed.data.filter((row) => row.question?.trim());
  const labeledRows = rows.filter((row) => row.expected_key?.trim());
  if (!labeledRows.length) throw new Error('Evaluation CSV needs at least one labeled row with an expected_key.');

  const wordingByKey = new Map(entries.map((entry, index) => [`answers[${index}]`, entry.questions]));
  const texts = [...new Set([
    ...rows.map((row) => row.question!.trim()),
    ...entries.flatMap((entry) => entry.questions.map((wording) => wording.trim())),
  ].filter(Boolean))];
  const cacheDir = resolve(tmpdir(), 'job-autofill-embedding-eval-cache');
  const memoryBefore = process.memoryUsage().rss;
  const loadStarted = performance.now();
  const extractor = await pipeline('feature-extraction', modelId, {
    device: 'cpu',
    dtype: 'int8',
    cache_dir: cacheDir,
  });
  const loadMs = performance.now() - loadStarted;
  const inferenceStarted = performance.now();
  const tensor = await extractor(texts, { pooling: 'mean', normalize: true });
  const inferenceMs = performance.now() - inferenceStarted;
  const vectors = tensor.tolist() as number[][];
  await extractor.dispose();
  const embeddingByText = new Map(texts.map((text, index) => [text, vectors[index]]));

  const evaluation: EvaluationRow[] = rows.map((row) => {
    const question = row.question!.trim();
    const query = embeddingByText.get(question)!;
    const ranked = [...wordingByKey.entries()].map(([key, wordings]) => ({
      key,
      score: Math.max(0, ...wordings.map((wording) => dot(query, embeddingByText.get(wording.trim())!))),
    })).sort((left, right) => right.score - left.score);
    const modelBest = ranked[0];
    const modelSecond = ranked[1];
    const rules = matchQuestion(question, entries.map((entry, index) => ({ key: `answers[${index}]`, questions: entry.questions })), defaultThresholds);
    const expectedKey = row.expected_key?.trim() ?? '';
    const result: EvaluationRow = {
      question,
      expected_key: expectedKey,
      model_best_key: modelBest?.key ?? '',
      model_best_score: (modelBest?.score ?? 0).toFixed(4),
      model_second_key: modelSecond?.key ?? '',
      model_second_score: (modelSecond?.score ?? 0).toFixed(4),
      model_correct: expectedKey ? String(modelBest?.key === expectedKey) : '',
      rules_best_key: rules.bestKey ?? '',
      rules_best_score: rules.bestScore.toFixed(4),
      rules_correct: expectedKey ? String(rules.bestKey === expectedKey) : '',
    };
    return result;
  });

  const columns = [
    'question', 'expected_key', 'model_best_key', 'model_best_score', 'model_second_key', 'model_second_score',
    'model_correct', 'rules_best_key', 'rules_best_score', 'rules_correct',
  ];
  const csv = Papa.unparse({ fields: columns, data: evaluation.map((row) => columns.map((column) => row[column] ?? '')) });
  await writeFile(resolve(outputPath), `${csv}\n`, 'utf8');

  const labeledResults = evaluation.filter((row) => row.expected_key);
  const modelCorrect = labeledResults.filter((row) => row.model_correct === 'true').length;
  const rulesCorrect = labeledResults.filter((row) => row.rules_correct === 'true').length;
  const modelTopTwo = labeledResults.filter((row) => row.model_best_key === row.expected_key || row.model_second_key === row.expected_key).length;
  const modelAccuracy = modelCorrect / labeledResults.length;
  const rulesAccuracy = rulesCorrect / labeledResults.length;
  console.log(`Model: ${modelId} (int8, CPU)`);
  console.log(`Rows: ${rows.length} total, ${labeledResults.length} labeled, ${rows.length - labeledResults.length} unlabeled`);
  console.log(`Top-1 accuracy: embeddings ${(100 * modelAccuracy).toFixed(1)}% (${modelCorrect}/${labeledResults.length}); rules ${(100 * rulesAccuracy).toFixed(1)}% (${rulesCorrect}/${labeledResults.length})`);
  console.log(`Embedding top-2 accuracy: ${(100 * modelTopTwo / labeledResults.length).toFixed(1)}% (${modelTopTwo}/${labeledResults.length})`);
  console.log(`Timing: model load ${(loadMs / 1000).toFixed(1)}s; embed ${texts.length} unique strings in ${(inferenceMs / 1000).toFixed(2)}s`);
  console.log(`Process RSS: ${(memoryBefore / 1024 / 1024).toFixed(1)} MB before; ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB after model disposal (Node estimate, not Firefox memory)`);
  console.log(`Cached model and support files: ${(await directoryBytes(cacheDir) / 1024 / 1024).toFixed(1)} MB at ${cacheDir}`);
  console.log(`Detailed results: ${resolve(outputPath)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
