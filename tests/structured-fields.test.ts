import { describe, expect, it } from 'vitest';
import {
  classifySectionText, detectDateBoundary, detectDatePart, fitsDatePart, formatDatePart,
  keyAllowedInSection, parseDateValue, resolveStructuredField,
} from '../src/matching/structured-fields';

describe('section classification', () => {
  it('reads numbered section headings', () => {
    expect(classifySectionText('Education 1')).toEqual({ kind: 'education', index: 1 });
    expect(classifySectionText('Work Experience 2')).toEqual({ kind: 'work', index: 2 });
    expect(classifySectionText('References')).toEqual({ kind: 'person' });
    expect(classifySectionText('Emergency Contact')).toEqual({ kind: 'person' });
  });

  it('does not mistake an employer name or a whole step for a section', () => {
    expect(classifySectionText('Boston University')).toBeUndefined();
    expect(classifySectionText('Apply to Harvard College')).toBeUndefined();
    expect(classifySectionText('My Experience')).toBeUndefined();
    expect(classifySectionText('My Information')).toBeUndefined();
  });

  it('reads 0-based indexes from machine names', () => {
    expect(classifySectionText('job_application[educations][0][school_name_id]', 'name')).toEqual({ kind: 'education', index: 1 });
    expect(classifySectionText('job_application[employments][1][title]', 'name')).toEqual({ kind: 'work', index: 2 });
    expect(classifySectionText('Education-1-panel', 'name')).toEqual({ kind: 'education', index: 1 });
    expect(classifySectionText('job_application[first_name]', 'name')).toBeUndefined();
  });
});

describe('date parts and boundaries', () => {
  it('detects the part a box asks for', () => {
    expect(detectDatePart({ attributeHints: ['dateSectionYear-input'] })).toBe('year');
    expect(detectDatePart({ attributeHints: ['dateSectionMonth-input'] })).toBe('month');
    expect(detectDatePart({ placeholder: 'YYYY' })).toBe('year');
    expect(detectDatePart({ placeholder: 'MM/YYYY' })).toBe('monthYear');
    expect(detectDatePart({ placeholder: 'MM/DD/YYYY' })).toBe('full');
    expect(detectDatePart({ inputType: 'date' })).toBe('full');
    expect(detectDatePart({ questionParts: ['Graduation Year'] })).toBe('year');
    expect(detectDatePart({ attributeHints: ['education[0][end_year]'] })).toBe('year');
    expect(detectDatePart({ questionParts: ['Years of experience'] })).toBeUndefined();
    expect(detectDatePart({ attributeHints: ['yearsExperience'] })).toBeUndefined();
  });

  it('tells start from end', () => {
    expect(detectDateBoundary(['From', 'Year'])).toBe('start');
    expect(detectDateBoundary(['To (Actual or Expected)', 'Year'])).toBe('end');
    expect(detectDateBoundary(['formField-lastYearAttended'])).toBe('end');
    expect(detectDateBoundary(['Graduation date'])).toBe('end');
    expect(detectDateBoundary(['Year'])).toBeUndefined();
  });

  it('parses and formats saved dates', () => {
    expect(parseDateValue('2024-05-15')).toEqual({ year: 2024, month: 5, day: 15 });
    expect(parseDateValue('05/2024')).toEqual({ year: 2024, month: 5 });
    expect(parseDateValue('May 2024')).toEqual({ year: 2024, month: 5 });
    expect(parseDateValue('2024')).toEqual({ year: 2024 });
    expect(parseDateValue('soon')).toBeUndefined();
    const date = { year: 2024, month: 5, day: 15 };
    expect(formatDatePart(date, 'year')).toBe('2024');
    expect(formatDatePart(date, 'month')).toBe('05');
    expect(formatDatePart(date, 'month', '', '', true)).toBe('May');
    expect(formatDatePart(date, 'monthYear')).toBe('05/2024');
    expect(formatDatePart(date, 'monthYear', '', 'month')).toBe('2024-05');
    expect(formatDatePart(date, 'full', '', 'date')).toBe('2024-05-15');
    expect(formatDatePart(date, 'full', 'DD/MM/YYYY')).toBe('15/05/2024');
    expect(formatDatePart({ year: 2024 }, 'month')).toBeUndefined();
  });

  it('rejects values that do not fit the box', () => {
    expect(fitsDatePart('2024-05-15', 'year')).toBe(false);
    expect(fitsDatePart('2024', 'year')).toBe(true);
    expect(fitsDatePart('May', 'month')).toBe(true);
    expect(fitsDatePart('2024', 'month')).toBe(false);
    expect(fitsDatePart('anything', undefined)).toBe(true);
  });
});

const profile = {
  city: 'Boston', school: 'Example University', schoolCity: 'Worcester', degree: "Bachelor's", major: 'Computer Science',
  schoolStartDate: '2020-09-01', schoolEndDate: '2024-05-15', gradYear: '2024',
};
const history = [
  { company: 'Current Co', title: 'Engineer', startDate: '2024-06-01', endDate: '', current: true },
  { company: 'Old Co', title: 'Intern', startDate: '2023-05-15', endDate: '2023-08-15' },
];

describe('resolveStructuredField', () => {
  it('fills only the year in a Workday education Year box', () => {
    const result = resolveStructuredField({
      question: 'To (Actual or Expected)', attributeHints: ['dateSectionYear-input', 'formField-lastYearAttended'],
      section: { kind: 'education', index: 1 }, datePart: 'year', dateBoundary: 'end',
    }, profile);
    expect(result).toMatchObject({ kind: 'fill', value: '2024' });
    expect(resolveStructuredField({
      question: 'From', section: { kind: 'education', index: 1 }, datePart: 'year', dateBoundary: 'start',
    }, profile)).toMatchObject({ kind: 'fill', value: '2020' });
  });

  it('falls back to gradYear and leaves a Month box blank when only the year is saved', () => {
    const yearOnly = { gradYear: '2025' };
    expect(resolveStructuredField({ question: 'Year', section: { kind: 'education' }, datePart: 'year', dateBoundary: 'end' }, yearOnly))
      .toMatchObject({ kind: 'fill', value: '2025' });
    expect(resolveStructuredField({ question: 'Month', section: { kind: 'education' }, datePart: 'month', dateBoundary: 'end' }, yearOnly))
      .toMatchObject({ kind: 'abstain' });
  });

  it('abstains on an education date when start versus end is unclear', () => {
    expect(resolveStructuredField({ question: 'Year', section: { kind: 'education' }, datePart: 'year' }, profile))
      .toMatchObject({ kind: 'abstain' });
  });

  it('uses the school city, never the home city, inside Education', () => {
    expect(resolveStructuredField({ question: 'City', section: { kind: 'education', index: 1 } }, profile))
      .toMatchObject({ kind: 'fill', key: 'profile.schoolCity', value: 'Worcester' });
    expect(resolveStructuredField({ question: 'State', section: { kind: 'education', index: 1 } }, profile))
      .toMatchObject({ kind: 'abstain' });
    expect(resolveStructuredField({ question: 'Degree', section: { kind: 'education', index: 1 } }, profile))
      .toMatchObject({ kind: 'fill', value: "Bachelor's" });
  });

  it('leaves a second education entry blank', () => {
    expect(resolveStructuredField({ question: 'School or University', section: { kind: 'education', index: 2 } }, profile))
      .toMatchObject({ kind: 'abstain' });
  });

  it('maps Work Experience N to the Nth saved job', () => {
    expect(resolveStructuredField({ question: 'Company', section: { kind: 'work', index: 2 } }, profile, history))
      .toMatchObject({ kind: 'fill', value: 'Old Co' });
    expect(resolveStructuredField({ question: 'Role Description', section: { kind: 'work', index: 2 } }, profile, history))
      .toMatchObject({ kind: 'abstain' });
    expect(resolveStructuredField({ question: 'From', section: { kind: 'work', index: 2 }, datePart: 'month', dateBoundary: 'start' }, profile, history))
      .toMatchObject({ kind: 'fill', value: '05' });
    expect(resolveStructuredField({ question: 'To', section: { kind: 'work', index: 1 }, datePart: 'year', dateBoundary: 'end' }, profile, history))
      .toMatchObject({ kind: 'abstain' });
    expect(resolveStructuredField({ question: 'Job Title', section: { kind: 'work', index: 3 } }, profile, history))
      .toMatchObject({ kind: 'abstain' });
  });

  it('never fills fields about another person', () => {
    expect(resolveStructuredField({ question: 'Full Name', section: { kind: 'person' } }, profile)).toMatchObject({ kind: 'abstain' });
  });

  it('has no opinion outside sections unless the box is a date part', () => {
    expect(resolveStructuredField({ question: 'City' }, profile)).toBeUndefined();
    expect(resolveStructuredField({ question: 'Graduation Year', datePart: 'year' }, profile)).toMatchObject({ kind: 'fill', value: '2024' });
  });
});

describe('keyAllowedInSection', () => {
  it('limits wording matches to keys that belong to the section', () => {
    expect(keyAllowedInSection('profile.city', { kind: 'education', index: 1 })).toBe(false);
    expect(keyAllowedInSection('profile.major', { kind: 'education', index: 1 })).toBe(true);
    expect(keyAllowedInSection('profile.currentCompany', { kind: 'work', index: 2 })).toBe(false);
    expect(keyAllowedInSection('workHistory[1].title', { kind: 'work', index: 2 })).toBe(true);
    expect(keyAllowedInSection('workHistory[0].title', { kind: 'work', index: 2 })).toBe(false);
    expect(keyAllowedInSection('answers[3]', { kind: 'work', index: 2 })).toBe(true);
    expect(keyAllowedInSection('answers[3]', { kind: 'person' })).toBe(false);
    expect(keyAllowedInSection('profile.city', undefined)).toBe(true);
  });
});
