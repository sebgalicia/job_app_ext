/**
 * Fields inside a repeated form section ("Education 1", "Work Experience 2",
 * "References") mean something different from the same label elsewhere: "City"
 * under Education is the school's city, "Company" under Work Experience 2 is the
 * second job, and "Name" under References is not the applicant. Date boxes are
 * often split into Month / Year parts whose own label is only "Year".
 *
 * This module resolves those fields deterministically from where they sit, before
 * fuzzy wording similarity runs. It returns:
 *   - { kind: 'fill' }    a value formatted for exactly what the box asks for,
 *   - { kind: 'abstain' } the field must be left blank (no safe value),
 *   - undefined           no opinion; ordinary matching may run.
 */

export type SectionKind = 'education' | 'work' | 'person';
export type FieldSection = { kind: SectionKind; index?: number };
export type DatePart = 'year' | 'month' | 'day' | 'monthYear' | 'full';
export type DateBoundary = 'start' | 'end';

export type StructuredFieldInput = {
  question: string;
  questionParts?: string[];
  attributeHints?: string[];
  section?: FieldSection;
  datePart?: DatePart;
  dateBoundary?: DateBoundary;
  placeholder?: string;
  inputType?: string;
  /** True when the control picks from options (select, dropdown, radio). */
  isChoice?: boolean;
};

export type StructuredJob = { company?: string; title?: string; description?: string; startDate?: string; endDate?: string; current?: boolean };
export type StructuredResult = { kind: 'fill'; key: string; value: string; datePart?: DatePart } | { kind: 'abstain'; reason: string };

type Profile = Record<string, string | number | undefined>;

// Headings must START with the section word: "Education 1" or "References" is a
// section, but "Boston University" or "Apply to Harvard" is an employer's name.
const headingPatterns: Array<[SectionKind, RegExp]> = [
  ['person', /^(?:my |your |professional )?(?:references?|referees?|emergency contacts?|next of kin)\b/],
  ['education', /^(?:my |your )?(?:education(?:al)?|academic (?:history|background|record)|schools? attended|degrees?)\b/],
  // Not bare "experience": Workday's whole "My Experience" step also holds skills and websites.
  ['work', /^(?:my |your )?(?:work experience|work history|employment|job history|professional experience|previous employ|employers?\b|experience \d)/],
];

// Machine names (Greenhouse `job_application[educations][0][school_name_id]`,
// Workday `Education-1-panel`) may hold the section word anywhere.
const namePatterns: Array<[SectionKind, RegExp]> = [
  ['person', /\b(?:references?|referees?|emergency)\b/],
  ['education', /\b(?:educations?)\b/],
  ['work', /\b(?:work experiences?|employments|work history|job history)\b/],
];

/**
 * Classify a section heading or container label (`mode: 'heading'`, numbers are 1-based)
 * or a machine name (`mode: 'name'`, bracketed numbers are 0-based array indexes).
 */
export function classifySectionText(raw: string, mode: 'heading' | 'name' = 'heading'): FieldSection | undefined {
  const spaced = splitWords(raw);
  if (!spaced || spaced.length > (mode === 'heading' ? 40 : 160)) return undefined;
  for (const [kind, pattern] of mode === 'heading' ? headingPatterns : namePatterns) {
    if (!pattern.test(spaced)) continue;
    if (mode === 'name') {
      const bracket = raw.match(/\[(\d{1,2})\]/);
      if (bracket) return { kind, index: Number(bracket[1]) + 1 };
    }
    const number = spaced.match(/\b(\d{1,2})\b/);
    const index = number ? Number(number[1]) : undefined;
    return index === undefined ? { kind } : { kind, index: index === 0 ? 1 : index };
  }
  return undefined;
}

/** "firstYearAttended" / "education[0][end_year]" -> "first year attended" / "education 0 end year". */
export function splitWords(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/[_\-[\].:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/** Date part a box asks for, from its type, placeholder, machine names, and short labels. */
export function detectDatePart(input: { inputType?: string; placeholder?: string; attributeHints?: string[]; questionParts?: string[] }): DatePart | undefined {
  if (input.inputType === 'date') return 'full';
  if (input.inputType === 'month') return 'monthYear';
  const placeholder = (input.placeholder ?? '').trim().toLocaleLowerCase('en-US');
  if (/^y{4}$/.test(placeholder)) return 'year';
  if (/^m{1,2}$/.test(placeholder)) return 'month';
  if (/^d{1,2}$/.test(placeholder)) return 'day';
  if (/^m{1,2}\s*[/\-.]\s*y{2,4}$/.test(placeholder)) return 'monthYear';
  if (/^(?:m{1,2}|d{1,2})\s*[/\-.]\s*(?:d{1,2}|m{1,2})\s*[/\-.]\s*y{2,4}$|^y{4}\s*[/\-.]\s*m{1,2}\s*[/\-.]\s*d{1,2}$/.test(placeholder)) return 'full';
  for (const hint of input.attributeHints ?? []) {
    const words = splitWords(hint).split(' ');
    // Workday: dateSectionYear-input / dateSectionMonth-input / dateSectionDay-input.
    if (words.includes('section') && words.includes('date')) {
      if (words.includes('year')) return 'year';
      if (words.includes('month')) return 'month';
      if (words.includes('day')) return 'day';
    }
    const last = words.at(-1);
    if (last === 'year' || last === 'yyyy') return 'year';
    if (last === 'month' || last === 'mm') return 'month';
  }
  for (const part of input.questionParts ?? []) {
    const label = part.trim().toLocaleLowerCase('en-US');
    if (label.length > 40) continue;
    if (/^(?:year|yyyy)$/.test(label) || /\b(?:start|end|graduation|grad|completion|from|to)\s+year$/.test(label) || /^year\s+(?:of\s+)?(?:graduation|completion)$/.test(label)) return 'year';
    if (/^(?:month|mm)$/.test(label) || /\b(?:start|end|from|to)\s+month$/.test(label)) return 'month';
  }
  return undefined;
}

const startWords = /\b(?:from|start|starting|started|begin|began|first|commenced)\b/;
const endWords = /\b(?:to|end|ending|ended|until|through|graduation|graduated|graduate|grad|completion|completed|expected|last|finish|finished)\b/;

/** Whether a date belongs to the start or end of a school or job period. */
export function detectDateBoundary(texts: string[]): DateBoundary | undefined {
  let start = false;
  let end = false;
  for (const text of texts) {
    const words = splitWords(text);
    if (!words || words.length > 60) continue;
    if (startWords.test(words)) start = true;
    if (endWords.test(words)) end = true;
  }
  if (start === end) return undefined;
  return start ? 'start' : 'end';
}

type DateValue = { year?: number; month?: number; day?: number };

const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Parse saved dates: "2024-05-15", "2024-05", "05/2024", "May 2024", or "2024". */
export function parseDateValue(raw: string | number | undefined): DateValue | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  let match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (match) return valid({ year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : undefined });
  match = text.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (match) return valid({ year: Number(match[2]), month: Number(match[1]) });
  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) return valid({ year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) });
  match = text.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (match) {
    const name = match[1].toLocaleLowerCase('en-US');
    const month = monthNames.findIndex((full) => full === name || (name.length >= 3 && full.startsWith(name))) + 1;
    return month > 0 ? valid({ year: Number(match[2]), month }) : undefined;
  }
  match = text.match(/^(\d{4})$/);
  if (match) return valid({ year: Number(match[1]) });
  return undefined;
}

function valid(value: DateValue): DateValue | undefined {
  if (value.year !== undefined && (value.year < 1900 || value.year > 2100)) return undefined;
  if (value.month !== undefined && (value.month < 1 || value.month > 12)) return undefined;
  if (value.day !== undefined && (value.day < 1 || value.day > 31)) return undefined;
  return value;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Format a parsed date for one box. Returns undefined when the saved date lacks a part
 * the box needs (for example a Month box when only the year was saved).
 */
export function formatDatePart(date: DateValue, part: DatePart, placeholder = '', inputType = '', isChoice = false): string | undefined {
  const { year, month, day } = date;
  const hint = placeholder.trim().toLocaleLowerCase('en-US');
  switch (part) {
    case 'year':
      return year === undefined ? undefined : String(year);
    case 'month':
      if (month === undefined) return undefined;
      // Dropdowns usually list month names; chooseDateDropdownOption maps either form.
      return isChoice ? monthNames[month - 1].replace(/^./, (c) => c.toUpperCase()) : pad(month);
    case 'day':
      return day === undefined ? undefined : pad(day);
    case 'monthYear':
      if (year === undefined || month === undefined) return undefined;
      if (inputType === 'month') return `${year}-${pad(month)}`;
      if (/^m{1,2}\s*[/\-.]\s*y{2}$/.test(hint)) return `${pad(month)}/${String(year).slice(2)}`;
      return `${pad(month)}/${year}`;
    case 'full':
      if (year === undefined || month === undefined || day === undefined) return undefined;
      if (inputType === 'date' || /^y{4}/.test(hint)) return `${year}-${pad(month)}-${pad(day)}`;
      if (/^d{1,2}\s*[/\-.]\s*m{1,2}/.test(hint)) return `${pad(day)}/${pad(month)}/${year}`;
      return `${pad(month)}/${pad(day)}/${year}`;
  }
}

function text(value: string | number | undefined): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed || undefined;
}

/** Saved date for one boundary of the main education record, combining split year/month keys. */
function educationDate(profile: Profile, boundary: DateBoundary): { key: string; date: DateValue } | undefined {
  const prefix = boundary === 'start' ? 'schoolStartDate' : 'schoolEndDate';
  const full = parseDateValue(profile[prefix]);
  const year = parseDateValue(profile[`${prefix}Year`])?.year;
  const monthText = text(profile[`${prefix}Month`]);
  const month = monthText ? (Number(monthText) || monthNames.findIndex((name) => name.startsWith(monthText.toLocaleLowerCase('en-US').slice(0, 3))) + 1 || undefined) : undefined;
  if (full) return { key: `profile.${prefix}`, date: { year: full.year ?? year, month: full.month ?? month, day: full.day } };
  if (year !== undefined) return { key: `profile.${prefix}Year`, date: { year, month } };
  if (boundary === 'end') {
    const grad = parseDateValue(profile.gradYear);
    if (grad?.year !== undefined) return { key: 'profile.gradYear', date: { year: grad.year, month } };
  }
  return undefined;
}

// Order matters: "School city" is a city, and "Degree" is checked before "school".
const educationLabels: Array<[RegExp, string]> = [
  [/\bcity\b/, 'schoolCity'],
  [/\bcountry\b/, 'schoolCountry'],
  [/\b(?:gpa|grade point|grade average|overall result)\b/, 'gpa'],
  [/\b(?:field of study|major|discipline|area of study|concentration|program of study)\b/, 'major'],
  [/\bminor\b/, 'minor'],
  [/\b(?:degree|qualification|level of education)\b/, 'degree'],
  [/\b(?:school|university|college|institution)\b/, 'school'],
];

// Order matters: "Role description" is a description, not a title.
const workLabels: Array<[RegExp, keyof StructuredJob]> = [
  [/\b(?:description|responsibilities|duties|summary|achievements)\b/, 'description'],
  [/\b(?:company|employer|organization|organisation|business name)\b/, 'company'],
  [/\b(?:job title|title|position|role)\b/, 'title'],
];

/** Labels inside a section that would otherwise match the applicant's home address or contact details. */
const sectionLocalLabels = /\b(?:city|state|province|country|location|address|zip|postal|phone|email|name)\b/;

function labelText(input: StructuredFieldInput): string {
  // Only the field's own label and machine names: nearby text may belong to a neighbouring field.
  const parts = [input.question, ...(input.attributeHints ?? [])];
  return parts.map(splitWords).filter((part) => part && part.length <= 80).join(' | ');
}

function isDateLabel(input: StructuredFieldInput): boolean {
  if (input.datePart) return true;
  const label = splitWords(input.question);
  return label.length <= 40 && /\b(?:date|dates|from|to|year|month|attended|graduation|start|end)\b/.test(label)
    && !/\b(?:years? of|how many|available|availability|earliest|notice)\b/.test(label);
}

function resolveDate(input: StructuredFieldInput, found: { key: string; date: DateValue } | undefined): StructuredResult {
  if (!found) return { kind: 'abstain', reason: 'no saved date for this part' };
  // Dropdown choices are matched against the raw parts by chooseDateDropdownOption.
  const part = input.datePart ?? (input.isChoice ? undefined : 'full');
  if (!part) {
    const { year, month } = found.date;
    const value = year !== undefined && month !== undefined ? `${year}-${pad(month)}` : year !== undefined ? String(year) : undefined;
    return value ? { kind: 'fill', key: found.key, value } : { kind: 'abstain', reason: 'saved date is empty' };
  }
  const value = formatDatePart(found.date, part, input.placeholder, input.inputType, input.isChoice);
  return value ? { kind: 'fill', key: found.key, value, datePart: part } : { kind: 'abstain', reason: `saved date has no ${part}` };
}

/** Resolve a field from its section and date role, or return undefined to let normal matching run. */
export function resolveStructuredField(input: StructuredFieldInput, profile: Profile = {}, history: StructuredJob[] = []): StructuredResult | undefined {
  const section = input.section;
  const label = labelText(input);
  const dateLike = isDateLabel(input);

  if (section?.kind === 'person') return { kind: 'abstain', reason: 'section is about another person' };

  if (section?.kind === 'education') {
    // Only one education record is saved; later entries stay blank.
    if (section.index !== undefined && section.index > 1) return { kind: 'abstain', reason: 'no saved record for this education entry' };
    if (dateLike) {
      const boundary = input.dateBoundary ?? (/\bgraduat/.test(label) ? 'end' : undefined);
      if (!boundary) return { kind: 'abstain', reason: 'cannot tell start from end date' };
      return resolveDate(input, educationDate(profile, boundary));
    }
    for (const [pattern, key] of educationLabels) {
      if (!pattern.test(label)) continue;
      const value = text(profile[key]);
      return value ? { kind: 'fill', key: `profile.${key}`, value } : { kind: 'abstain', reason: `no saved ${key}` };
    }
    if (sectionLocalLabels.test(label)) return { kind: 'abstain', reason: 'school detail not saved' };
    return undefined;
  }

  if (section?.kind === 'work') {
    const index = section.index ?? (history.length <= 1 ? 1 : undefined);
    const job = index !== undefined ? history[index - 1] : undefined;
    if (dateLike) {
      const boundary = input.dateBoundary;
      if (!boundary || !job) return { kind: 'abstain', reason: job ? 'cannot tell start from end date' : 'no saved job for this entry' };
      if (boundary === 'end' && job.current) return { kind: 'abstain', reason: 'current job has no end date' };
      const date = parseDateValue(boundary === 'start' ? job.startDate : job.endDate);
      return resolveDate(input, date ? { key: `workHistory[${index! - 1}].${boundary}Date`, date } : undefined);
    }
    for (const [pattern, field] of workLabels) {
      if (!pattern.test(label)) continue;
      const value = text(job?.[field] as string | undefined);
      return value ? { kind: 'fill', key: `workHistory[${index! - 1}].${field}`, value } : { kind: 'abstain', reason: `no saved job ${field}` };
    }
    if (sectionLocalLabels.test(label)) return { kind: 'abstain', reason: 'job detail not saved' };
    return undefined;
  }

  // Outside a section, only a date box with a known part needs special handling.
  if (input.datePart && /\bgraduat/.test(label)) return resolveDate(input, educationDate(profile, 'end'));
  return undefined;
}

/** Whether a value fits the date box it is going into, so a full date never lands in a Year box. */
export function fitsDatePart(value: string, part: DatePart | undefined): boolean {
  if (!part) return true;
  const trimmed = value.trim();
  switch (part) {
    case 'year': return /^\d{4}$/.test(trimmed);
    case 'month': return /^(?:0?[1-9]|1[0-2])$/.test(trimmed) || monthNames.some((name) => name.startsWith(trimmed.toLocaleLowerCase('en-US')) && trimmed.length >= 3);
    case 'day': return /^(?:0?[1-9]|[12]\d|3[01])$/.test(trimmed);
    case 'monthYear': return /^(?:\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2})$/.test(trimmed);
    case 'full': return parseDateValue(trimmed)?.day !== undefined || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(trimmed);
  }
}

/** Profile keys that may be filled inside a section by ordinary wording matching. */
export function keyAllowedInSection(key: string, section: FieldSection | undefined): boolean {
  if (!section) return true;
  // Custom saved answers and facts are question-specific, not record-specific.
  if (!key.startsWith('profile.') && !key.startsWith('workHistory[')) return section.kind !== 'person';
  if (section.kind === 'person') return false;
  if (section.kind === 'education') {
    if (section.index !== undefined && section.index > 1) return false;
    return /^profile\.(?:school\w*|degree\w*|major|minor|gpa\w*|gradYear)$/.test(key);
  }
  // Work entries: only that entry's history, or the current-job profile fields for entry 1.
  if (key.startsWith('workHistory[')) {
    const index = Number(key.match(/^workHistory\[(\d+)\]/)?.[1]);
    return section.index === undefined || index === section.index - 1;
  }
  return (section.index === undefined || section.index === 1)
    && /^profile\.(?:currentCompany|currentTitle|employment\w+)$/.test(key);
}
