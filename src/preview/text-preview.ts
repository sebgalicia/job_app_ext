import { defaultThresholds, matchQuestion, scoreSimilarity, validThresholds, type MatchCandidate, type Thresholds } from '../matching/matcher';
import { normalizeText } from '../matching/normalize';
import { chooseFactOption, detectPolarity, type ChoiceOption } from '../matching/polarity';
import { ariaComboboxOptions, choiceWidgetExpanded, isChoiceWidget, type DetectedField } from '../adapters/field';

type StoredAnswers = {
  profile?: Record<string, string | number | undefined>;
  profileAlternates?: Record<string, string[] | undefined>;
  profileQuestions?: Record<string, string[] | undefined>;
  facts?: Record<string, string | number | boolean | undefined>;
  answers?: Array<{ questions: string[]; type: 'text' | 'choice' | 'yesno'; answer: string | boolean; sensitive?: boolean }>;
};

type StorageBrowser = {
  storage: { local: {
    get(key: string | string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  } };
  runtime: { sendMessage(message: Record<string, unknown>): Promise<unknown> };
};
type PreviewField = HTMLInputElement | HTMLTextAreaElement;
type PreviewTarget = HTMLElement;
type SelectChoice = ChoiceOption & { element: HTMLElement };
type PageContext = { company?: string; role?: string };

const profileQuestions: Record<string, string[]> = {
  firstName: ['first name', 'given name', 'your first name'],
  middleName: ['middle name', 'middle initial'],
  lastName: ['last name', 'family name', 'surname'],
  preferredName: ['preferred name', 'name you go by', 'chosen name'],
  email: ['email address', 'email'],
  phone: ['phone number', 'telephone number', 'mobile number'],
  phoneDeviceType: ['phone type', 'phone device type', 'phone category'],
  pronouns: ['pronouns', 'preferred pronouns'],
  address: ['street address', 'address line one', 'mailing address'],
  addressLine2: ['address line two', 'apartment', 'suite', 'unit number'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip code', 'postal code'],
  country: ['country', 'country of residence'],
  currentLocation: ['current location', 'current city', 'city and country'],
  linkedin: ['linkedin profile', 'linkedin url', 'linkedin link', 'link to linkedin'],
  github: ['github profile', 'github url', 'github link', 'link to github'],
  website: ['personal website', 'portfolio url', 'website'],
  portfolio: ['portfolio', 'portfolio website', 'portfolio url'],
  school: ['school', 'school name', 'name of school', 'university', 'college', 'educational institution', 'institution attended'],
  schoolCity: ['school city', 'city of school', 'institution city'],
  schoolCountry: ['school country', 'country of school', 'institution country'],
  degree: ['degree', 'degree type', 'degree level', 'degree earned', 'credential earned'],
  degreeReceived: ['degree received', 'degree completed', 'did you graduate', 'graduated'],
  major: ['major', 'field of study', 'area of study', 'discipline'],
  minor: ['minor', 'minor field of study'],
  gpa: ['gpa', 'grade point average', 'grade average', 'cumulative average'],
  gpaScale: ['gpa scale', 'grading scale', 'maximum gpa'],
  schoolStartDate: ['school start date', 'education start date', 'first year attended', 'start date of attendance', 'school start month', 'school start year', 'education start month', 'education start year', 'attendance start month', 'attendance start year'],
  schoolEndDate: ['school end date', 'education end date', 'last year attended', 'end date of attendance', 'school end month', 'school end year', 'education end month', 'education end year', 'attendance end month', 'attendance end year'],
  schoolStartDateMonth: ['school start month', 'school start date month', 'education start month', 'attendance start month', 'start date month'],
  schoolStartDateYear: ['school start year', 'school start date year', 'education start year', 'attendance start year', 'start date year', 'first year attended'],
  schoolEndDateMonth: ['school end month', 'school end date month', 'education end month', 'attendance end month', 'end date month'],
  schoolEndDateYear: ['school end year', 'school end date year', 'education end year', 'attendance end year', 'end date year', 'last year attended'],
  gradYear: ['graduation year', 'year of graduation', 'degree year'],
  currentCompany: ['current company', 'current employer', 'employer name', 'company name'],
  currentTitle: ['current title', 'current role', 'job title', 'position title', 'occupation'],
  yearsExperience: ['years of experience', 'years experience', 'total experience', 'relevant experience'],
  employmentStartDate: ['employment start date', 'job start date', 'date started'],
  employmentEndDate: ['employment end date', 'job end date', 'date ended'],
  employmentDescription: ['job description', 'role description', 'responsibilities', 'work experience description'],
  availableStartDate: ['available start date', 'earliest start date', 'when can you start', 'availability date'],
  noticePeriod: ['notice period', 'required notice', 'length of notice'],
  preferredWorkLocation: ['preferred work location', 'preferred office location', 'location preference'],
  skills: ['skills', 'relevant skills', 'technical skills'],
  certifications: ['certifications', 'professional certifications', 'licenses'],
  languages: ['languages', 'language skills', 'languages spoken'],
  references: ['references', 'professional references', 'reference contact'],
  professionalSummary: ['professional summary', 'career summary', 'professional profile', 'about you'],
};

const autocompleteProfileKey: Record<string, string> = {
  'given-name': 'firstName', 'family-name': 'lastName', email: 'email', tel: 'phone',
  'address-line1': 'address', 'address-level2': 'city', 'address-level1': 'state',
  'postal-code': 'zip', 'country-name': 'country',
};
const previewableInputTypes = new Set(['text', 'email', 'tel', 'url', 'search', 'number', 'date']);

let activePreview: { field: PreviewTarget; cleanup: () => void } | undefined;

export function resolvePlaceholders(
  template: string,
  context: { company?: string; role?: string },
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{(company|role)\}/gi, (_match, rawName: string) => {
    const name = rawName.toLowerCase() as 'company' | 'role';
    const value = context[name]?.trim();
    if (value) return value;
    missing.push(name);
    return `[${name} missing]`;
  });
  return { text, missing: [...new Set(missing)] };
}

function resolveQuestionPlaceholders(question: string, context: PageContext): string {
  return question.replace(/\{(company|role)\}/gi, (_match, rawName: string) => {
    return context[rawName.toLowerCase() as 'company' | 'role']?.trim() || `{${rawName.toLowerCase()}}`;
  });
}

function cleanContextLabel(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').replace(/^[-|:\u2013\u2014\u00b7\s]+|[-|:\u2013\u2014\u00b7\s]+$/g, '')
    .replace(/\s+(?:job application|application)$/i, '').trim();
  if (!cleaned || cleaned.length > 140 || /^(careers?|jobs?|job application|application|apply(?:\s+now|\s+to\b.*)?|open positions|search jobs)$/i.test(cleaned)) return undefined;
  return cleaned;
}

function jsonLdJobPostings(): Array<Record<string, unknown>> {
  const postings: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
    if (types.some((type) => typeof type === 'string' && type.toLocaleLowerCase() === 'jobposting')) postings.push(record);
    if (record['@graph']) visit(record['@graph']);
    if (record.itemListElement) visit(record.itemListElement);
  };

  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try { visit(JSON.parse(script.textContent ?? '')); } catch { /* Ignore malformed site metadata. */ }
  }
  return postings;
}

function structuredCompanyName(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanContextLabel(value);
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' ? cleanContextLabel(name) : undefined;
  }
  return undefined;
}

function pageCompanyFromUrl(): string | undefined {
  const host = location.hostname.toLocaleLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return undefined;
  let slug: string | undefined;
  if (host.endsWith('.myworkdayjobs.com')) slug = host.split('.')[0];
  else if (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com'].includes(host)) {
    slug = location.pathname.split('/').filter(Boolean)[0];
  } else if (host.endsWith('.smartrecruiters.com')) slug = location.pathname.split('/').filter(Boolean)[0];
  if (slug && !/^(jobs?|careers?|apply|external|en-us)$/i.test(slug)) {
    let decodedSlug = slug;
    try { decodedSlug = decodeURIComponent(slug); } catch { /* Keep the literal URL segment. */ }
    return cleanContextLabel(decodedSlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()));
  }

  const ignoredDomains = /^(?:www|jobs?|careers?|apply|boards|job-boards|myworkdayjobs|myworkday|greenhouse|lever|ashbyhq|smartrecruiters|icims|taleo|workday|indeed|linkedin|ziprecruiter)$/i;
  const labels = host.split('.').filter(Boolean);
  let index = labels.length - 2;
  if (/^(?:co|com|org|net|gov|edu)$/i.test(labels[index] ?? '') && index > 0) index -= 1;
  const domainLabel = labels[index];
  if (!domainLabel || ignoredDomains.test(domainLabel)) return undefined;
  return cleanContextLabel(domainLabel.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()));
}

export function detectPageContext(): { company?: string; role?: string } {
  const postings = jsonLdJobPostings();
  const posting = postings[0];
  const postingOrg = posting?.hiringOrganization;
  const structuredCompany = structuredCompanyName(postingOrg);
  const structuredRole = typeof posting?.title === 'string' ? cleanContextLabel(posting.title) : undefined;
  const headingSelector = 'h1, [itemprop="title"], [data-automation-id*="jobPostingHeader"], [data-testid*="job-title" i], [data-testid*="jobTitle" i]';
  const heading = Array.from(document.querySelectorAll<HTMLElement>(headingSelector))
    .map((element) => cleanContextLabel(element.textContent ?? undefined))
    .find((candidate) => Boolean(candidate && !/^(careers?|jobs?|application|apply now)$/i.test(candidate)));
  const title = cleanContextLabel(document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content || document.title);
  const atMatch = [title, heading].flatMap((candidate) => {
    const match = candidate?.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+(?:careers?|jobs?|application)\b.*)?$/i);
    return match ? [match] : [];
  })[0];
  const titleParts = title?.split(/\s+[|\u2013\u2014\u00b7]\s+|\s+-\s+/).map(cleanContextLabel).filter((part): part is string => Boolean(part)) ?? [];
  const genericCompanyNames = /^(?:workday|greenhouse|lever|ashby|ashbyhq|smartrecruiters|icims|taleo|indeed|linkedin|careers?)$/i;
  const explicitCompany = Array.from(document.querySelectorAll<HTMLElement>(
    '[itemprop="hiringOrganization"] [itemprop="name"], [itemprop="hiringOrganization"], [data-testid*="company-name" i], [class*="company-name" i]',
  )).map((element) => cleanContextLabel(element.textContent ?? undefined))
    .find((candidate) => candidate && !genericCompanyNames.test(candidate));
  const siteName = cleanContextLabel(document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content
    ?? document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content);
  const headingIsGeneric = !heading || /^(apply|application|careers?|job application)$/i.test(heading);
  const titleRole = atMatch?.[1]?.trim();
  const companyAt = cleanContextLabel(atMatch?.[2]);
  const companyFromTitle = titleParts.length > 1 ? titleParts.at(-1) : undefined;
  const company = structuredCompany
    || explicitCompany
    || (siteName && !genericCompanyNames.test(siteName) ? siteName : undefined)
    || companyAt
    || (companyFromTitle && genericCompanyNames.test(companyFromTitle) ? undefined : companyFromTitle)
    || pageCompanyFromUrl();
  const role = structuredRole
    || (!headingIsGeneric ? heading : undefined)
    || cleanContextLabel(titleRole)
    || titleParts.find((part) => !genericCompanyNames.test(part) && !/^(careers?|jobs?|application|apply now)$/i.test(part));
  return { company, role };
}

const reportedMatches = new WeakSet<HTMLElement>();

function pageContextKey(): string {
  return `${location.hostname}${location.pathname}`;
}

export function reportMatchedField(field: PreviewTarget): void {
  const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
  const controls: HTMLElement[] = [field];
  if (field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type) && field.name) {
    controls.push(...Array.from((field.form ?? field.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="${field.type}"]`))
      .filter((input) => input.name === field.name));
  }
  if (controls.some((control) => reportedMatches.has(control))) return;
  controls.forEach((control) => reportedMatches.add(control));
  void browserApi.runtime.sendMessage({ type: 'field-matched' }).catch(() => undefined);
}

export function dismissActivePreview(): void {
  clearActivePreview();
}

export async function saveDetectedPageContext(): Promise<void> {
  try {
    const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
    const detected = detectPageContext();
    if (!detected.company && !detected.role) return;
    const stored = await browserApi.storage.local.get('detectedPageContexts');
    const contexts = (stored.detectedPageContexts as Record<string, { company?: string; role?: string }> | undefined) ?? {};
    const key = pageContextKey();
    const previous = contexts[key] ?? {};
    const next = { company: detected.company || previous.company, role: detected.role || previous.role };
    if (next.company === previous.company && next.role === previous.role) return;
    contexts[key] = next;
    await browserApi.storage.local.set({ detectedPageContexts: contexts });
  } catch {
    // Page context is a convenience; a read/write failure must not affect form use.
  }
}

async function previewContext(stored: Record<string, unknown>): Promise<{ company?: string; role?: string }> {
  const overrides = stored.jobContextOverrides as Record<string, { company?: string; role?: string }> | undefined;
  const detected = stored.detectedPageContexts as Record<string, { company?: string; role?: string }> | undefined;
  const current = pageContextKey();
  const fallback = { ...detectPageContext(), ...detected?.[current] };
  const override = overrides?.[current];
  return {
    company: override?.company?.trim() || fallback.company,
    role: override?.role?.trim() || fallback.role,
  };
}

function profileCandidates(
  profile: StoredAnswers['profile'],
  customQuestions?: StoredAnswers['profileQuestions'],
  context: PageContext = {},
): MatchCandidate[] {
  return Object.entries(profile ?? {}).flatMap(([key, value]) => {
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    if (!String(value).trim()) return [];
    const inferredKeyLabel = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();
    const labels = [...(profileQuestions[key] ?? []), ...(customQuestions?.[key] ?? [])]
      .map((label) => resolveQuestionPlaceholders(label, context));
    if (labels.length === 0) labels.push(inferredKeyLabel);
    return [{ key: `profile.${key}`, questions: labels }];
  });
}

function makeCandidates(answers: StoredAnswers, context: PageContext = {}): { candidates: MatchCandidate[]; answerByKey: Map<string, string>; sensitiveByKey: Set<string> } {
  const candidates = profileCandidates(answers.profile, answers.profileQuestions, context);
  const answerByKey = new Map<string, string>();
  const sensitiveByKey = new Set<string>();
  for (const [index, entry] of (answers.answers ?? []).entries()) {
    if (entry.type !== 'text' || typeof entry.answer !== 'string' || !entry.answer.trim()) continue;
    const key = `answers[${index}]`;
    candidates.push({ key, questions: entry.questions.map((question) => resolveQuestionPlaceholders(question, context)) });
    answerByKey.set(key, entry.answer);
      if (entry.sensitive || /sponsor|visa|authori[sz]|eligible|salary|compensation|demograph|race|gender|disability/i.test(entry.questions.join(' '))) {
      sensitiveByKey.add(key);
    }
  }
  for (const [key, value] of Object.entries(answers.profile ?? {})) {
    if (profileQuestions[key] && (typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      answerByKey.set(`profile.${key}`, String(value));
    }
  }
  return { candidates, answerByKey, sensitiveByKey };
}

function profileTypeHint(field: DetectedField): string | undefined {
  const token = field.autocomplete?.trim().split(/\s+/).at(-1);
  return (token && autocompleteProfileKey[token])
    ?? (field.inputType === 'email' ? 'email' : field.inputType === 'tel' ? 'phone' : undefined);
}

function datePartForQuestion(key: string, value: string, question: string): string {
  if (!['schoolStartDate', 'schoolEndDate', 'employmentStartDate', 'employmentEndDate', 'availableStartDate'].includes(key)) return value;
  const asksMonth = /\bmonth\b/i.test(question);
  const asksYear = /\byear\b/i.test(question);
  if (!asksMonth && !asksYear) return value;

  // Dates in answers use ISO format. Split them when an application asks for
  // separate month and year dropdowns instead of one date field.
  const iso = value.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (iso) {
    if (asksYear) return iso[1];
    const month = Number(iso[2]);
    return Number.isInteger(month) && month >= 1 && month <= 12
      ? new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)))
      : value;
  }
  const year = value.match(/\b(?:19|20)\d{2}\b/);
  if (asksYear && year) return year[0];
  if (asksMonth) {
    const month = value.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
    if (month) return month[0];
  }
  return value;
}

function nativeSetValue(field: PreviewField, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function setChoiceValue(target: HTMLElement, choice: SelectChoice): boolean {
  if (isChoiceWidget(target)) {
    if (!choiceWidgetExpanded(target) || !choice.element.isConnected) return false;
    choice.element.click();
    dispatchNativeChoiceChange(target);
    return true;
  }
  if (target instanceof HTMLSelectElement) {
    if (choice.element instanceof HTMLOptionElement && choice.element.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(target, choice.value ?? (choice.element instanceof HTMLOptionElement ? choice.element.value : ''));
    dispatchNativeChoiceChange(target);
    return true;
  }
  if (target instanceof HTMLInputElement && ['radio', 'checkbox'].includes(target.type)) {
    const chosen = choice.element as unknown as HTMLInputElement;
    if (chosen.disabled || !chosen.isConnected) return false;
    chosen.checked = true;
    dispatchNativeChoiceChange(chosen);
    return true;
  }
  return false;
}

/** Fill one blank, supported control when its answer match is at least Medium confidence. */
export async function autofillControl(target: HTMLElement, descriptor: DetectedField): Promise<boolean> {
  if (!target.isConnected || target.matches(':disabled, [readonly]') || target.closest('[hidden], [aria-hidden="true"]')) return false;
  try {
    const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
    // A closed autocomplete has no selectable options yet; leave it alone in
    // one-pass mode instead of inserting text that may not select an option.
    if (isChoiceWidget(target) && !choiceWidgetExpanded(target)) return false;
    const isText = !isChoiceWidget(target)
      && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
    if (isText) {
      if (target.value.trim().length > 0 || (target instanceof HTMLInputElement && !previewableInputTypes.has(target.type))) return false;
    const stored = await browserApi.storage.local.get(['answers', 'jobContextOverrides', 'detectedPageContexts', 'matchingThresholds']);
      if (!target.isConnected || target.value.length > 0) return false;
      const answers = stored.answers as StoredAnswers | undefined;
      if (!answers) return false;
      const thresholds = validThresholds(stored.matchingThresholds);
      const context = await previewContext(stored);
      const { candidates, answerByKey } = makeCandidates(answers, context);
      const hint = profileTypeHint(descriptor);
      const hintedKey = hint ? `profile.${hint}` : undefined;
      const candidatesWithHints = candidates.map((candidate) => ({
        ...candidate,
        questions: candidate.key === hintedKey ? [...candidate.questions, descriptor.question] : candidate.questions,
      }));
      const match = matchQuestion(descriptor.question, candidatesWithHints, thresholds);
      if (!match.bestKey || match.confidence === 'none') return false;
      const answer = answerByKey.get(match.bestKey);
      if (answer === undefined) return false;
      const resolved = resolvePlaceholders(answer, context);
      if (resolved.missing.length > 0 || !resolved.text.trim() || !target.isConnected || target.value.length > 0) return false;
      nativeSetValue(target, resolved.text);
      reportMatchedField(target);
      return true;
    }

    if (hasRealChoice(target)) return false;
      const stored = await browserApi.storage.local.get(['answers', 'jobContextOverrides', 'detectedPageContexts', 'matchingThresholds']);
    if (!target.isConnected || hasRealChoice(target)) return false;
    const answers = stored.answers as StoredAnswers | undefined;
    if (!answers) return false;
    const context = await previewContext(stored);
    const choice = getStoredChoice(descriptor.question, focusedChoices(target), answers, validThresholds(stored.matchingThresholds), context);
    if (!choice || !setChoiceValue(target, choice.option)) return false;
    reportMatchedField(target);
    return true;
  } catch {
    // A storage or page-control failure must not stop the rest of the one-time sweep.
    return false;
  }
}

function agreementPromptText(target: HTMLElement, descriptor: DetectedField): string {
  const parts = [...descriptor.questionParts, descriptor.question];
  const wrapper = target.closest<HTMLElement>(
    'label, fieldset, [role="group"], .field, .application-question, [data-qa="question"], [data-testid*="question" i], [data-automation-id="formField"], [data-automation-id="question"]',
  );
  const wrapperText = wrapper?.textContent?.replace(/\s+/g, ' ').trim();
  if (wrapperText && wrapperText.length <= 2000) parts.push(wrapperText);
  return parts.join(' ');
}

function isAgreementPrompt(question: string): boolean {
  const termsOrPolicy = /\b(?:terms?\s+(?:of service|and conditions)|privacy policy|end[- ]user license agreement)\b/i.test(question);
  const factualAcknowledgment = /\backnowledg(?:e|ment)\b/i.test(question)
    && /\b(?:read|understood|reviewed|truthfully|accurately|above questions)\b/i.test(question);
  return termsOrPolicy || factualAcknowledgment;
}

function isAffirmativeAgreementLabel(label: string): boolean {
  const normalized = label.toLocaleLowerCase().replace(/[’']/g, '').replace(/[.,:;!]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:yes|yes i agree(?: to .+)?|yes i accept(?: .+)?|yes i acknowledge(?: that .+)?|i have read and agree(?: to .+)?|i have read and accept(?: .+)?|i agree(?: to .+)?|agree(?: to .+)?|i accept(?: .+)?|accept(?: .+)?|i acknowledge(?: that .+)?|acknowledge(?: that .+)?|i consent(?: .+)?|consent(?: .+)?)$/i.test(normalized);
}

/** Opt-in helper: select only a clear affirmative control on an agreement prompt. */
function setAgreementText(target: HTMLElement, value: string): boolean {
  if (target instanceof HTMLInputElement) {
    if (!['text', 'search', 'date'].includes(target.type) || target.value.trim()) return false;
  } else if (target instanceof HTMLTextAreaElement) {
    if (target.value.trim()) return false;
  } else return false;
  nativeSetValue(target, value);
  reportMatchedField(target);
  return true;
}

function localDateValue(question: string, field: HTMLInputElement): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  if (field.type === 'date' || /\byyyy\s*[-/]\s*mm\s*[-/]\s*dd\b/i.test(`${question} ${field.placeholder}`)) return `${year}-${month}-${day}`;
  if (/\bdd\s*[-/.]\s*mm\s*[-/.]\s*yyyy\b/i.test(`${question} ${field.placeholder}`)) return `${day}/${month}/${year}`;
  if (/\bmm\s*[-/.]\s*dd\s*[-/.]\s*yyyy\b/i.test(`${question} ${field.placeholder}`)) return `${month}/${day}/${year}`;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Opt-in helper: accept clear agreement prompts and fill their explicit signature/date fields. */
export async function autoAgreeTermsControl(target: HTMLElement, descriptor: DetectedField): Promise<boolean> {
  if (!target.isConnected) return false;
  const prompt = agreementPromptText(target, descriptor);
  const agreementPrompt = isAgreementPrompt(prompt);
  const fieldLabel = descriptor.questionParts.join(' ') || descriptor.question;
  const signatureField = /\b(?:signature|sign your name|digitally sign|electronic signature|e-signature|name to sign|name as (?:your )?(?:electronic )?signature|(?:type|enter) (?:your )?(?:full |legal )?name.{0,24}\bsign)\b/i.test(fieldLabel);
  const signedDateField = /\b(?:date signed|signed date|signature date|date of (?:your )?signature|date of acknowledgment|acknowledgment date|date you signed)\b/i.test(fieldLabel)
    || (/\bdate\b/i.test(fieldLabel) && (agreementPrompt || /\bsignature\b/i.test(prompt)));
  const explicitlyRelatedField = agreementPrompt || signatureField || signedDateField;
  if (!explicitlyRelatedField) return false;

  if (agreementPrompt && !hasRealChoice(target)) {
    const affirmative = focusedChoices(target).filter((option) => isAffirmativeAgreementLabel(option.label));
    if (affirmative.length === 1 && setChoiceValue(target, affirmative[0])) {
      reportMatchedField(target);
      return true;
    }

    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const label = target.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (isAffirmativeAgreementLabel(label)) {
        target.checked = true;
        dispatchNativeChoiceChange(target);
        reportMatchedField(target);
        return true;
      }
    }

    const explicitYesInstruction = /\b(?:enter|type)\s+["“']?yes\b/i.test(prompt);
    if (explicitYesInstruction && (target instanceof HTMLTextAreaElement
      || (target instanceof HTMLInputElement && ['text', 'search'].includes(target.type)))) {
      return setAgreementText(target, 'yes');
    }
  }

  if (signatureField && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
    const stored = await browserApi.storage.local.get('answers');
    const profile = (stored.answers as StoredAnswers | undefined)?.profile;
    const legalName = [profile?.firstName, profile?.middleName, profile?.lastName]
      .map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
    const name = legalName || String(profile?.preferredName ?? '').trim();
    if (name) return setAgreementText(target, name);
  }

  if (signedDateField && target instanceof HTMLInputElement) {
    return setAgreementText(target, localDateValue(prompt, target));
  }
  return false;
}

function clearActivePreview(): void {
  activePreview?.cleanup();
  activePreview = undefined;
}

export function isPlaceholderOption(label: string, value: string): boolean {
  return value.trim() === '' || /^(?:select\b|choose\b|please select\b|--+)\s*.*$/i.test(label.trim());
}

export function chooseTextOption<T extends ChoiceOption>(answer: string, options: T[]): T | undefined {
  const scored = options.map((option) => ({
    option,
    score: Math.max(scoreSimilarity(answer, option.label), scoreSimilarity(answer, option.value ?? '')),
  })).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score < defaultThresholds.high) return undefined;
  if (scored[1] && scored[0].score - scored[1].score < 0.08) return undefined;
  return scored[0].option;
}

export function chooseGeneralizedOption<T extends ChoiceOption>(answer: string, options: T[]): T | undefined {
  const answerTokens = new Set(normalizeText(answer));
  if (answerTokens.size === 0) return undefined;
  const broaderOptions = options.map((option) => {
    const labelTokens = normalizeText(option.label);
    const valueTokens = normalizeText(option.value ?? '');
    const labelFits = labelTokens.length > 0 && labelTokens.every((token) => answerTokens.has(token));
    const valueFits = valueTokens.length > 0 && valueTokens.every((token) => answerTokens.has(token));
    return { option, specificity: Math.max(labelFits ? labelTokens.length : 0, valueFits ? valueTokens.length : 0) };
  }).filter((candidate) => candidate.specificity > 0).sort((a, b) => b.specificity - a.specificity);
  if (!broaderOptions[0] || broaderOptions[1]?.specificity === broaderOptions[0].specificity) return undefined;
  return broaderOptions[0].option;
}

function chooseClosestGeneralizedOption<T extends ChoiceOption>(answer: string, options: T[]): T | undefined {
  const scored = options.map((option) => ({
    option,
    score: Math.max(scoreSimilarity(answer, option.label), scoreSimilarity(answer, option.value ?? '')),
  })).sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best || best.score < defaultThresholds.medium) return undefined;
  if (scored[1] && best.score - scored[1].score < 0.08) return undefined;
  return best.option;
}

export function chooseSavedAnswerOption<T extends ChoiceOption>(
  answer: string,
  options: T[],
  questionScore: number,
  runnerUpScore: number,
  alternates: string[] = [],
): T | undefined {
  const values = [...new Set([answer, ...alternates].map((value) => value.trim()).filter(Boolean))];
  const directOptions = values.flatMap((value) => {
    const option = chooseTextOption(value, options);
    return option ? [option] : [];
  });
  const uniqueDirectOptions = [...new Map(directOptions.map((option) => [option.value ?? option.label, option])).values()];
  if (uniqueDirectOptions.length === 1) return uniqueDirectOptions[0];
  if (uniqueDirectOptions.length > 1) return undefined;
  const veryHighQuestionConfidence = questionScore >= 0.85 && questionScore - runnerUpScore >= 0.08;
  if (!veryHighQuestionConfidence) return undefined;
  const generalizedOptions = values.flatMap((value) => {
    const option = chooseGeneralizedOption(value, options);
    return option ? [option] : [];
  });
  const uniqueGeneralizedOptions = [...new Map(generalizedOptions.map((option) => [option.value ?? option.label, option])).values()];
  if (uniqueGeneralizedOptions.length === 1) return uniqueGeneralizedOptions[0];
  if (uniqueGeneralizedOptions.length > 1) return undefined;

  // Fuzzy option matching is a generalized answer: only try it when the
  // question itself passes the existing very-high-confidence and margin gate.
  const closestOptions = values.flatMap((value) => {
    const option = chooseClosestGeneralizedOption(value, options);
    return option ? [option] : [];
  });
  const uniqueClosestOptions = [...new Map(closestOptions.map((option) => [option.value ?? option.label, option])).values()];
  return uniqueClosestOptions.length === 1 ? uniqueClosestOptions[0] : undefined;
}

function focusedChoices(target: HTMLElement): SelectChoice[] {
  if (isChoiceWidget(target)) {
    return ariaComboboxOptions(target).map((option) => {
      const label = (option.getAttribute('aria-label') || option.textContent || '').replace(/\s+/g, ' ').trim();
      return { label, value: option.getAttribute('data-value') || option.getAttribute('value') || label, element: option };
    }).filter((option) => Boolean(option.label) && !isPlaceholderOption(option.label, option.value ?? ''));
  }
  if (target instanceof HTMLSelectElement) {
    return Array.from(target.options)
      .filter((option) => !option.disabled && !isPlaceholderOption(option.label || option.textContent || '', option.value))
      .map((option) => ({ label: (option.label || option.textContent || '').trim(), value: option.value, element: option }));
  }
  if (!(target instanceof HTMLInputElement) || !['radio', 'checkbox'].includes(target.type)) return [];
  const type = target.type;
  const controls = target.name
    ? Array.from((target.form ?? target.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)).filter((input) => input.name === target.name)
    : [target];
  return controls.map((input) => {
    const label = input.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() || input.value;
    return { label, value: input.value, element: input as unknown as HTMLOptionElement };
  }).filter((option) => Boolean(option.label));
}

function hasRealChoice(target: HTMLElement): boolean {
  if (isChoiceWidget(target)) {
    const explicitValue = (target.getAttribute('aria-valuetext') || target.getAttribute('data-value') || '').trim();
    if (explicitValue && !isPlaceholderOption(explicitValue, 'has-value')) return true;
    // While open, an input's text is a search query, not a committed choice.
    if (choiceWidgetExpanded(target)) return false;
    if (target instanceof HTMLInputElement) return target.value.trim().length > 0;
    const currentValue = (target.textContent || '').trim();
    return Boolean(currentValue && !isPlaceholderOption(currentValue, 'has-value'));
  }
  if (target instanceof HTMLSelectElement) {
    const selected = target.selectedOptions[0];
    return Boolean(selected && !isPlaceholderOption(selected.label || selected.textContent || '', selected.value));
  }
  if (!(target instanceof HTMLInputElement) || !['radio', 'checkbox'].includes(target.type)) return false;
  const type = target.type;
  const controls = target.name
    ? Array.from((target.form ?? target.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)).filter((input) => input.name === target.name)
    : [target];
  return controls.some((input) => input.checked);
}

function matchStoredEntry(question: string, answers: StoredAnswers, allowed: Array<'choice' | 'yesno'>, thresholds: Thresholds, context: PageContext) {
  const candidates: MatchCandidate[] = [];
  const entries = new Map<string, NonNullable<StoredAnswers['answers']>[number]>();
  for (const [index, entry] of (answers.answers ?? []).entries()) {
    if ((entry.type !== 'choice' && entry.type !== 'yesno') || !allowed.includes(entry.type)) continue;
    const key = `answers[${index}]`;
    candidates.push({ key, questions: entry.questions.map((wording) => resolveQuestionPlaceholders(wording, context)) });
    entries.set(key, entry);
  }
  const match = matchQuestion(question, candidates, thresholds);
  return match.bestKey && match.confidence !== 'none'
    ? { entry: entries.get(match.bestKey), confidence: match.confidence, score: match.bestScore, runnerUpScore: match.secondScore }
    : undefined;
}

function factFor(question: string, answers: StoredAnswers): { value: boolean; topic: string } | undefined {
  const polarity = detectPolarity(question);
  if (polarity.ambiguous || !polarity.topic) return undefined;
  const value = answers.facts?.[polarity.topic];
  return typeof value === 'boolean' ? { value, topic: polarity.topic } : undefined;
}

function getStoredChoice(
  question: string,
  options: SelectChoice[],
  answers: StoredAnswers,
  thresholds: Thresholds,
  context: PageContext = {},
): { option: SelectChoice; confidence: 'high' | 'medium'; sensitive: boolean } | undefined {
  if (options.length === 0) return undefined;
  const storedMatch = matchStoredEntry(question, answers, ['choice', 'yesno'], thresholds, context);
  const fact = factFor(question, answers);
  const entry = storedMatch?.entry;
  const booleanAnswer = entry?.type === 'yesno' && typeof entry.answer === 'boolean'
    ? entry.answer
    : typeof entry?.answer === 'boolean' ? entry.answer : fact?.value;

  if (booleanAnswer !== undefined) {
    const picked = chooseFactOption(question, options, booleanAnswer);
    const option = options.find((candidate) => candidate.label === picked?.label && candidate.value === picked?.value);
    if (!option) return undefined;
    const detectedTopic = detectPolarity(question).topic;
    const topicSensitive = Boolean(detectedTopic && ['needsSponsorship', 'authorizedToWork'].includes(detectedTopic));
    return {
      option,
      confidence: storedMatch?.confidence ?? 'high',
      sensitive: Boolean(entry?.sensitive || topicSensitive),
    };
  }

  const profileMatch = matchQuestion(question, profileCandidates(answers.profile, answers.profileQuestions, context), thresholds);
  const profileValue = profileMatch.bestKey?.startsWith('profile.')
    ? answers.profile?.[profileMatch.bestKey.slice('profile.'.length)]
    : undefined;
  const useProfileValue = (typeof profileValue === 'string' || typeof profileValue === 'number')
    && profileMatch.confidence !== 'none'
    && profileMatch.bestScore > (storedMatch?.score ?? 0);
  const savedTextAnswer = typeof entry?.answer === 'string' ? entry.answer : undefined;
  if (!useProfileValue && (savedTextAnswer === undefined || !savedTextAnswer.trim())) return undefined;
  const selectedAnswer = useProfileValue
    ? datePartForQuestion(profileMatch.bestKey!.slice('profile.'.length), String(profileValue), question)
    : savedTextAnswer!;
  const selectedAlternates = useProfileValue
    ? answers.profileAlternates?.[profileMatch.bestKey!.slice('profile.'.length)] ?? []
    : [];
  const selectedOption = chooseSavedAnswerOption(
    selectedAnswer,
    options,
    useProfileValue ? profileMatch.bestScore : storedMatch?.score ?? 0,
    useProfileValue ? profileMatch.secondScore : storedMatch?.runnerUpScore ?? 0,
    selectedAlternates,
  );
  if (!selectedOption) return undefined;
  return {
    option: selectedOption,
    confidence: useProfileValue ? profileMatch.confidence : storedMatch?.confidence ?? 'high',
    sensitive: Boolean(entry?.sensitive || /salary|compensation|race|ethnic|gender|disability|demograph/i.test(`${question} ${entry?.questions.join(' ') ?? ''}`)),
  };
}

function dispatchNativeChoiceChange(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function installChoicePreview(
  target: HTMLElement,
  option: SelectChoice,
  highlighted: boolean,
): void {
  clearActivePreview();
  if (hasRealChoice(target)) return;
  const suggestion = document.createElement('span');
  suggestion.className = highlighted ? 'job-autofill-choice-hint is-highlighted' : 'job-autofill-choice-hint';
  suggestion.textContent = `Suggested: ${option.label}`;
  let visualTarget: HTMLElement = isChoiceWidget(target) ? option.element : target;
  if (target instanceof HTMLInputElement) visualTarget = target.labels?.[0] ?? target;
  if (highlighted) visualTarget.classList.add('job-autofill-option-preview');
  (isChoiceWidget(target) ? target : visualTarget).insertAdjacentElement('afterend', suggestion);

  const restore = () => {
    if (highlighted) visualTarget.classList.remove('job-autofill-option-preview');
    suggestion.remove();
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('blur', onBlur, true);
    target.removeEventListener('change', onChange, true);
  };
  const cleanup = () => restore();
  const accept = () => {
    if (hasRealChoice(target)) return;
    restore();
    activePreview = undefined;
    if (isChoiceWidget(target)) {
      option.element.click();
      dispatchNativeChoiceChange(target);
    } else if (target instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(target, option.value ?? (option.element instanceof HTMLOptionElement ? option.element.value : ''));
      dispatchNativeChoiceChange(target);
    } else {
      const chosen = option.element as unknown as HTMLInputElement;
      chosen.checked = true;
      dispatchNativeChoiceChange(chosen);
    }
  };
  const onBlur = () => {
    restore();
    if (activePreview?.field === target) activePreview = undefined;
  };
  const onChange = () => {
    restore();
    activePreview = undefined;
  };
  const onKeyDown: EventListener = (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if (event.key === 'Escape') {
      if (!isChoiceWidget(target)) event.preventDefault();
      restore();
      activePreview = undefined;
    } else if (event.key === 'Tab') {
      if (!highlighted) accept();
      else {
        restore();
        activePreview = undefined;
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      accept();
    }
  };

  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('blur', onBlur, true);
  target.addEventListener('change', onChange, true);
  activePreview = { field: target, cleanup };
}

/** Preview a native choice or an expanded accessible single-select combobox. */
export async function showChoicePreview(
  target: HTMLElement,
  descriptor: DetectedField,
): Promise<void> {
  clearActivePreview();
  const isChoiceWidgetTarget = isChoiceWidget(target);
  if (!isChoiceWidgetTarget && !(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) return;
  if (!isChoiceWidgetTarget && !(target instanceof HTMLSelectElement) && !['radio', 'checkbox'].includes((target as HTMLInputElement).type)) return;
  if (isChoiceWidgetTarget && !choiceWidgetExpanded(target)) return;
  if (hasRealChoice(target)) return;

  try {
    const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
    const stored = await browserApi.storage.local.get(['answers', 'jobContextOverrides', 'detectedPageContexts', 'matchingThresholds']);
    if (document.activeElement !== target && !target.contains(document.activeElement)) return;
    const answers = stored.answers as StoredAnswers | undefined;
    if (!answers) return;
    const thresholds = validThresholds(stored.matchingThresholds);
    const options = focusedChoices(target);
    const context = await previewContext(stored);
    const choice = getStoredChoice(descriptor.question, options, answers, thresholds, context);
    if (!choice) return;
    const highlighted = choice.confidence === 'medium' || choice.sensitive;
    installChoicePreview(target, choice.option, highlighted);
  } catch {
    // A storage failure must never alter a choice or interrupt normal form entry.
  }
}

function installPreview(field: PreviewField, text: string, highlighted: boolean, blocked: boolean): void {
  clearActivePreview();
  if (field.value.length > 0) return;

  const dateField = field instanceof HTMLInputElement && field.type === 'date';
  const originalPlaceholder = field.getAttribute('placeholder');
  let suggestion: HTMLSpanElement | undefined;
  if (dateField) {
    suggestion = document.createElement('span');
    suggestion.className = highlighted ? 'job-autofill-suggestion-hint is-highlighted' : 'job-autofill-suggestion-hint';
    suggestion.textContent = `Suggested: ${text}`;
    field.insertAdjacentElement('afterend', suggestion);
  } else {
    field.setAttribute('placeholder', text);
    if (highlighted) field.dataset.jobAutofillPreview = 'highlighted';
  }
  let accepted = false;
  const restore = () => {
    if (dateField) suggestion?.remove();
    else {
      if (originalPlaceholder === null) field.removeAttribute('placeholder');
      else field.setAttribute('placeholder', originalPlaceholder);
      if (highlighted) delete field.dataset.jobAutofillPreview;
    }
    field.removeEventListener('keydown', onKeyDown, true);
    field.removeEventListener('input', onInput, true);
    field.removeEventListener('blur', onBlur, true);
  };
  const cleanup = () => restore();
  const accept = () => {
    if (blocked || field.value.length > 0) return;
    accepted = true;
    restore();
    activePreview = undefined;
    nativeSetValue(field, text);
  };
  const onInput = () => {
    if (!accepted && field.value.length > 0) {
      restore();
      activePreview = undefined;
    }
  };
  const onBlur = () => {
    restore();
    if (activePreview?.field === field) activePreview = undefined;
  };
  const onKeyDown: EventListener = (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    if (event.key === 'Escape') {
      event.preventDefault();
      restore();
      activePreview = undefined;
      return;
    }
    if (event.key === 'Tab') {
      if (!highlighted && !blocked) accept();
      else {
        restore();
        activePreview = undefined;
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      accept();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      restore();
      activePreview = undefined;
    }
  };

  field.addEventListener('keydown', onKeyDown, true);
  field.addEventListener('input', onInput, true);
  field.addEventListener('blur', onBlur, true);
  activePreview = { field, cleanup };
  reportMatchedField(field);
}

/** Load local answers only for the focused empty text field and install a one-field preview. */
export async function showTextPreview(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  descriptor: DetectedField,
): Promise<void> {
  clearActivePreview();
  if (target instanceof HTMLSelectElement || target.value.length > 0) return;
  if (target instanceof HTMLInputElement && !previewableInputTypes.has(target.type)) return;

  try {
    const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
    const stored = await browserApi.storage.local.get(['answers', 'jobContextOverrides', 'detectedPageContexts', 'matchingThresholds']);
    if (document.activeElement !== target) return;
    const answers = stored.answers as StoredAnswers | undefined;
    if (!answers) return;
    const thresholds = validThresholds(stored.matchingThresholds);

    const context = await previewContext(stored);
    const { candidates, answerByKey, sensitiveByKey } = makeCandidates(answers, context);
    const hint = profileTypeHint(descriptor);
    const hintedKey = hint ? `profile.${hint}` : undefined;
    const candidatesWithHints = candidates.map((candidate) => ({
      ...candidate,
      questions: candidate.key === hintedKey ? [...candidate.questions, descriptor.question] : candidate.questions,
    }));
    const match = matchQuestion(descriptor.question, candidatesWithHints, thresholds);
    if (!match.bestKey || match.confidence === 'none') return;
    const answer = answerByKey.get(match.bestKey);
    if (answer === undefined || !answer.trim()) return;

    const resolved = resolvePlaceholders(answer, context);
    const highlighted = match.confidence === 'medium' || sensitiveByKey.has(match.bestKey) || resolved.missing.length > 0;
    installPreview(target, resolved.text, highlighted, resolved.missing.length > 0);
  } catch {
    // A storage failure must never change the field or interrupt normal form entry.
  }
}
