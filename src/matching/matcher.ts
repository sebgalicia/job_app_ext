import { normalizeText } from './normalize';

export type MatchCandidate = { key: string; questions: string[] };
export type Confidence = 'high' | 'medium' | 'none';
export type MatchResult = {
  bestKey?: string;
  bestScore: number;
  secondKey?: string;
  secondScore: number;
  confidence: Confidence;
  /** Feedback-adjusted confidence score; bestScore remains the baseline lexical score. */
  confidenceScore?: number;
};

export type Thresholds = { high: number; medium: number };
export type FeedbackPreferences = { preferredKeys?: string[]; rejectedKeys?: string[] };
export const defaultThresholds: Thresholds = { high: 0.72, medium: 0.5 };

export function validThresholds(value: unknown): Thresholds {
  if (!value || typeof value !== 'object') return defaultThresholds;
  const candidate = value as Partial<Thresholds>;
  if (typeof candidate.high !== 'number' || typeof candidate.medium !== 'number'
    || !Number.isFinite(candidate.high) || !Number.isFinite(candidate.medium)
    || candidate.high < 0.51 || candidate.high > 0.95
    || candidate.medium < 0.3 || candidate.medium > 0.94
    || candidate.medium >= candidate.high) {
    return defaultThresholds;
  }
  return { high: candidate.high, medium: candidate.medium };
}

function cosine(left: string[], right: string[], idf: Map<string, number>): number {
  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  for (const token of left) leftCounts.set(token, (leftCounts.get(token) ?? 0) + 1);
  for (const token of right) rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  const weight = (token: string, count: number) => count * (idf.get(token) ?? 1);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [token, count] of leftCounts) {
    const value = weight(token, count);
    leftNorm += value * value;
    dot += value * weight(token, rightCounts.get(token) ?? 0);
  }
  for (const [token, count] of rightCounts) {
    const value = weight(token, count);
    rightNorm += value * value;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function overlap(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value}  `;
  return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3)));
}

function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  const intersection = [...a].filter((gram) => b.has(gram)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function scoreSimilarity(query: string, candidate: string, corpus: string[] = [candidate]): number {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  if (normalizedQuery.length === 0 || normalizedCandidate.length === 0) return 0;

  const documents = corpus.map(normalizeText);
  const documentFrequency = new Map<string, number>();
  for (const doc of documents) {
    for (const token of new Set(doc)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const idf = new Map([...documentFrequency].map(([token, df]) => [token, Math.log(1 + documents.length / (1 + df)) + 1]));
  const cosineScore = cosine(normalizedQuery, normalizedCandidate, idf);
  const overlapScore = overlap(normalizedQuery, normalizedCandidate);
  const trigramScore = trigramSimilarity(normalizedQuery.join(' '), normalizedCandidate.join(' '));
  return 0.5 * cosineScore + 0.25 * overlapScore + 0.25 * trigramScore;
}

function confidenceFor(score: number, thresholds: Thresholds): Confidence {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'none';
}

/** Find the strongest wording match, preserving a runner-up score for evaluation. */
export function matchQuestion(
  query: string,
  candidates: MatchCandidate[],
  thresholds: Thresholds = defaultThresholds,
): MatchResult {
  return matchQuestionWithFeedback(query, candidates, thresholds);
}

/** Apply local feedback as a retrieval preference without changing lexical candidate scores. */
export function matchQuestionWithFeedback(
  query: string,
  candidates: MatchCandidate[],
  thresholds: Thresholds = defaultThresholds,
  preferences: FeedbackPreferences = {},
): MatchResult {
  const corpus = candidates.flatMap((candidate) => candidate.questions);
  const rejected = new Set(preferences.rejectedKeys ?? []);
  const scores = candidates
    .filter((candidate) => !rejected.has(candidate.key))
    .map((candidate) => ({
      key: candidate.key,
      score: Math.max(0, ...candidate.questions.map((wording) => scoreSimilarity(query, wording, corpus))),
    }));
  scores.sort((a, b) => b.score - a.score);
  const initialBest = scores[0];
  if (initialBest) {
    const preferred = new Set(preferences.preferredKeys ?? []);
    const preferredInRange = scores
      .filter((candidate) => preferred.has(candidate.key) && candidate.score >= initialBest.score - 0.08)
      .sort((a, b) => (preferences.preferredKeys ?? []).indexOf(a.key) - (preferences.preferredKeys ?? []).indexOf(b.key)
        || b.score - a.score)[0];
    if (preferredInRange) {
      scores.splice(scores.indexOf(preferredInRange), 1);
      scores.unshift(preferredInRange);
    }
  }
  const best = scores[0];
  const second = scores[1];
  const bestScore = best?.score ?? 0;
  return {
    bestKey: best?.key,
    bestScore,
    secondKey: second?.key,
    secondScore: second?.score ?? 0,
    confidence: confidenceFor(bestScore, thresholds),
  };
}
