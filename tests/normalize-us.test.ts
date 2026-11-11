import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/matching/normalize';

describe('country abbreviation and pronoun handling', () => {
  it('treats capitalized US, U.S., and USA as the country', () => {
    expect(normalizeText('Can you work in the US?')).toContain('united');
    expect(normalizeText('Are you authorized to work in the U.S.?')).toContain('united');
    expect(normalizeText('USA')).toContain('united');
  });

  it('drops the lowercase pronoun and leaves other words alone', () => {
    expect(normalizeText('How did you hear about us?')).not.toContain('united');
    expect(normalizeText('USB drive')).not.toContain('united');
  });

  it('keeps "why" so essay questions differ from one-word field labels', () => {
    expect(normalizeText('Why this company?')).toEqual(['why', 'company']);
  });
});
