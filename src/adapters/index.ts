import { GenericAdapter, type FormAdapter } from './generic';
import { GreenhouseAdapter } from './greenhouse';
import { WorkdayAdapter } from './workday';
import { LeverAdapter } from './lever';
import { AshbyAdapter } from './ashby';
import { IcimsAdapter } from './icims';
import { TaleoAdapter } from './taleo';
import { SmartRecruitersAdapter } from './smartrecruiters';

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
  if (hostname === 'icims.com' || hostname.endsWith('.icims.com')
    || document.querySelector('[data-qa="icims-application-form"]')) return new IcimsAdapter();
  if (hostname === 'taleo.net' || hostname.endsWith('.taleo.net')
    || document.querySelector('[data-qa="taleo-application-form"]')) return new TaleoAdapter();
  if (hostname === 'smartrecruiters.com' || hostname.endsWith('.smartrecruiters.com')
    || document.querySelector('[data-qa="smartrecruiters-application-form"]')) return new SmartRecruitersAdapter();
  return document.querySelector('.field, .application-question, [data-qa="question"]')
    ? new GreenhouseAdapter()
    : new GenericAdapter();
}

export type { FormAdapter } from './generic';
