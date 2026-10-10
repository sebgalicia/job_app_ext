import { describe, expect, it } from 'vitest';
import { chooseEthnicityOption, chooseTextOption, ethnicityAliasKey, isPlaceholderOption } from '../src/preview/text-preview';

describe('native choice preview matching', () => {
  it('treats empty and placeholder select options as empty', () => {
    expect(isPlaceholderOption('Choose a location', '')).toBe(true);
    expect(isPlaceholderOption('Please select an option', 'placeholder')).toBe(true);
    expect(isPlaceholderOption('--', 'default')).toBe(true);
    expect(isPlaceholderOption('Boston', 'boston')).toBe(false);
  });

  it('matches the saved choice to a clear option label or value', () => {
    const options = [
      { label: 'Boston Office', value: 'bos' },
      { label: 'New York Office', value: 'nyc' },
    ];
    expect(chooseTextOption('Boston Office', options)?.value).toBe('bos');
    expect(chooseTextOption('nyc', options)?.value).toBe('nyc');
  });

  it('does not guess between close option matches', () => {
    expect(chooseTextOption('Engineer', [
      { label: 'Software Engineer', value: 'software' },
      { label: 'Product Engineer', value: 'product' },
    ])).toBeUndefined();
  });

  it('maps SE Asian to Southeast Asian only for a high-confidence ethnicity question', () => {
    const options = [
      { label: 'East Asian', value: 'east' },
      { label: 'Southeast Asian', value: 'southeast' },
      { label: 'South Asian', value: 'south' },
    ];
    expect(ethnicityAliasKey('SE Asian')).toBe('southeast-asian');
    expect(chooseEthnicityOption('What is your ethnicity?', ['What is your ethnicity?'], 'SE Asian', options, 'high').option?.value)
      .toBe('southeast');
    expect(chooseEthnicityOption('What is your ethnicity?', ['What is your ethnicity?'], 'SE Asian', options, 'medium').applicable)
      .toBe(false);
  });

  it('does not guess another ethnicity when the matching category is absent', () => {
    const options = [{ label: 'East Asian' }, { label: 'South Asian' }, { label: 'Asian' }];
    const result = chooseEthnicityOption('Race and ethnicity', ['What is your ethnicity?'], 'SE Asian', options, 'high');
    expect(result).toEqual({ applicable: true, option: undefined });
  });
});
