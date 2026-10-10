export type Topic = 'needsSponsorship' | 'authorizedToWork' | 'willingToRelocate' | 'over18';
export type PolarityResult = { topic?: Topic; flips: number; ambiguous: boolean };

const topicPatterns: Array<[Topic, RegExp]> = [
  ['needsSponsorship', /\b(sponsor(?:ship)?|visa|immigration support)\b/i],
  ['authorizedToWork', /\b(?:un?authori[sz]ed|authori[sz]ed|authori[sz]ation|ineligible|eligible|legally permitted|permitted|right to work|work authorization)\b/i],
  ['willingToRelocate', /\b(relocat(?:e|ion|ing)|move to another location)\b/i],
  ['over18', /\b(over 18|under 18|at least 18|18 years of age|age requirement)\b/i],
];

const negationPatterns: Partial<Record<Topic, RegExp[]>> = {
  needsSponsorship: [
    /\b(?:not|never|no longer|don't|do not|doesn't|does not|won't|will not|wouldn't|would not)\s+(?:(?:now|ever|in the future|currently|an|employer|immigration|work|require|need|requiring|needing|visa)\s+){0,5}(?:require|need|requiring|needing|sponsor(?:ship)?|visa support)\b/gi,
    /\bwithout\s+(?:any\s+)?(?:visa\s+)?(?:sponsor(?:ship)?|support)\b/gi,
    /\bno\s+(?:visa\s+)?(?:sponsor(?:ship)?|support)\b/gi,
    /\b(?:unnecessary|unneeded)\s+(?:visa\s+)?sponsor(?:ship)?\b/gi,
  ],
  authorizedToWork: [
    /\b(?:not|never|no longer|aren't|are not|isn't|is not|wasn't|were not|cannot|can't|unable to)\s+(?:(?:legally|currently|fully)\s+)?(?:authorized|authorised|eligible|permitted)\b/gi,
    /\bineligible\b/gi,
    /\bunauthori[sz]ed\b/gi,
    /\b(?:lack|lacking|without)\s+(?:legal\s+)?(?:work\s+)?authorization\b/gi,
  ],
  willingToRelocate: [
    /\b(?:not|never|don't|do not|won't|will not|unable to)\s+(?:(?:willing|able|open|want)\s+to\s+)?relocat(?:e|ion)\b/gi,
    /\bnot\s+(?:willing|able|open)\s+to\s+move\b/gi,
  ],
  over18: [
    /\b(?:not|under|younger than|less than)\s+(?:over\s+)?18\b/gi,
    /\bnot\s+(?:at least|18 years of age)\b/gi,
  ],
};

/** Detect a common fact topic and count only negations that attach to that topic. */
export function detectPolarity(text: string): PolarityResult {
  const found = topicPatterns.filter(([, pattern]) => pattern.test(text));
  if (found.length === 0) return { flips: 0, ambiguous: false };
  if (found.length > 1) return { flips: 0, ambiguous: true };

  const [topic] = found[0];
  const patterns = negationPatterns[topic] ?? [];
  const matches = patterns.flatMap((pattern) => [...text.matchAll(new RegExp(pattern.source, pattern.flags))]);
  const spans = matches.map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length] as const);
  const distinctSpans = spans.filter(([start, end], index) =>
    !spans.slice(0, index).some(([priorStart, priorEnd]) => start < priorEnd && end > priorStart),
  );

  return {
    topic,
    flips: distinctSpans.length,
    ambiguous: distinctSpans.length > 1,
  };
}

export type ChoiceOption = { label: string; value?: string };

/** Choose the option that represents the stored fact, returning undefined when unclear. */
export function chooseFactOption(
  question: string,
  options: ChoiceOption[],
  fact: boolean,
): ChoiceOption | undefined {
  const questionPolarity = detectPolarity(question);
  if (questionPolarity.ambiguous || !questionPolarity.topic) return undefined;
  const questionReversed = questionPolarity.flips % 2 === 1;

  const candidates = options.filter((option) => {
    const label = option.label.trim();
    const yesNo = /^yes\b/i.test(label) ? true : /^no\b/i.test(label) ? false : undefined;
    if (yesNo !== undefined) return yesNo === (fact !== questionReversed);

    const optionPolarity = detectPolarity(label);
    if (optionPolarity.ambiguous || optionPolarity.topic !== questionPolarity.topic) return false;
    return (optionPolarity.flips % 2 === 1) === !fact;
  });

  return candidates.length === 1 ? candidates[0] : undefined;
}
