import { GenericAdapter, type FormAdapter } from './generic';
import { GreenhouseAdapter } from './greenhouse';

export function chooseAdapter(document: Document): FormAdapter {
  return document.querySelector('.field, .application-question, [data-qa="question"]')
    ? new GreenhouseAdapter()
    : new GenericAdapter();
}

export type { FormAdapter } from './generic';
