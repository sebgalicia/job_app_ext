import { defaultThresholds, matchQuestion, scoreSimilarity, type MatchCandidate } from '../matching/matcher';
import { chooseFactOption, detectPolarity, type ChoiceOption } from '../matching/polarity';
import type { DetectedField } from '../adapters/field';

type StoredAnswers = {
  profile?: Record<string, string | number | undefined>;
  facts?: Record<string, string | number | boolean | undefined>;
  answers?: Array<{ questions: string[]; type: 'text' | 'choice' | 'yesno'; answer: string | boolean; sensitive?: boolean }>;
};

type StorageBrowser = { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
type PreviewField = HTMLInputElement | HTMLTextAreaElement;
type PreviewTarget = PreviewField | HTMLSelectElement;
type SelectChoice = ChoiceOption & { element: HTMLOptionElement };

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

function focusedChoices(target: HTMLInputElement | HTMLSelectElement): SelectChoice[] {
  if (target instanceof HTMLSelectElement) {
    return Array.from(target.options)
      .filter((option) => !option.disabled && !isPlaceholderOption(option.label || option.textContent || '', option.value))
      .map((option) => ({ label: (option.label || option.textContent || '').trim(), value: option.value, element: option }));
  }
  const type = target.type;
  const controls = target.name
    ? Array.from((target.form ?? target.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)).filter((input) => input.name === target.name)
    : [target];
  return controls.map((input) => {
    const label = input.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() || input.value;
    return { label, value: input.value, element: input as unknown as HTMLOptionElement };
  }).filter((option) => Boolean(option.label));
}

function hasRealChoice(target: HTMLInputElement | HTMLSelectElement): boolean {
  if (target instanceof HTMLSelectElement) {
    const selected = target.selectedOptions[0];
    return Boolean(selected && !isPlaceholderOption(selected.label || selected.textContent || '', selected.value));
  }
  const type = target.type;
  const controls = target.name
    ? Array.from((target.form ?? target.ownerDocument).querySelectorAll<HTMLInputElement>(`input[type="${type}"]`)).filter((input) => input.name === target.name)
    : [target];
  return controls.some((input) => input.checked);
}

function matchStoredEntry(question: string, answers: StoredAnswers, allowed: Array<'choice' | 'yesno'>) {
  const candidates: MatchCandidate[] = [];
  const entries = new Map<string, NonNullable<StoredAnswers['answers']>[number]>();
  for (const [index, entry] of (answers.answers ?? []).entries()) {
    if ((entry.type !== 'choice' && entry.type !== 'yesno') || !allowed.includes(entry.type)) continue;
    const key = `answers[${index}]`;
    candidates.push({ key, questions: entry.questions });
    entries.set(key, entry);
  }
  const match = matchQuestion(question, candidates, defaultThresholds);
  return match.bestKey && match.confidence !== 'none'
    ? { entry: entries.get(match.bestKey), confidence: match.confidence }
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
): { option: SelectChoice; confidence: 'high' | 'medium'; sensitive: boolean } | undefined {
  if (options.length === 0) return undefined;
  const storedMatch = matchStoredEntry(question, answers, ['choice', 'yesno']);
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

  if (typeof entry?.answer !== 'string') return undefined;
  const selectedOption = chooseTextOption(entry.answer, options);
  if (!selectedOption) return undefined;
  return {
    option: selectedOption,
    confidence: storedMatch?.confidence ?? 'high',
    sensitive: Boolean(entry.sensitive || /salary|compensation|race|gender|disability|demograph/i.test(question)),
  };
}

function dispatchNativeChoiceChange(element: HTMLInputElement | HTMLSelectElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function installChoicePreview(
  target: HTMLInputElement | HTMLSelectElement,
  option: SelectChoice,
  highlighted: boolean,
): void {
  clearActivePreview();
  if (hasRealChoice(target)) return;
  const suggestion = document.createElement('span');
  suggestion.className = `job-autofill-choice-hint${highlighted ? ' is-highlighted' : ''}`;
  suggestion.textContent = `Suggested: ${option.label}`;
  let visualTarget: HTMLElement = target;
  if (target instanceof HTMLInputElement) {
    visualTarget = target.labels?.[0] ?? target;
  }
  visualTarget.classList.add('job-autofill-option-preview');
  if (highlighted) visualTarget.classList.add('is-highlighted');
  visualTarget.insertAdjacentElement('afterend', suggestion);

  const restore = () => {
    visualTarget.classList.remove('job-autofill-option-preview');
    visualTarget.classList.remove('is-highlighted');
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
    if (target instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(target, option.value ?? option.element.value);
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
      event.preventDefault();
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

/** Preview a native select, radio group, or checkbox using saved choice answers and facts. */
export async function showChoicePreview(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  descriptor: DetectedField,
): Promise<void> {
  clearActivePreview();
  if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) return;
  if (!(target instanceof HTMLSelectElement) && !['radio', 'checkbox'].includes(target.type)) return;
  if (hasRealChoice(target)) return;

  try {
    const browserApi = (globalThis as typeof globalThis & { browser: StorageBrowser }).browser;
    const stored = await browserApi.storage.local.get('answers');
    if (document.activeElement !== target) return;
    const answers = stored.answers as StoredAnswers | undefined;
    if (!answers) return;
    const options = focusedChoices(target);
    const choice = getStoredChoice(descriptor.question, options, answers);
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
