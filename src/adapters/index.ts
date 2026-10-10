import { GenericAdapter, type FormAdapter } from './generic';
import { GreenhouseAdapter } from './greenhouse';
import { WorkdayAdapter } from './workday';
import { LeverAdapter } from './lever';
import { AshbyAdapter } from './ashby';

export function chooseAdapter(document: Document): FormAdapter {
  const hostname = document.location?.hostname.toLocaleLowerCase() ?? '';
  const isWorkdayHost = hostname === 'myworkdayjobs.com' || hostname.endsWith('.myworkdayjobs.com')
    || hostname === 'myworkday.com' || hostname.endsWith('.myworkday.com');
  if (isWorkdayHost || document.querySelector('[data-automation-id="applicationForm"]')) {
    return new WorkdayAdapter();
  }
  if (hostname === 'jobs.lever.co' || hostname.endsWith('.jobs.lever.co')
    || document.querySelector('[data-qa="lever-application-form"]')) return new LeverAdapter();
  if (hostname === 'jobs.ashbyhq.com' || hostname.endsWith('.jobs.ashbyhq.com')
    || document.querySelector('[data-qa="ashby-application-form"]')) return new AshbyAdapter();
  return document.querySelector('.field, .application-question, [data-qa="question"]')
    ? new GreenhouseAdapter()
    : new GenericAdapter();
}

export type { FormAdapter } from './generic';
