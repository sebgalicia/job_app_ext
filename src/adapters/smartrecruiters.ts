import { GenericAdapter, type FormAdapter } from './generic';

/** Prefers SmartRecruiters application-field labels and keeps generic labels as fallback. */
export class SmartRecruitersAdapter implements FormAdapter {
  readonly name = 'smartrecruiters';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest(
      '.application-form-field, [data-testid*="application-field"], [data-qa*="application-field"], [class*="applicationField"]',
    );
    const label = wrapper?.querySelector('[data-testid*="label"], [data-qa*="label"], label, legend')
      ?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      parts.unshift(label);
    }
    return parts;
  }
}
