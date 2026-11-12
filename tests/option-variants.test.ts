import { describe, expect, it } from 'vitest';
import { chooseConceptOption, chooseRangeOption, parseRange } from '../src/matching/option-variants';
import { chooseSavedAnswerOption } from '../src/preview/text-preview';

const labels = (...values: string[]) => values.map((label) => ({ label }));

describe('concept matching', () => {
  it('maps state names and codes both ways, including "Name (XX)" labels', () => {
    expect(chooseConceptOption(['Massachusetts'], labels('MA', 'NY'))?.label).toBe('MA');
    expect(chooseConceptOption(['MA'], labels('Massachusetts', 'Maine'))?.label).toBe('Massachusetts');
    expect(chooseConceptOption(['MA'], labels('Maine (ME)', 'Massachusetts (MA)'))?.label).toBe('Massachusetts (MA)');
    expect(chooseConceptOption(['MS'], labels('Mississippi', 'Missouri'))?.label).toBe('Mississippi');
  });

  it('maps country aliases and degree levels', () => {
    expect(chooseConceptOption(['USA'], labels('United Kingdom', 'United States'))?.label).toBe('United States');
    expect(chooseConceptOption(['B.S. Computer Science'], labels("Bachelor's Degree", "Master's Degree"))?.label).toBe("Bachelor's Degree");
    expect(chooseConceptOption(['Ph.D.'], labels("Master's", 'Doctorate'))?.label).toBe('Doctorate');
  });

  it('does not treat ordinary words as degree abbreviations', () => {
    expect(chooseConceptOption(['As needed'], labels("Associate's Degree", "Bachelor's Degree"))).toBeUndefined();
  });

  it('abstains when more than one option shares the concept', () => {
    expect(chooseConceptOption(['Bachelor of Science'], labels('Bachelor of Arts', 'Bachelor of Engineering'))).toBeUndefined();
  });
});

describe('numeric ranges', () => {
  it('parses common range wording', () => {
    expect(parseRange('2-4 years')).toMatchObject({ min: 2, max: 4 });
    expect(parseRange('5+ years')).toMatchObject({ min: 5, max: Infinity });
    expect(parseRange('Less than 1 year')).toMatchObject({ max: 1, maxInclusive: false });
    expect(parseRange('More than 10 years')).toMatchObject({ min: 10, minInclusive: false });
    expect(parseRange('Remote')).toBeUndefined();
  });

  it('picks the single range that contains the answer and abstains on overlaps', () => {
    expect(chooseRangeOption('5', labels('0-1 years', '2-4 years', '5-7 years', '8+ years'))?.label).toBe('5-7 years');
    expect(chooseRangeOption('2', labels('0-2 years', '2-4 years', '5+ years'))).toBeUndefined();
    expect(chooseRangeOption('Five', labels('0-1 years', '2-4 years'))).toBeUndefined();
  });
});

describe('saved answers use variants when exact text differs', () => {
  it('chooses an option even when the question match is only High, not very high', () => {
    expect(chooseSavedAnswerOption('Massachusetts', labels('CA', 'MA', 'NY'), 0.75, 0.6)?.label).toBe('MA');
    expect(chooseSavedAnswerOption('12 years', labels('Less than 1 year', '1-5 years', '5-10 years', 'More than 10 years'), 0.75, 0.6)?.label)
      .toBe('More than 10 years');
  });
});
