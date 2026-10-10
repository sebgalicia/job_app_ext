import { defaultThresholds, validThresholds, type Thresholds } from '../matching/matcher';
import { validateAnswers } from '../validation';

const storageKey = 'answers';
const thresholdsKey = 'matchingThresholds';
type BrowserStorage = {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
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

function showStatus(message: string, isError = false): void {
  importStatus.textContent = message;
  importStatus.className = isError ? 'status error' : 'status success';
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
    matchingStatus.className = 'success';
  } catch {
    matchingStatus.textContent = 'Could not save matching thresholds.';
    matchingStatus.className = 'error';
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

async function loadThresholds(): Promise<void> {
  try {
    const stored = await browserApi.storage.local.get(thresholdsKey);
    renderThresholds(validThresholds(stored[thresholdsKey] ?? defaultThresholds));
  } catch {
    renderThresholds(defaultThresholds);
    matchingStatus.textContent = 'Could not read saved thresholds; using defaults.';
    matchingStatus.className = 'error';
  }
}

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
void loadThresholds();
