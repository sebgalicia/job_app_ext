import { GenericAdapter, type FormAdapter } from './generic';

/** Prefers Ashby application-field labels, then falls back to accessible and generic labels. */
export class AshbyAdapter implements FormAdapter {
  readonly name = 'ashby';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest(
      '.ashby-application-form-field, [data-testid="application-form-field"], [data-qa="application-form-field"]',
    );
    const label = wrapper?.querySelector(
      '.ashby-application-form-field-label, [data-testid="application-form-field-label"], [data-qa="application-form-field-label"], label, legend',
    )?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      parts.unshift(label);
    }
    return parts;
  }
}
