export interface FormAdapter {
  readonly name: string;
  questionParts(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[];
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

  questionParts(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
    const parts: string[] = [];
    const isChoiceOption = field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type);
    if (!isChoiceOption) {
      for (const label of Array.from(field.labels ?? [])) addUnique(parts, textOf(label));
    }
    addUnique(parts, field.getAttribute('aria-label'));

    const labelledBy = field.getAttribute('aria-labelledby');
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
