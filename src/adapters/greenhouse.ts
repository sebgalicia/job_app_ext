import { GenericAdapter, type FormAdapter } from './generic';

/** Adds Greenhouse's common .field and question wrapper markup to generic label discovery. */
export class GreenhouseAdapter implements FormAdapter {
  readonly name = 'greenhouse';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest('.field, .application-question, [data-qa="question"]');
    const greenhouseLabel = wrapper?.querySelector('.label, label, legend, [data-qa="question-label"]');
    const label = greenhouseLabel?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) parts.unshift(label);
    return parts;
  }
}
