import { validateAnswers } from '../validation';

const storageKey = 'answers';
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
