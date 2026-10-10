import { GenericAdapter, type FormAdapter } from './generic';

/** Prefers iCIMS field-row labels and keeps generic accessible label discovery as fallback. */
export class IcimsAdapter implements FormAdapter {
  readonly name = 'icims';
  private readonly generic = new GenericAdapter();

  questionParts(field: HTMLElement): string[] {
    const parts = this.generic.questionParts(field);
    const wrapper = field.closest('.iCIMS_FieldRow, .iCIMS_Field, [class*="iCIMS_Field"]');
    const label = wrapper?.querySelector('.iCIMS_Label, .iCIMS_LabelText, [id$="_label"], label, legend')
      ?.textContent?.replace(/\s+/g, ' ').trim();
    if (label && label.length <= 240 && !parts.some((part) => part.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      parts.unshift(label);
    }
    return parts;
  }
}
