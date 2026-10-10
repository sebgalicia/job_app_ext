import { describe, expect, it } from 'vitest';
import { matchQuestion, scoreSimilarity } from '../src/matching/matcher';
import { normalizeText } from '../src/matching/normalize';
import { chooseFactOption, detectPolarity } from '../src/matching/polarity';

describe('normalizeText', () => {
  it('removes punctuation, stopwords, and casing differences', () => {
    expect(normalizeText('Are you, currently authorized to work?')).toEqual(['authorized', 'work']);
  });

  it('canonicalizes common field wording synonyms', () => {
    expect(normalizeText('What is your job title?')).toContain('job');
    expect(normalizeText('What is your position?')).toContain('job');
    expect(normalizeText('What is your employer?')).toContain('company');
    expect(normalizeText('What is your company?')).toContain('company');
  });

  it('lightly stems inflections', () => {
    expect(normalizeText('working locations')).toEqual(['work', 'location']);
  });
});

describe('question similarity', () => {
  it('scores exact wording above a typo and unrelated wording', () => {
    const exact = scoreSimilarity('What is your email address?', 'What is your email address?');
    const typo = scoreSimilarity('What is your emial address?', 'What is your email address?');
    const unrelated = scoreSimilarity('What is your favorite color?', 'What is your email address?');
    expect(exact).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(unrelated);
  });

  it('compares every wording and returns a runner up and confidence', () => {
    const result = matchQuestion('What email should we use to contact you?', [
      { key: 'email', questions: ['Email address', 'What email should we use to contact you?'] },
      { key: 'phone', questions: ['Phone number', 'Best telephone number'] },
    ]);
    expect(result.bestKey).toBe('email');
    expect(result.secondKey).toBe('phone');
    expect(result.confidence).toBe('high');
  });

  it('applies configurable high and medium thresholds', () => {
    const candidates = [{ key: 'a', questions: ['Describe your favorite kind of work'] }];
    const result = matchQuestion('Describe your favorite kind of work', candidates, { high: 1.1, medium: 0.3 });
    expect(result.confidence).toBe('medium');
  });
});

describe('yes/no topic and polarity', () => {
  const wordingCases: Array<[string, string | undefined, number]> = [
    ['Will you now or in the future require sponsorship?', 'needsSponsorship', 0],
    ['Will you at any point require visa sponsorship?', 'needsSponsorship', 0],
    ['Do you require employer sponsorship?', 'needsSponsorship', 0],
    ['Can you work in the US without sponsorship?', 'needsSponsorship', 1],
    ['Do you not require visa support?', 'needsSponsorship', 1],
    ['I do not need sponsorship', 'needsSponsorship', 1],
    ['I will not require sponsorship', 'needsSponsorship', 1],
    ['Will you never need an immigration sponsor?', 'needsSponsorship', 1],
    ['Are you able to work without visa sponsorship?', 'needsSponsorship', 1],
    ['Do you need no sponsorship?', 'needsSponsorship', 1],
    ['Would you need sponsorship later?', 'needsSponsorship', 0],
    ['Do you currently need sponsorship?', 'needsSponsorship', 0],
    ['Will your employer need to sponsor your work visa?', 'needsSponsorship', 0],
    ['Are you requiring sponsorship?', 'needsSponsorship', 0],
    ['Can you confirm sponsorship is needed?', 'needsSponsorship', 0],
    ['Have you needed visa sponsorship before?', 'needsSponsorship', 0],
    ['I would not need visa sponsorship', 'needsSponsorship', 1],
    ['Would you ever need immigration support?', 'needsSponsorship', 0],
    ['Are you authorized to work in the United States?', 'authorizedToWork', 0],
    ['Are you legally authorized to work here?', 'authorizedToWork', 0],
    ['Are you eligible to work in this country?', 'authorizedToWork', 0],
    ['Do you have the right to work in the US?', 'authorizedToWork', 0],
    ['Are you not authorized to work here?', 'authorizedToWork', 1],
    ['Are you not legally eligible to work?', 'authorizedToWork', 1],
    ['Are you unauthorized to work in the US?', 'authorizedToWork', 1],
    ['Do you lack work authorization?', 'authorizedToWork', 1],
    ['Are you legally permitted to work?', 'authorizedToWork', 0],
    ['Are you not permitted to work here?', 'authorizedToWork', 1],
    ['Are you authorized to work without restriction?', 'authorizedToWork', 0],
    ['Are you eligible for employment in the United States?', 'authorizedToWork', 0],
    ['Are you willing to relocate for this position?', 'willingToRelocate', 0],
    ['Would you relocate for the right role?', 'willingToRelocate', 0],
    ['Are you open to relocating?', 'willingToRelocate', 0],
    ['Are you not willing to relocate?', 'willingToRelocate', 1],
    ['I do not want to relocate', 'willingToRelocate', 1],
    ['Would you move to another location?', 'willingToRelocate', 0],
    ['Are you unable to relocate?', 'willingToRelocate', 1],
    ['Can you relocate if needed?', 'willingToRelocate', 0],
    ['Are you over 18 years old?', 'over18', 0],
    ['Are you at least 18 years of age?', 'over18', 0],
    ['Are you not over 18?', 'over18', 1],
    ['Are you under 18 years old?', 'over18', 1],
  ];

  it.each(wordingCases)('%s', (wording, topic, flips) => {
    const result = detectPolarity(wording);
    expect(result.topic).toBe(topic);
    expect(result.flips).toBe(flips);
    expect(result.ambiguous).toBe(false);
  });

  it('does not treat unless, restriction, or unrelated negative wording as a polarity flip', () => {
    expect(detectPolarity('Are you authorized to work without restriction?').flips).toBe(0);
    expect(detectPolarity('Can you work unless a restriction applies?').flips).toBe(0);
    expect(detectPolarity('Are you authorized to work other than part time?').flips).toBe(0);
  });

  it('marks questions with multiple fact topics as ambiguous', () => {
    expect(detectPolarity('Are you authorized to work and willing to relocate?').ambiguous).toBe(true);
  });

  it('chooses meaning-based options, including fully worded options', () => {
    const yesNo = chooseFactOption('Will you require sponsorship?', [
      { label: 'Yes' }, { label: 'No' },
    ], false);
    expect(yesNo?.label).toBe('No');

    const reversed = chooseFactOption('Will you not require visa support?', [
      { label: 'Yes' }, { label: 'No' },
    ], false);
    expect(reversed?.label).toBe('Yes');

    const phraseOptions = chooseFactOption('Will you require sponsorship?', [
      { label: 'I will require sponsorship' }, { label: 'I do not need sponsorship' },
    ], false);
    expect(phraseOptions?.label).toBe('I do not need sponsorship');
  });
});
