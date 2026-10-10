import { GenericAdapter, type FormAdapter } from './generic';

/** Prefers legacy Taleo form-row labels and keeps generic accessible label discovery as fallback. */
export class TaleoAdapter implements FormAdapter {
  readonly name = 'taleo';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest('.formField, .formRow, [class*="formField"]');
    const label = wrapper?.querySelector('.formLabel, [class*="formLabel"], [id$="_label"], label, legend')
      ?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      parts.unshift(label);
    }
    return parts;
  }
}
