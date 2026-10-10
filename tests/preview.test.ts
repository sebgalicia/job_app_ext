import { describe, expect, it } from 'vitest';
import { resolvePlaceholders } from '../src/preview/text-preview';

describe('resolvePlaceholders', () => {
  it('replaces detected company and role values', () => {
    expect(resolvePlaceholders('I am excited about {role} at {company}.', {
      role: 'Engineer', company: 'Northwind',
    })).toEqual({ text: 'I am excited about Engineer at Northwind.', missing: [] });
  });

  it('marks absent values and never returns a literal template placeholder', () => {
    const result = resolvePlaceholders('I want the {role} role at {company}.', { role: 'Engineer' });
    expect(result.text).toBe('I want the Engineer role at [company missing].');
    expect(result.missing).toEqual(['company']);
    expect(result.text).not.toContain('{company}');
  });

  it('handles repeated and case-varied placeholder tokens once', () => {
    expect(resolvePlaceholders('{Company} and {company} for {ROLE}', {})).toEqual({
      text: '[company missing] and [company missing] for [role missing]',
      missing: ['company', 'role'],
    });
  });
});
