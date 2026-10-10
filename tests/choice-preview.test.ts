import { describe, expect, it } from 'vitest';
import { chooseGeneralizedOption, chooseSavedAnswerOption, chooseTextOption, isPlaceholderOption } from '../src/preview/text-preview';

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

  it('generalizes a free-text answer to the only broader matching option', () => {
    const options = [{ label: 'Asian', value: 'asian' }, { label: 'White', value: 'white' }];
    expect(chooseGeneralizedOption('SE Asian', options)?.value).toBe('asian');
  });

  it('prefers the most specific option that fits the saved answer', () => {
    const options = [{ label: 'Asian' }, { label: 'Southeast Asian' }];
    expect(chooseGeneralizedOption('Southeast Asian', options)?.label).toBe('Southeast Asian');
  });

  it('does not generalize when multiple offered choices fit equally', () => {
    expect(chooseGeneralizedOption('Asian', [{ label: 'Asian' }, { label: 'Asian' }])).toBeUndefined();
  });

  it('does not generalize an answer to unrelated options', () => {
    expect(chooseGeneralizedOption('SE Asian', [{ label: 'East Asian' }, { label: 'South Asian' }])).toBeUndefined();
  });

  it('uses generalization only for a very high-confidence, unambiguous question match', () => {
    const options = [{ label: 'Asian' }, { label: 'White' }];
    expect(chooseSavedAnswerOption('SE Asian', options, 0.86, 0.2)?.label).toBe('Asian');
    expect(chooseSavedAnswerOption('SE Asian', options, 0.84, 0.2)).toBeUndefined();
    expect(chooseSavedAnswerOption('SE Asian', options, 0.9, 0.85)).toBeUndefined();
  });
});
