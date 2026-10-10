import { GenericAdapter, type FormAdapter } from './generic';
import { GreenhouseAdapter } from './greenhouse';
import { WorkdayAdapter } from './workday';

export function chooseAdapter(document: Document): FormAdapter {
  const hostname = document.location?.hostname.toLocaleLowerCase() ?? '';
  if (hostname === 'myworkdayjobs.com' || hostname.endsWith('.myworkdayjobs.com')
    || hostname === 'myworkday.com' || hostname.endsWith('.myworkday.com')) {
    return new WorkdayAdapter();
  }
  return document.querySelector('.field, .application-question, [data-qa="question"]')
    ? new GreenhouseAdapter()
    : new GenericAdapter();
}

export type { FormAdapter } from './generic';
