import { describe, expect, it } from 'vitest';
import { chooseTextOption, isPlaceholderOption } from '../src/preview/text-preview';

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
});
