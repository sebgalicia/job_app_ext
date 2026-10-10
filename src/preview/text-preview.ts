import { defaultThresholds, matchQuestion, type MatchCandidate } from '../matching/matcher';
import type { DetectedField } from '../adapters/field';

type StoredAnswers = {
  profile?: Record<string, string | number | undefined>;
  answers?: Array<{ questions: string[]; type: 'text' | 'choice' | 'yesno'; answer: string | boolean; sensitive?: boolean }>;
};

type StorageBrowser = { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
type PreviewField = HTMLInputElement | HTMLTextAreaElement;

const profileQuestions: Record<string, string[]> = {
  firstName: ['first name', 'given name', 'your first name'],
  lastName: ['last name', 'family name', 'surname'],
  email: ['email address', 'email'],
  phone: ['phone number', 'telephone number', 'mobile number'],
  address: ['street address', 'address line one', 'mailing address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip code', 'postal code'],
  country: ['country', 'country of residence'],
  linkedin: ['linkedin profile', 'linkedin url'],
  github: ['github profile', 'github url'],
  website: ['personal website', 'portfolio url', 'website'],
  school: ['school', 'university', 'college'],
  degree: ['degree'],
  major: ['major', 'field of study'],
  gradYear: ['graduation year', 'year of graduation'],
};

const autocompleteProfileKey: Record<string, string> = {
  'given-name': 'firstName', 'family-name': 'lastName', email: 'email', tel: 'phone',
  'address-line1': 'address', 'address-level2': 'city', 'address-level1': 'state',
  'postal-code': 'zip', 'country-name': 'country',
};
const previewableInputTypes = new Set(['text', 'email', 'tel', 'url', 'search', 'number']);

let activePreview: { field: PreviewField; cleanup: () => void } | undefined;

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

function contextFromPage(): { company?: string; role?: string } {
  // Values can be overridden from the toolbar popup in a later UI step.
  const title = document.title;
  const heading = document.querySelector('h1')?.textContent?.trim() ?? '';
  const text = `${heading} ${title}`;
  const role = heading || title.split(/[|–—-]/)[0]?.trim();
  const companyMatch = text.match(/\b(?:jobs?|careers?)\s+(?:at|with)\s+([^|–—-]+)/i)
    ?? text.match(/\bat\s+([A-Z][\w&.' -]{1,60})/);
  const company = companyMatch?.[1]?.trim();
  return { company, role: role || undefined };
}

function profileCandidates(profile: StoredAnswers['profile']): MatchCandidate[] {
  return Object.entries(profile ?? {}).flatMap(([key, value]) => {
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    if (!String(value).trim() || !profileQuestions[key]) return [];
    return [{ key: `profile.${key}`, questions: profileQuestions[key] }];
  });
}

function makeCandidates(answers: StoredAnswers): { candidates: MatchCandidate[]; answerByKey: Map<string, string>; sensitiveByKey: Set<string> } {
  const candidates = profileCandidates(answers.profile);
  const answerByKey = new Map<string, string>();
  const sensitiveByKey = new Set<string>();
  for (const [index, entry] of (answers.answers ?? []).entries()) {
    if (entry.type !== 'text' || typeof entry.answer !== 'string') continue;
    const key = `answers[${index}]`;
    candidates.push({ key, questions: entry.questions });
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

function nativeSetValue(field: PreviewField, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearActivePreview(): void {
  activePreview?.cleanup();
  activePreview = undefined;
}

function installPreview(field: PreviewField, text: string, highlighted: boolean, blocked: boolean): void {
  clearActivePreview();
  if (field.value.length > 0) return;

  const originalPlaceholder = field.getAttribute('placeholder');
  field.setAttribute('placeholder', text);
  field.dataset.jobAutofillPreview = highlighted || blocked ? 'highlighted' : 'normal';
  let accepted = false;
  const restore = () => {
    if (originalPlaceholder === null) field.removeAttribute('placeholder');
    else field.setAttribute('placeholder', originalPlaceholder);
    delete field.dataset.jobAutofillPreview;
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
    const stored = await browserApi.storage.local.get('answers');
    if (document.activeElement !== target) return;
    const answers = stored.answers as StoredAnswers | undefined;
    if (!answers) return;

    const { candidates, answerByKey, sensitiveByKey } = makeCandidates(answers);
    const hint = profileTypeHint(descriptor);
    const hintedKey = hint ? `profile.${hint}` : undefined;
    const candidatesWithHints = candidates.map((candidate) => ({
      ...candidate,
      questions: candidate.key === hintedKey ? [...candidate.questions, descriptor.question] : candidate.questions,
    }));
    const match = matchQuestion(descriptor.question, candidatesWithHints, defaultThresholds);
    if (!match.bestKey || match.confidence === 'none') return;
    const answer = answerByKey.get(match.bestKey);
    if (answer === undefined) return;

    const resolved = resolvePlaceholders(answer, contextFromPage());
    const highlighted = match.confidence === 'medium' || sensitiveByKey.has(match.bestKey) || resolved.missing.length > 0;
    installPreview(target, resolved.text, highlighted, resolved.missing.length > 0);
  } catch {
    // A storage failure must never change the field or interrupt normal form entry.
  }
}
