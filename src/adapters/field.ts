import type { FormAdapter } from './generic';

export type DetectedField = {
  adapter: string;
  question: string;
  questionParts: string[];
  fieldType: 'text' | 'choice' | 'yesno';
  inputType?: string;
  autocomplete?: string;
  groupSize: number;
  optionLabels: string[];
};

const choiceWidgetSelector = '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [data-automation-id="selectWidget"]';

export function isChoiceWidget(field: HTMLElement): boolean {
  if (typeof field.matches === 'function') return field.matches(choiceWidgetSelector);
  return field.getAttribute('role') === 'combobox'
    || field.getAttribute('aria-haspopup') === 'listbox'
    || field.getAttribute('aria-haspopup') === 'true'
    || field.getAttribute('data-automation-id') === 'selectWidget';
}

export function choiceWidgetExpanded(field: HTMLElement): boolean {
  if (field.getAttribute('aria-expanded') === 'true'
    || (typeof field.querySelector === 'function' && field.querySelector('[aria-expanded="true"]'))) return true;
  const active = field.ownerDocument.activeElement;
  if (active && active !== field
    && !(typeof Node !== 'undefined' && active instanceof Node && field.contains(active))) return false;
  const ids = `${field.getAttribute('aria-controls') ?? ''} ${field.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean);
  if (ids.some((id) => {
    const popup = field.ownerDocument.getElementById(id);
    return Boolean(popup && typeof popup.getAttribute === 'function' && isVisible(popup as HTMLElement)
      && typeof popup.querySelector === 'function'
      && popup.querySelector('[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]'));
  })) return true;
  if (typeof field.ownerDocument.querySelectorAll !== 'function') return false;
  return Array.from(field.ownerDocument.querySelectorAll<HTMLElement>(
    '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]',
  )).some(isVisible);
}

function optionLabel(option: HTMLOptionElement): string {
  return option.label.trim() || option.textContent?.trim() || '';
}

function groupMembers(field: HTMLElement): HTMLElement[] {
  if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox') && field.name) {
    const scope: ParentNode = field.form ?? field.ownerDocument;
    return Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="${field.type}"]`))
      .filter((candidate) => candidate.name === field.name);
  }
  return [field];
}

export function ariaComboboxOptions(field: HTMLElement): HTMLElement[] {
  if (!isChoiceWidget(field) || !choiceWidgetExpanded(field)) return [];
  const ids = new Set(`${field.getAttribute('aria-controls') ?? ''} ${field.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean));
  const linkedListboxes = Array.from(ids).flatMap((id) => {
    const element = field.ownerDocument.getElementById(id);
    if (!element) return [];
    return element.getAttribute('role') === 'listbox'
      ? [element]
      : Array.from(element.querySelectorAll<HTMLElement>('[role="listbox"]'));
  });
  const listboxes = new Set(linkedListboxes.filter((listbox) => listbox.getAttribute('aria-multiselectable') !== 'true'));
  if (linkedListboxes.length > 0 && listboxes.size === 0) return [];
  // Workday and some Greenhouse builds render an open popup without linking it
  // through aria-controls; use only visible listboxes/options in that case.
  if (listboxes.size === 0) {
    const pageListboxes = typeof field.ownerDocument.querySelectorAll === 'function'
      ? field.ownerDocument.querySelectorAll<HTMLElement>('[role="listbox"]')
      : [];
    for (const listbox of pageListboxes) {
      if (listbox.getAttribute('aria-multiselectable') !== 'true' && isVisible(listbox)) listboxes.add(listbox);
    }
  }
  const fromListboxes = Array.from(listboxes).flatMap((listbox) => Array.from(listbox.querySelectorAll<HTMLElement>(
    '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]',
  )));
  const allPageOptions = typeof field.ownerDocument.querySelectorAll === 'function'
    ? Array.from(field.ownerDocument.querySelectorAll<HTMLElement>(
      '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]',
    ))
    : [];
  const candidates = fromListboxes.length > 0 ? fromListboxes : allPageOptions.filter(isVisible);
  return Array.from(new Set(candidates))
    .filter((option) => option.getAttribute('aria-disabled') !== 'true'
      && option.getAttribute('data-automation-id') !== 'promptOptionDisabled'
      && !option.hasAttribute('hidden')
      && !option.closest('[hidden], [aria-hidden="true"]')
      && isVisible(option));
}

function isVisible(element: HTMLElement): boolean {
  const visibility = element.ownerDocument?.defaultView?.getComputedStyle(element).visibility;
  const connected = element.isConnected !== false;
  const hasVisibleBox = typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
  const hiddenAncestor = typeof element.closest === 'function' && element.closest('[hidden], [aria-hidden="true"]');
  return connected && hasVisibleBox
    && !hiddenAncestor
    && visibility !== 'hidden';
}

export function describeFocusedField(
  field: HTMLElement,
  adapter: FormAdapter,
): DetectedField {
  const members = groupMembers(field);
  const questionParts = adapter.questionParts(field);
  let fieldType: DetectedField['fieldType'] = 'text';
  let optionLabels: string[] = [];

  if (isChoiceWidget(field)) {
    fieldType = 'choice';
    optionLabels = ariaComboboxOptions(field).map((option) =>
      (option.getAttribute('aria-label') || option.textContent || '').replace(/\s+/g, ' ').trim(),
    ).filter(Boolean);
  } else if (field instanceof HTMLSelectElement) {
    fieldType = 'choice';
    optionLabels = Array.from(field.options, optionLabel).filter(Boolean);
  } else if (field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type)) {
    const allYesNo = members.length === 2 && members.every((member) => member instanceof HTMLInputElement
      && /^(?:yes|no|true|false)$/i.test(member.labels?.[0]?.textContent?.trim() || member.value));
    fieldType = allYesNo || members.length === 1 ? 'yesno' : 'choice';
    optionLabels = members.filter((member): member is HTMLInputElement => member instanceof HTMLInputElement).map((input) => {
      const label = input.labels?.[0];
      return label?.textContent?.replace(/\s+/g, ' ').trim() || input.value;
    }).filter(Boolean);
  }

  return {
    adapter: adapter.name,
    // The first part is the accessible, user-facing label. Keep noisy nearby
    // text, IDs, and placeholders as fallbacks instead of diluting that label.
    question: questionParts[0] ?? questionParts.join(' '),
    questionParts,
    fieldType,
    inputType: field instanceof HTMLInputElement ? field.type : undefined,
    autocomplete: field.getAttribute('autocomplete') ?? undefined,
    groupSize: members.length,
    optionLabels,
  };
}
