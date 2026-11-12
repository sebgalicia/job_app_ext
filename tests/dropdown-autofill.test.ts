// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenericAdapter } from '../src/adapters/generic';
import { describeFocusedField } from '../src/adapters/field';
import { dropdownTiming } from '../src/preview/dropdown-driver';
import { autofillControl } from '../src/preview/text-preview';

/*
 * These widgets behave like production ATS dropdowns rather than pre-opened fixtures:
 * options do not exist until the menu opens, some menus render in a detached portal,
 * some options react only to mousedown, and some only load options after typing.
 */

const stored: Record<string, unknown> = {
  answers: {
    profile: { firstName: 'Alex', lastName: 'Example', country: 'United States', state: 'Massachusetts', yearsExperience: '5' },
    facts: { needsSponsorship: false },
    answers: [{ questions: ['How did you hear about us?'], type: 'choice', answer: 'LinkedIn' }],
  },
};

beforeAll(() => {
  Object.assign(globalThis, {
    browser: {
      storage: { local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])),
        set: async () => undefined,
      } },
      runtime: { sendMessage: async () => ({}) },
    },
  });
  // happy-dom has no layout; treat connected elements as visible.
  HTMLElement.prototype.getClientRects = function getClientRects(this: HTMLElement) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  };
  Object.assign(dropdownTiming, { openTimeoutMs: 400, filterTimeoutMs: 400, settleMs: 20, pollMs: 10 });
});

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

let openCount = 0;

/** Workday-style: a button that opens on click and renders options in a body-level portal after a delay. */
function portalDropdown(label: string, options: string[]): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', label);
  button.textContent = 'Select One';
  let menu: HTMLUListElement | undefined;
  const close = () => {
    menu?.remove();
    menu = undefined;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    if (menu) return close();
    openCount += 1;
    setTimeout(() => {
      menu = document.createElement('ul');
      menu.setAttribute('role', 'listbox');
      for (const text of options) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.textContent = text;
        item.addEventListener('click', () => { button.textContent = text; close(); });
        menu.append(item);
      }
      document.body.append(menu);
      button.setAttribute('aria-expanded', 'true');
    }, 60);
  });
  button.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  document.body.append(button);
  return button;
}

/**
 * React Select-style: an input inside a control; the chosen value is shown in a sibling
 * element, options select on mousedown only, and `asyncSearch` loads options only after typing.
 */
function reactSelect(label: string, options: string[], asyncSearch = false): HTMLInputElement {
  const container = document.createElement('div');
  const control = document.createElement('div');
  const valueContainer = document.createElement('div');
  const display = document.createElement('div');
  display.textContent = 'Select...';
  const input = document.createElement('input');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-label', label);
  input.setAttribute('aria-controls', `${label}-menu`);
  valueContainer.append(display, input);
  control.append(valueContainer);
  container.append(control);
  let menu: HTMLDivElement | undefined;
  const render = () => {
    menu?.remove();
    menu = document.createElement('div');
    menu.id = `${label}-menu`;
    menu.setAttribute('role', 'listbox');
    const query = input.value.toLocaleLowerCase();
    const visible = asyncSearch && !query ? [] : options.filter((text) => text.toLocaleLowerCase().includes(query));
    for (const text of visible) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = text;
      option.addEventListener('mousedown', () => {
        display.textContent = text;
        input.value = '';
        menu?.remove();
        menu = undefined;
        input.setAttribute('aria-expanded', 'false');
      });
      menu.append(option);
    }
    container.append(menu);
    input.setAttribute('aria-expanded', 'true');
  };
  control.addEventListener('mousedown', () => { openCount += 1; render(); });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      menu?.remove();
      menu = undefined;
      input.setAttribute('aria-expanded', 'false');
    }
  });
  document.body.append(container);
  return input;
}

async function fill(element: HTMLElement): Promise<boolean> {
  return autofillControl(element, describeFocusedField(element, new GenericAdapter()));
}

describe('autofill of closed custom dropdowns', () => {
  beforeEach(() => { openCount = 0; });

  it('opens a portal dropdown, waits for options, and picks the matching country', async () => {
    const button = portalDropdown('Country', ['Canada', 'United States of America', 'Mexico']);
    expect(await fill(button)).toBe(true);
    expect(button.textContent).toBe('United States of America');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('selects a mousedown-only option and maps a state name to its code', async () => {
    const input = reactSelect('State', ['CA', 'MA', 'NY']);
    expect(await fill(input)).toBe(true);
    expect(input.parentElement?.firstElementChild?.textContent).toBe('MA');
  });

  it('types to load options in a searchable dropdown', async () => {
    const input = reactSelect('How did you hear about us?', ['Indeed', 'LinkedIn', 'Referral'], true);
    expect(await fill(input)).toBe(true);
    expect(input.parentElement?.firstElementChild?.textContent).toBe('LinkedIn');
  });

  it('answers a sponsorship Yes/No dropdown by topic', async () => {
    const button = portalDropdown('Will you now or in the future require visa sponsorship?', ['Yes', 'No']);
    expect(await fill(button)).toBe(true);
    expect(button.textContent).toBe('No');
  });

  it('picks the range that contains a numeric answer', async () => {
    const button = portalDropdown('Years of experience', ['0-1 years', '2-4 years', '5-7 years', '8+ years']);
    expect(await fill(button)).toBe(true);
    expect(button.textContent).toBe('5-7 years');
  });

  it('never opens a dropdown it has no answer for', async () => {
    const button = portalDropdown('Favorite color', ['Red', 'Blue']);
    expect(await fill(button)).toBe(false);
    expect(openCount).toBe(0);
  });

  it('leaves an existing choice alone', async () => {
    const input = reactSelect('State', ['CA', 'MA', 'NY']);
    input.parentElement!.firstElementChild!.textContent = 'NY';
    expect(await fill(input)).toBe(false);
    expect(openCount).toBe(0);
    expect(input.parentElement?.firstElementChild?.textContent).toBe('NY');
  });

  it('closes the menu and clears typed text when no option fits', async () => {
    const input = reactSelect('How did you hear about us?', ['Indeed', 'Referral'], true);
    expect(await fill(input)).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('');
    expect(input.parentElement?.firstElementChild?.textContent).toBe('Select...');
  });
});
