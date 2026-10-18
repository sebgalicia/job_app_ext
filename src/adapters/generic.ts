export interface FormAdapter {
  readonly name: string;
  questionParts(field: HTMLElement): string[];
}

function addUnique(parts: string[], value: string | null | undefined): void {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (normalized && !parts.some((part) => part.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    parts.push(normalized);
  }
}

function textOf(element: Element | null): string | undefined {
  const value = element?.textContent?.replace(/\s+/g, ' ').trim();
  return value && value.length <= 240 ? value : undefined;
}

function precedingText(field: HTMLElement): string | undefined {
  let current: HTMLElement | null = field;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    const text = textOf(current.previousElementSibling);
    if (text) return text;
  }
  return undefined;
}

export class GenericAdapter implements FormAdapter {
  readonly name = 'generic';

  questionParts(field: HTMLElement): string[] {
    const parts: string[] = [];
    const role = field.getAttribute('role');
    const isChoiceOption = (field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type))
      || role === 'radio' || role === 'checkbox';
    if (!isChoiceOption) {
      const labels = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement
        ? Array.from(field.labels ?? [])
        : [];
      for (const label of labels) addUnique(parts, textOf(label));
    }
    if (!isChoiceOption) addUnique(parts, field.getAttribute('aria-label'));

    const group = isChoiceOption ? field.closest<HTMLElement>('[role="radiogroup"], [role="group"]') : null;
    if (group) addUnique(parts, group.getAttribute('aria-label'));
    const labelledBy = group?.getAttribute('aria-labelledby') || field.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.trim().split(/\s+/)) addUnique(parts, textOf(field.ownerDocument.getElementById(id)));
    }

    addUnique(parts, textOf(field.closest('fieldset')?.querySelector('legend') ?? null));
    addUnique(parts, precedingText(field));
    addUnique(parts, field.getAttribute('name'));
    addUnique(parts, field.id);
    addUnique(parts, field.getAttribute('placeholder'));
    return parts;
  }
}
