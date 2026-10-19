import { defaultThresholds, validThresholds, type Thresholds } from '../matching/matcher';
import { validateAnswers } from '../validation';
import { validateWorkHistory } from '../work-history-validation';

const storageKey = 'answers';
const thresholdsKey = 'matchingThresholds';
const autofillKey = 'autofillOnOpen';
const autoAgreeKey = 'autoAgreeTerms';
const workHistoryKey = 'workHistory';
const feedbackEnabledKey = 'learningFeedbackEnabled';
const feedbackRecordsKey = 'suggestionFeedback';
type BrowserStorage = {
  runtime: { getURL(path: string): string };
  tabs?: {
    getCurrent(): Promise<{ id?: number } | undefined>;
    remove(tabId: number): Promise<void>;
  };
  storage: {
    local: {
      get(key: string | string[]): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
  };
};

const browserApi = (globalThis as typeof globalThis & { browser: BrowserStorage }).browser;
const fileInput = document.querySelector<HTMLInputElement>('#answers-file')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-button')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export-button')!;
const importStatus = document.querySelector<HTMLDivElement>('#import-status')!;
const errorsList = document.querySelector<HTMLUListElement>('#validation-errors')!;
const savedState = document.querySelector<HTMLParagraphElement>('#saved-state')!;
const highThreshold = document.querySelector<HTMLInputElement>('#high-threshold')!;
const mediumThreshold = document.querySelector<HTMLInputElement>('#medium-threshold')!;
const highThresholdValue = document.querySelector<HTMLOutputElement>('#high-threshold-value')!;
const mediumThresholdValue = document.querySelector<HTMLOutputElement>('#medium-threshold-value')!;
const matchingStatus = document.querySelector<HTMLParagraphElement>('#matching-status')!;
const autofillOnOpen = document.querySelector<HTMLInputElement>('#autofill-on-open')!;
const autofillStatus = document.querySelector<HTMLParagraphElement>('#autofill-status')!;
const autoAgreeTerms = document.querySelector<HTMLInputElement>('#auto-agree-terms')!;
const autoAgreeStatus = document.querySelector<HTMLParagraphElement>('#auto-agree-status')!;
const settingsNavigation = [...document.querySelectorAll<HTMLAnchorElement>('.settings-nav a[href^="#"]')];
const backButton = document.querySelector<HTMLButtonElement>('#settings-back')!;
const workHistoryFile = document.querySelector<HTMLInputElement>('#work-history-file')!;
const workHistoryImport = document.querySelector<HTMLButtonElement>('#work-history-import')!;
const workHistoryExport = document.querySelector<HTMLButtonElement>('#work-history-export')!;
const workHistoryStatus = document.querySelector<HTMLDivElement>('#work-history-status')!;
const workHistoryErrors = document.querySelector<HTMLUListElement>('#work-history-errors')!;
const workHistorySavedState = document.querySelector<HTMLParagraphElement>('#work-history-saved-state')!;
const feedbackEnabled = document.querySelector<HTMLInputElement>('#learning-feedback-enabled')!;
const feedbackStatus = document.querySelector<HTMLParagraphElement>('#feedback-status')!;
const feedbackExport = document.querySelector<HTMLButtonElement>('#feedback-export')!;
const feedbackClear = document.querySelector<HTMLButtonElement>('#feedback-clear')!;

backButton.addEventListener('click', () => {
  void (async () => {
    try {
      const currentTab = await browserApi.tabs?.getCurrent();
      if (currentTab?.id !== undefined && browserApi.tabs?.remove) {
        await browserApi.tabs.remove(currentTab.id);
        return;
      }
    } catch {
      // The extension tab API may be unavailable in some browsers/contexts.
    }

    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        if (window.history.length > 1) window.history.back();
        else window.location.assign(browserApi.runtime.getURL('popup.html'));
      }
    }, 100);
  })();
});

function updateSettingsNavigation(): void {
  const activeHash = window.location.hash || settingsNavigation[0]?.hash;
  for (const link of settingsNavigation) {
    const active = link.hash === activeHash;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', updateSettingsNavigation);
updateSettingsNavigation();

function showStatus(message: string, isError = false): void {
  importStatus.textContent = message;
  importStatus.className = isError ? 'status-message error' : 'status-message success';
}

function showErrors(errors: string[]): void {
  errorsList.replaceChildren(...errors.map((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  }));
}

function renderThresholds(thresholds: Thresholds): void {
  highThreshold.value = String(thresholds.high);
  mediumThreshold.value = String(thresholds.medium);
  highThresholdValue.value = thresholds.high.toFixed(2);
  mediumThresholdValue.value = thresholds.medium.toFixed(2);
}

async function saveThresholds(changed: 'high' | 'medium'): Promise<void> {
  let high = Number(highThreshold.value);
  let medium = Number(mediumThreshold.value);
  if (changed === 'high' && high <= medium) medium = Math.max(0.3, high - 0.01);
  if (changed === 'medium' && medium >= high) high = Math.min(0.95, medium + 0.01);
  const thresholds = validThresholds({ high, medium });
  renderThresholds(thresholds);
  try {
    await browserApi.storage.local.set({ [thresholdsKey]: thresholds });
    matchingStatus.textContent = 'Matching thresholds saved on this device.';
    matchingStatus.className = 'status-message success';
  } catch {
    matchingStatus.textContent = 'Could not save matching thresholds.';
    matchingStatus.className = 'status-message error';
  }
}

highThreshold.addEventListener('change', () => void saveThresholds('high'));
mediumThreshold.addEventListener('change', () => void saveThresholds('medium'));

async function refreshSavedState(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get(storageKey);
    const hasAnswers = stored[storageKey] !== undefined;
    savedState.textContent = hasAnswers ? 'An answers file is saved on this device.' : 'No answers file is saved yet.';
    exportButton.disabled = !hasAnswers;
  } catch {
    savedState.textContent = 'Could not read local storage. Check the extension permissions.';
    exportButton.disabled = true;
  }
}

function showWorkHistoryStatus(message: string, isError = false): void {
  workHistoryStatus.textContent = message;
  workHistoryStatus.className = isError ? 'status-message error' : 'status-message success';
}

function showWorkHistoryErrors(errors: string[]): void {
  workHistoryErrors.replaceChildren(...errors.map((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  }));
}

async function refreshWorkHistoryState(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get(workHistoryKey);
    const jobs = (stored[workHistoryKey] as { jobs?: unknown[] } | undefined)?.jobs;
    const count = Array.isArray(jobs) ? jobs.length : 0;
    workHistorySavedState.textContent = count > 0
      ? `${count} ${count === 1 ? 'job' : 'jobs'} saved on this device.`
      : 'No job history is saved yet.';
    workHistoryExport.disabled = count === 0;
  } catch {
    workHistorySavedState.textContent = 'Could not read saved job history.';
    workHistoryExport.disabled = true;
  }
}

workHistoryImport.addEventListener('click', async () => {
  showWorkHistoryErrors([]);
  const file = workHistoryFile.files?.[0];
  if (!file) {
    showWorkHistoryStatus('Choose a job history JSON file first.', true);
    return;
  }
  let history: unknown;
  try {
    history = JSON.parse(await file.text());
  } catch {
    showWorkHistoryStatus('The selected file is not valid JSON.', true);
    return;
  }
  const result = validateWorkHistory(history);
  if (!result.valid) {
    showWorkHistoryStatus('Import canceled. Fix the validation errors and try again.', true);
    showWorkHistoryErrors(result.errors);
    return;
  }
  try {
    await browserApi.storage.local.set({ [workHistoryKey]: history });
    showWorkHistoryStatus('Job history validated and saved on this device.');
    workHistoryFile.value = '';
    await refreshWorkHistoryState();
  } catch {
    showWorkHistoryStatus('Could not save job history to local storage.', true);
  }
});

workHistoryExport.addEventListener('click', async () => {
  try {
    const stored = await browserApi.storage.local.get(workHistoryKey);
    const history = stored[workHistoryKey];
    if (history === undefined) {
      showWorkHistoryStatus('There is no saved job history to export.', true);
      await refreshWorkHistoryState();
      return;
    }
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'job-history.json';
    link.click();
    URL.revokeObjectURL(url);
    showWorkHistoryStatus('Job history exported.');
  } catch {
    showWorkHistoryStatus('Could not export job history.', true);
  }
});

async function loadThresholds(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get(thresholdsKey);
    renderThresholds(validThresholds(stored[thresholdsKey] ?? defaultThresholds));
  } catch {
    renderThresholds(defaultThresholds);
    matchingStatus.textContent = 'Could not read saved thresholds; using defaults.';
    matchingStatus.className = 'status-message error';
  }
}

autofillOnOpen.addEventListener('change', async () => {
  try {
    await browserApi.storage.local.set({ [autofillKey]: autofillOnOpen.checked });
    autofillStatus.textContent = autofillOnOpen.checked
      ? 'One-pass automatic filling is enabled on pages opened from now on.'
      : 'One-pass automatic filling is disabled.';
    autofillStatus.className = 'status-message success';
  } catch {
    autofillStatus.textContent = 'Could not save the automatic filling setting.';
    autofillStatus.className = 'status-message error';
    autofillOnOpen.checked = false;
  }
});

async function loadAutofillSetting(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get(autofillKey);
    autofillOnOpen.checked = stored[autofillKey] === true;
  } catch {
    autofillOnOpen.checked = false;
    autofillStatus.textContent = 'Could not read the setting; automatic filling is off.';
    autofillStatus.className = 'status-message error';
  }
}

autoAgreeTerms.addEventListener('change', async () => {
  try {
    await browserApi.storage.local.set({ [autoAgreeKey]: autoAgreeTerms.checked });
    autoAgreeStatus.textContent = autoAgreeTerms.checked
      ? 'Automatic agreement selection is enabled for newly opened steps.'
      : 'Automatic agreement selection is disabled.';
    autoAgreeStatus.className = 'status-message success';
  } catch {
    autoAgreeStatus.textContent = 'Could not save the agreement setting.';
    autoAgreeStatus.className = 'status-message error';
    autoAgreeTerms.checked = false;
  }
});

async function loadAutoAgreeSetting(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get(autoAgreeKey);
    autoAgreeTerms.checked = stored[autoAgreeKey] === true;
  } catch {
    autoAgreeTerms.checked = false;
    autoAgreeStatus.textContent = 'Could not read the agreement setting; automatic selection is off.';
    autoAgreeStatus.className = 'status-message error';
  }
}

async function refreshFeedbackState(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get([feedbackEnabledKey, feedbackRecordsKey]);
    feedbackEnabled.checked = stored[feedbackEnabledKey] === true;
    const records = Array.isArray(stored[feedbackRecordsKey]) ? stored[feedbackRecordsKey] as unknown[] : [];
    feedbackStatus.textContent = `${records.length} feedback ${records.length === 1 ? 'record' : 'records'} saved on this device. Feedback does not change matching yet.`;
    feedbackStatus.className = 'status-message';
    feedbackExport.disabled = records.length === 0;
    feedbackClear.disabled = records.length === 0;
  } catch {
    feedbackStatus.textContent = 'Could not read local learning feedback.';
    feedbackStatus.className = 'status-message error';
    feedbackExport.disabled = true;
    feedbackClear.disabled = true;
  }
}

feedbackEnabled.addEventListener('change', async () => {
  try {
    await browserApi.storage.local.set({ [feedbackEnabledKey]: feedbackEnabled.checked });
    feedbackStatus.textContent = feedbackEnabled.checked
      ? 'Feedback collection is on. Only your explicit Useful or Wrong choices are saved.'
      : 'Feedback collection is off. Existing records remain until you clear or export them.';
    feedbackStatus.className = 'status-message success';
  } catch {
    feedbackEnabled.checked = false;
    feedbackStatus.textContent = 'Could not save the learning feedback setting.';
    feedbackStatus.className = 'status-message error';
  }
});

feedbackExport.addEventListener('click', async () => {
  try {
    const stored = await browserApi.storage.local.get(feedbackRecordsKey);
    const records = Array.isArray(stored[feedbackRecordsKey]) ? stored[feedbackRecordsKey] : [];
    if (records.length === 0) return;
    const blob = new Blob([JSON.stringify({ version: 1, records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'job-autofill-feedback.json';
    link.click();
    URL.revokeObjectURL(url);
    feedbackStatus.textContent = 'Feedback records exported.';
    feedbackStatus.className = 'status-message success';
  } catch {
    feedbackStatus.textContent = 'Could not export feedback records.';
    feedbackStatus.className = 'status-message error';
  }
});

feedbackClear.addEventListener('click', async () => {
  try {
    await browserApi.storage.local.set({ [feedbackRecordsKey]: [] });
    await refreshFeedbackState();
    feedbackStatus.textContent = 'Learning feedback records were deleted from this device.';
    feedbackStatus.className = 'status-message success';
  } catch {
    feedbackStatus.textContent = 'Could not delete feedback records.';
    feedbackStatus.className = 'status-message error';
  }
});

importButton.addEventListener('click', async () => {
  showErrors([]);
  const file = fileInput.files?.[0];
  if (!file) {
    showStatus('Choose a JSON file first.', true);
    return;
  }

  let answers: unknown;
  try {
    answers = JSON.parse(await file.text());
  } catch {
    showStatus('The selected file is not valid JSON.', true);
    return;
  }

  const result = validateAnswers(answers);
  if (!result.valid) {
    showStatus('Import canceled. Fix the validation errors and try again.', true);
    showErrors(result.errors);
    return;
  }

  try {
    await browserApi.storage.local.set({ [storageKey]: answers });
    showStatus('Answers validated and saved on this device.');
    fileInput.value = '';
    await refreshSavedState();
  } catch {
    showStatus('Could not save answers to local storage.', true);
  }
});

exportButton.addEventListener('click', async () => {
  try {
    const stored = await browserApi.storage.local.get(storageKey);
    const answers = stored[storageKey];
    if (answers === undefined) {
      showStatus('There are no saved answers to export.', true);
      await refreshSavedState();
      return;
    }

    const blob = new Blob([JSON.stringify(answers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'answers.json';
    link.click();
    URL.revokeObjectURL(url);
    showStatus('Saved answers exported.');
  } catch {
    showStatus('Could not export saved answers.', true);
  }
});

void refreshSavedState();
void refreshWorkHistoryState();
void loadThresholds();
void loadAutofillSetting();
void loadAutoAgreeSetting();
void refreshFeedbackState();
