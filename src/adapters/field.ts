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
  if (field.getAttribute('role') !== 'combobox' || field.getAttribute('aria-expanded') !== 'true') return [];
  const ids = new Set(`${field.getAttribute('aria-controls') ?? ''} ${field.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean));
  const listboxes = new Set(Array.from(ids).flatMap((id) => {
    const element = field.ownerDocument.getElementById(id);
    if (!element) return [];
    return element.getAttribute('role') === 'listbox'
      ? [element]
      : Array.from(element.querySelectorAll<HTMLElement>('[role="listbox"]'));
  }).filter((listbox) => listbox.getAttribute('aria-multiselectable') !== 'true'));
  return Array.from(new Set(Array.from(listboxes).flatMap((listbox) => Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')))))
    .filter((option) => option.getAttribute('aria-disabled') !== 'true'
      && !option.hasAttribute('hidden')
      && !option.closest('[hidden], [aria-hidden="true"]'));
}

export function describeFocusedField(
  field: HTMLElement,
  adapter: FormAdapter,
): DetectedField {
  const members = groupMembers(field);
  const questionParts = adapter.questionParts(field);
  let fieldType: DetectedField['fieldType'] = 'text';
  let optionLabels: string[] = [];

  if (field.getAttribute('role') === 'combobox') {
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
    question: questionParts.join(' '),
    questionParts,
    fieldType,
    inputType: field instanceof HTMLInputElement ? field.type : undefined,
    autocomplete: field.getAttribute('autocomplete') ?? undefined,
    groupSize: members.length,
    optionLabels,
  };
}
