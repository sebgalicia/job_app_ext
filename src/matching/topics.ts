import { detectPolarity, type Topic } from './polarity';

type TopicAnswerEntry = { id?: string; questions: string[]; type: 'text' | 'choice' | 'yesno'; answer: string | boolean };
export type TopicAnswers = {
  facts?: Record<string, string | number | boolean | undefined>;
  answers?: TopicAnswerEntry[];
};
export type TopicFact = { topic: Topic; value: boolean; source: string };

/** Stable label for an answers entry: its optional id, otherwise its position. */
export function answerEntryKey(entry: { id?: string }, index: number): string {
  return entry.id?.trim() ? entry.id.trim() : `answers[${index}]`;
}

function booleanAnswer(answer: string | boolean): boolean | undefined {
  if (typeof answer === 'boolean') return answer;
  if (/^\s*(?:yes|true)\s*$/i.test(answer)) return true;
  if (/^\s*(?:no|false)\s*$/i.test(answer)) return false;
  return undefined;
}

/**
 * Resolve a yes/no question by its detected topic instead of by wording similarity.
 *
 * `facts[topic]` wins. Otherwise every filled yes/no-style answer whose own wording
 * has the same topic contributes its value, corrected for negation in that wording
 * ("I will not need sponsorship" + true means needsSponsorship = false). Conflicting
 * answers or ambiguous wording return undefined so the caller can abstain.
 */
export function resolveTopicFact(question: string, answers: TopicAnswers): TopicFact | undefined {
  const polarity = detectPolarity(question);
  if (!polarity.topic || polarity.ambiguous) return undefined;
  const topic = polarity.topic;

  const fact = answers.facts?.[topic];
  if (typeof fact === 'boolean') return { topic, value: fact, source: `facts.${topic}` };

  const found: Array<{ value: boolean; source: string }> = [];
  for (const [index, entry] of (answers.answers ?? []).entries()) {
    if (entry.type === 'text') continue;
    const value = booleanAnswer(entry.answer);
    if (value === undefined) continue;
    const wording = entry.questions
      .map((text) => detectPolarity(text))
      .find((result) => result.topic === topic && !result.ambiguous);
    if (!wording) continue;
    found.push({ value: value !== (wording.flips % 2 === 1), source: answerEntryKey(entry, index) });
  }
  if (found.length === 0) return undefined;
  if (found.some(({ value }) => value !== found[0].value)) return undefined;
  return { topic, value: found[0].value, source: found[0].source };
}
