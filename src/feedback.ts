import { defaultThresholds, scoreSimilarity, type Confidence, type FeedbackPreferences, type MatchResult, type Thresholds } from './matching/matcher';

export type SuggestionFeedbackAction = 'useful' | 'wrong';

export type SuggestionFeedbackRecord = {
  timestamp: string;
  action: SuggestionFeedbackAction;
  question: string;
  /** The answer the extension proposed, including on a rejected suggestion. */
  answer: string;
  /** The user's replacement, captured only after typing over a text suggestion. */
  typedAnswer?: string;
  /** A different option the user selected instead of a dropdown suggestion. */
  replacementAnswer?: string;
  /** Key of the saved profile/answer entry used to produce the proposal. */
  answerKey?: string;
  fieldType: 'text' | 'choice' | 'yesno';
  /** Existing lexical similarity score; this is not a probability. */
  score?: number;
};

export type SuggestionFeedbackInput = Omit<SuggestionFeedbackRecord, 'timestamp'>;

const enabledKey = 'learningFeedbackEnabled';
const recordsKey = 'suggestionFeedback';
const maxRecords = 1000;

type FeedbackStorage = {
  storage: {
    local: {
      get(key: string | string[]): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
  };
};

function isSuggestionFeedbackRecord(value: unknown): value is SuggestionFeedbackRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SuggestionFeedbackRecord>;
  return typeof record.timestamp === 'string'
    && (record.action === 'useful' || record.action === 'wrong')
    && typeof record.question === 'string' && record.question.trim().length > 0
    && typeof record.answer === 'string' && record.answer.trim().length > 0
    && (record.typedAnswer === undefined || typeof record.typedAnswer === 'string')
    && (record.replacementAnswer === undefined || typeof record.replacementAnswer === 'string')
    && (record.answerKey === undefined || typeof record.answerKey === 'string')
    && (record.fieldType === 'text' || record.fieldType === 'choice' || record.fieldType === 'yesno')
    && (record.score === undefined || (typeof record.score === 'number' && Number.isFinite(record.score) && record.score >= 0 && record.score <= 1));
}

/** Turn only strongly related, same-kind feedback into candidate preferences. */
export function feedbackPreferences(
  query: string,
  fieldType: SuggestionFeedbackRecord['fieldType'],
  candidateKeys: Set<string>,
  records: unknown,
  thresholds: Thresholds = defaultThresholds,
): FeedbackPreferences {
  if (!Array.isArray(records) || !query.trim()) return {};
  const evidence = new Map<string, { useful: number; wrong: number; latest: number }>();
  for (const value of records) {
    if (!isSuggestionFeedbackRecord(value) || value.fieldType !== fieldType
      || !value.answerKey || !candidateKeys.has(value.answerKey)
      || scoreSimilarity(query, value.question) < thresholds.high) continue;
    const current = evidence.get(value.answerKey) ?? { useful: 0, wrong: 0, latest: 0 };
    current[value.action] += 1;
    current.latest = Math.max(current.latest, Date.parse(value.timestamp) || 0);
    evidence.set(value.answerKey, current);
  }

  const preferredKeys: string[] = [];
  const rejectedKeys: string[] = [];
  for (const [key, counts] of evidence) {
    if (counts.wrong > counts.useful) rejectedKeys.push(key);
    else if (counts.useful > counts.wrong) preferredKeys.push(key);
  }
  preferredKeys.sort((left, right) => (evidence.get(right)!.latest - evidence.get(left)!.latest));
  return { preferredKeys, rejectedKeys };
}

function confidenceForScore(score: number, thresholds: Thresholds): Confidence {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'none';
}

/** Move a candidate's personalized confidence score with every related feedback event. */
export function calibrateFeedbackConfidence(
  match: MatchResult,
  query: string,
  fieldType: SuggestionFeedbackRecord['fieldType'],
  records: unknown,
  thresholds: Thresholds = defaultThresholds,
): MatchResult {
  if (!match.bestKey || !Array.isArray(records)) return match;
  let useful = 0;
  let wrong = 0;
  for (const value of records) {
    if (!isSuggestionFeedbackRecord(value) || value.fieldType !== fieldType
      || scoreSimilarity(query, value.question) < thresholds.high) continue;
    if (value.action === 'useful') useful += 1;
    else wrong += 1;
  }
  if (useful + wrong === 0) return match;

  // A Beta(2, 2) prior makes each response matter while limiting its impact.
  const estimatedReliability = (useful + 2) / (useful + wrong + 4);
  const confidenceScore = Math.max(0, Math.min(1, match.bestScore + (estimatedReliability - 0.5) * 0.2));
  return { ...match, confidenceScore, confidence: confidenceForScore(confidenceScore, thresholds) };
}

/** Record explicit feedback only when the user has opted in. */
export async function saveSuggestionFeedback(
  record: SuggestionFeedbackInput,
): Promise<boolean> {
  const question = record.question.trim();
  const answer = record.answer.trim();
  const typedAnswer = record.typedAnswer?.trim();
  const replacementAnswer = record.replacementAnswer?.trim();
  if (!question || !answer || (record.typedAnswer !== undefined && !typedAnswer)
    || (typedAnswer && (record.action !== 'wrong' || record.fieldType !== 'text'))
    || (replacementAnswer && (record.action !== 'wrong' || record.fieldType === 'text'))
    || (record.score !== undefined && (!Number.isFinite(record.score) || record.score < 0 || record.score > 1))) return false;
  try {
    const api = (globalThis as typeof globalThis & { browser: FeedbackStorage }).browser;
    const stored = await api.storage.local.get([enabledKey, recordsKey]);
    if (stored[enabledKey] !== true) return false;
    const existing = Array.isArray(stored[recordsKey])
      ? stored[recordsKey].filter(isSuggestionFeedbackRecord)
      : [];
    const nextRecord: SuggestionFeedbackRecord = {
      timestamp: new Date().toISOString(),
      action: record.action,
      question,
      answer,
      typedAnswer: typedAnswer || undefined,
      replacementAnswer: replacementAnswer || undefined,
      answerKey: record.answerKey?.trim() || undefined,
      fieldType: record.fieldType,
      score: record.score,
    };
    const next = [...existing, nextRecord].slice(-maxRecords);
    await api.storage.local.set({ [recordsKey]: next });
    return true;
  } catch {
    return false;
  }
}

