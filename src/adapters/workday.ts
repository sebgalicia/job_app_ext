import { GenericAdapter, type FormAdapter } from './generic';

/** Adds Workday form-field question labels to the generic accessible field description. */
export class WorkdayAdapter implements FormAdapter {
  readonly name = 'workday';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest(
      '[data-automation-id="formField"], [data-automation-id="fieldSet"], [data-automation-id="question"]',
    );
    const label = wrapper?.querySelector(
      '[data-automation-id="formField-label"], [data-automation-id="questionTitle"], label, legend',
    )?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      parts.unshift(label);
    }
    return parts;
  }
}
