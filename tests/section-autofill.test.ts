// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenericAdapter, type FormAdapter } from '../src/adapters/generic';
import { WorkdayAdapter } from '../src/adapters/workday';
import { describeFocusedField } from '../src/adapters/field';
import { autofillControl } from '../src/preview/text-preview';
import { filledCount, resetFillTracker, undoAllFills, clearFillHighlights } from '../src/preview/fill-tracker';

const stored: Record<string, unknown> = {
  answers: {
    profile: {
      firstName: 'Alex', lastName: 'Example', city: 'Boston', email: 'alex@example.com',
      school: 'Example University', schoolCity: 'Worcester', degree: "Bachelor's", major: 'Computer Science',
      schoolStartDate: '2020-09-01', schoolEndDate: '2024-05-15', gradYear: '2024',
    },
  },
  workHistory: { jobs: [
    { company: 'Current Co', title: 'Engineer', description: 'Builds things', startDate: '2024-06-01', endDate: '', current: true },
    { company: 'Old Co', title: 'Intern', description: 'Tested things', startDate: '2023-05-15', endDate: '2023-08-15' },
  ] },
};

beforeAll(() => {
  Object.assign(globalThis, {
    browser: {
      storage: { local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])),
        set: async () => undefined,
      } },
      runtime: { sendMessage: async () => ({}) },
    },
  });
  HTMLElement.prototype.getClientRects = function getClientRects(this: HTMLElement) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  };
});

beforeEach(() => { document.body.innerHTML = ''; resetFillTracker(); });
afterEach(() => { document.body.innerHTML = ''; resetFillTracker(); });

const workday = new WorkdayAdapter();
const generic = new GenericAdapter();

async function fillAll(adapter: FormAdapter = workday): Promise<void> {
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
    await autofillControl(input, describeFocusedField(input, adapter));
  }
}

const value = (selector: string) => document.querySelector<HTMLInputElement>(selector)!.value;

/** Workday's date widget: the wrapper label says From/To, each box is labelled only Month or Year. */
function workdayDate(field: string, label: string, parts: Array<'Month' | 'Year'>): string {
  return `<div data-automation-id="formField-${field}"><label data-automation-id="formField-label">${label}</label>
    <div data-automation-id="dateInputWrapper">${parts.map((part) =>
      `<input type="text" role="spinbutton" aria-label="${part}" data-automation-id="dateSection${part}-input" id="${field}-${part}">`).join('')}
    </div></div>`;
}

describe('fields inside repeated sections', () => {
  it('fills only the year in Workday education From/To Year boxes', async () => {
    document.body.innerHTML = `
      <div role="group" aria-labelledby="edu1"><h4 id="edu1">Education 1</h4>
        <div data-automation-id="formField-schoolName"><label data-automation-id="formField-label" for="school">School or University</label><input id="school" type="text"></div>
        ${workdayDate('firstYearAttended', 'From', ['Year'])}
        ${workdayDate('lastYearAttended', 'To (Actual or Expected)', ['Year'])}
      </div>`;
    await fillAll();
    expect(value('#school')).toBe('Example University');
    expect(value('#firstYearAttended-Year')).toBe('2020');
    expect(value('#lastYearAttended-Year')).toBe('2024');
  });

  it('fills a lone Year box under an Education heading as the graduation year', async () => {
    document.body.innerHTML = `<section><h3>Education</h3>
      <label for="deg">Degree</label><input id="deg" type="text">
      <label for="yr">Year</label><input id="yr" type="text"></section>`;
    await fillAll(generic);
    expect(value('#deg')).toBe("Bachelor's");
    expect(value('#yr')).toBe('2024');
  });

  it('uses the Nth saved job for Work Experience N, with month and year split', async () => {
    document.body.innerHTML = `
      <div role="group" aria-labelledby="w2"><h4 id="w2">Work Experience 2</h4>
        <div data-automation-id="formField-jobTitle"><label data-automation-id="formField-label" for="title">Job Title</label><input id="title" type="text"></div>
        <div data-automation-id="formField-companyName"><label data-automation-id="formField-label" for="company">Company</label><input id="company" type="text"></div>
        <div data-automation-id="formField-location"><label data-automation-id="formField-label" for="loc">Location</label><input id="loc" type="text"></div>
        ${workdayDate('startDate', 'From', ['Month', 'Year'])}
        ${workdayDate('endDate', 'To', ['Month', 'Year'])}
      </div>`;
    await fillAll();
    expect(value('#title')).toBe('Intern');
    expect(value('#company')).toBe('Old Co');
    expect(value('#loc')).toBe('');
    expect(value('#startDate-Month')).toBe('05');
    expect(value('#startDate-Year')).toBe('2023');
    expect(value('#endDate-Month')).toBe('08');
    expect(value('#endDate-Year')).toBe('2023');
  });

  it('leaves the end date of a current job blank', async () => {
    document.body.innerHTML = `<div role="group" aria-label="Work Experience 1">
      ${workdayDate('startDate', 'From', ['Month', 'Year'])}
      ${workdayDate('endDate', 'To', ['Month', 'Year'])}</div>`;
    await fillAll();
    expect(value('#startDate-Year')).toBe('2024');
    expect(value('#endDate-Year')).toBe('');
  });

  it('never fills the applicant into a reference or emergency contact', async () => {
    document.body.innerHTML = `<fieldset><legend>References</legend>
      <label for="rn">Full Name</label><input id="rn" type="text">
      <label for="re">Email</label><input id="re" type="email"></fieldset>`;
    await fillAll(generic);
    expect(value('#rn')).toBe('');
    expect(value('#re')).toBe('');
  });

  it('uses the school city inside Education but the home city elsewhere', async () => {
    document.body.innerHTML = `
      <section><h3>Contact information</h3><label for="home">City</label><input id="home" type="text"></section>
      <section><h3>Education</h3><label for="sc">City</label><input id="sc" type="text"></section>`;
    await fillAll(generic);
    expect(value('#home')).toBe('Boston');
    expect(value('#sc')).toBe('Worcester');
  });

  it('does not treat an employer named "University" as an education section', async () => {
    document.body.innerHTML = `<h2>Boston University</h2><label for="fn">First Name</label><input id="fn" type="text">`;
    await fillAll(generic);
    expect(value('#fn')).toBe('Alex');
  });
});

describe('fill highlights and Undo', () => {
  it('outlines filled fields, drops them on Undo, and removes the panel', async () => {
    document.body.innerHTML = `<label for="fn">First Name</label><input id="fn" type="text">
      <label for="ln">Last Name</label><input id="ln" type="text">`;
    await fillAll(generic);
    const first = document.querySelector<HTMLInputElement>('#fn')!;
    expect(first.value).toBe('Alex');
    expect(first.classList.contains('job-autofill-filled')).toBe(true);
    expect(filledCount()).toBe(2);
    expect(document.querySelector('[data-job-autofill-panel]')).not.toBeNull();

    expect(undoAllFills()).toEqual({ undone: 2, left: 0 });
    expect(first.value).toBe('');
    expect(first.classList.contains('job-autofill-filled')).toBe(false);
    expect(document.querySelector('[data-job-autofill-panel]')).toBeNull();
  });

  it('keeps values but clears outlines when review is done', async () => {
    document.body.innerHTML = `<label for="fn">First Name</label><input id="fn" type="text">`;
    await fillAll(generic);
    clearFillHighlights();
    expect(value('#fn')).toBe('Alex');
    expect(document.querySelector('.job-autofill-filled')).toBeNull();
    expect(filledCount()).toBe(0);
  });

  it('does not undo a field the person has since changed', async () => {
    document.body.innerHTML = `<label for="fn">First Name</label><input id="fn" type="text">`;
    await fillAll(generic);
    const input = document.querySelector<HTMLInputElement>('#fn')!;
    input.value = 'Alexandra';
    undoAllFills();
    expect(input.value).toBe('Alexandra');
  });
});
