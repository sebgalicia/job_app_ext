import { describe, expect, it } from 'vitest';
import { chooseAdapter } from '../src/adapters';
import { ariaComboboxOptions } from '../src/adapters/field';

function documentOn(hostname: string, hasGreenhouseQuestion = false, hasWorkdayMarker = false): Document {
  return {
    location: { hostname },
    querySelector: (selector: string) => (hasGreenhouseQuestion && selector.includes('.field'))
      || (hasWorkdayMarker && selector.includes('applicationForm')) ? {} : null,
  } as unknown as Document;
}

describe('adapter selection', () => {
  it('uses the Workday adapter on Workday application hosts', () => {
    expect(chooseAdapter(documentOn('acme.myworkdayjobs.com')).name).toBe('workday');
    expect(chooseAdapter(documentOn('acme.myworkday.com')).name).toBe('workday');
    expect(chooseAdapter(documentOn('localhost', false, true)).name).toBe('workday');
  });

  it('keeps Greenhouse markup on its adapter and other hosts generic', () => {
    expect(chooseAdapter(documentOn('boards.greenhouse.io', true)).name).toBe('greenhouse');
    expect(chooseAdapter(documentOn('careers.example.com')).name).toBe('generic');
  });
});

describe('accessible custom combobox option discovery', () => {
  it('reads enabled options only from an expanded listbox and de-duplicates ARIA references', () => {
    const option = (label: string, disabled = false) => ({
      textContent: label,
      getAttribute: (name: string) => name === 'aria-disabled' && disabled ? 'true' : null,
      hasAttribute: () => false,
      closest: () => null,
    });
    const available = option('Remote');
    const disabled = option('On site', true);
    let multiselect = false;
    const listbox = {
      getAttribute: (name: string) => name === 'role' ? 'listbox' : name === 'aria-multiselectable' && multiselect ? 'true' : null,
      querySelectorAll: () => [available, disabled],
    };
    const document = { getElementById: (id: string) => id === 'choices' ? listbox : null };
    let expanded = true;
    const field = {
      getAttribute: (name: string): string | null => ({
        role: 'combobox', 'aria-expanded': expanded ? 'true' : 'false', 'aria-controls': 'choices', 'aria-owns': 'choices',
      } as Record<string, string>)[name] ?? null,
      ownerDocument: document,
    };
    expect(ariaComboboxOptions(field as unknown as HTMLElement)).toEqual([available]);
    multiselect = true;
    expect(ariaComboboxOptions(field as unknown as HTMLElement)).toEqual([]);
    multiselect = false;
    expanded = false;
    expect(ariaComboboxOptions(field as unknown as HTMLElement)).toEqual([]);
  });
});
