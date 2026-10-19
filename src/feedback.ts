export type SuggestionFeedbackAction = 'useful' | 'wrong';

export type SuggestionFeedbackRecord = {
  timestamp: string;
  action: SuggestionFeedbackAction;
  question: string;
  answer: string;
  typedAnswer?: string;
  answerKey?: string;
  fieldType: 'text' | 'choice' | 'yesno';
  score?: number;
};

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

/** Record explicit feedback only when the user has opted in. This never changes matching. */
export async function saveSuggestionFeedback(
  record: Omit<SuggestionFeedbackRecord, 'timestamp'>,
): Promise<boolean> {
  try {
    const api = (globalThis as typeof globalThis & { browser: FeedbackStorage }).browser;
    const stored = await api.storage.local.get([enabledKey, recordsKey]);
    if (stored[enabledKey] !== true) return false;
    const existing = Array.isArray(stored[recordsKey])
      ? stored[recordsKey] as SuggestionFeedbackRecord[]
      : [];
    const next = [...existing, { ...record, timestamp: new Date().toISOString() }].slice(-maxRecords);
    await api.storage.local.set({ [recordsKey]: next });
    return true;
  } catch {
    return false;
  }
}
