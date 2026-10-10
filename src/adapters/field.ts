import type { FormAdapter } from './generic';

export type DetectedField = {
  adapter: string;
  question: string;
  questionParts: string[];
  fieldType: 'text' | 'choice' | 'yesno';
  groupSize: number;
  optionLabels: string[];
};

function optionLabel(option: HTMLOptionElement): string {
  return option.label.trim() || option.textContent?.trim() || '';
}

function groupMembers(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): HTMLElement[] {
  if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox') && field.name) {
    const scope: ParentNode = field.form ?? field.ownerDocument;
    return Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="${field.type}"]`))
      .filter((candidate) => candidate.name === field.name);
  }
  return [field];
}

export function describeFocusedField(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  adapter: FormAdapter,
): DetectedField {
  const members = groupMembers(field);
  const questionParts = adapter.questionParts(field);
  let fieldType: DetectedField['fieldType'] = 'text';
  let optionLabels: string[] = [];

  if (field instanceof HTMLSelectElement) {
    fieldType = 'choice';
    optionLabels = Array.from(field.options, optionLabel).filter(Boolean);
  } else if (field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type)) {
    fieldType = members.length > 1 ? 'choice' : 'yesno';
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
    groupSize: members.length,
    optionLabels,
  };
}
