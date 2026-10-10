import { GenericAdapter, type FormAdapter } from './generic';

/** Prefers Lever's question wrapper labels, then falls back to accessible and generic labels. */
export class LeverAdapter implements FormAdapter {
  readonly name = 'lever';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest(
      '.application-question, .application-field, [data-qa="application-question"], [data-testid="application-question"]',
    );
    const label = wrapper?.querySelector(
      '.application-label, .application-question-label, [data-qa="question-label"], [data-testid="question-label"], label, legend',
    )?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      parts.unshift(label);
    }
    return parts;
  }
}
