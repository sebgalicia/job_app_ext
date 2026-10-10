import { chooseAdapter } from './adapters';
import { describeFocusedField } from './adapters/field';
import { autofillControl, dismissActivePreview, saveDetectedPageContext, showChoicePreview, showTextPreview } from './preview/text-preview';

const supportedControls = 'input, textarea, select';

function isEligibleControl(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.getAttribute('role') === 'combobox') return true;
  if (!target.matches(supportedControls)) return false;
  if (target instanceof HTMLInputElement) {
    return ['text', 'email', 'tel', 'url', 'search', 'number', 'radio', 'checkbox'].includes(target.type);
  }
  return true;
}

const previewBrowser = (globalThis as typeof globalThis & { browser: {
  storage: { local: { get(key: string | string[]): Promise<Record<string, unknown>> } };
  runtime: {
    onMessage: { addListener(listener: (message: { type?: string; enabled?: boolean }) => unknown): void };
    sendMessage(message: Record<string, unknown>): Promise<unknown>;
  };
} }).browser;

let pageAutomationStopped = false;
let nextStepScanTimer: number | undefined;
const onePassAutofillEnabled = previewBrowser.storage.local.get('autofillOnOpen')
  .then((stored) => stored.autofillOnOpen === true)
  .catch(() => false);

async function processFocusedControl(target: EventTarget | null): Promise<void> {
  if (pageAutomationStopped || await onePassAutofillEnabled) return;
  if (!isEligibleControl(target)) return;
  try {
    const stored = await previewBrowser.storage.local.get('siteEnabled');
    const siteEnabled = stored.siteEnabled as Record<string, boolean> | undefined;
    if (siteEnabled?.[location.hostname] === false) return;
    void saveDetectedPageContext();
    const adapter = chooseAdapter(document);
    const descriptor = describeFocusedField(target, adapter);
    if (!descriptor.question) return;

    document.dispatchEvent(new CustomEvent('job-autofill:question-detected', {
      detail: { ...descriptor, field: target },
    }));
    if (descriptor.fieldType === 'text' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      await showTextPreview(target, descriptor);
    }
    else await showChoicePreview(target, descriptor);
  } catch {
    // Form focus must keep working if extension storage is temporarily unavailable.
  }
}

function handleFocus(event: FocusEvent): void {
  void processFocusedControl(event.target);
}

function refreshActiveCombobox(event: Event): void {
  const eventTarget = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="combobox"]') : null;
  const activeTarget = document.activeElement instanceof HTMLElement
    && document.activeElement.getAttribute('role') === 'combobox' ? document.activeElement : null;
  const target = eventTarget ?? activeTarget;
  if (target) requestAnimationFrame(() => void processFocusedControl(target));
}

async function autofillPageOnce(): Promise<void> {
  if (!await onePassAutofillEnabled) return;
  pageAutomationStopped = true;
  let siteAllowsAutofill = false;
  try {
    const stored = await previewBrowser.storage.local.get('siteEnabled');
    const siteEnabled = stored.siteEnabled as Record<string, boolean> | undefined;
    if (siteEnabled?.[location.hostname] === false) return;
    siteAllowsAutofill = true;

    await scanVisibleFieldsOnce();
  } catch {
    // A failed automatic pass remains contained to this page and does not submit the form.
  } finally {
    document.removeEventListener('focusin', handleFocus);
    document.removeEventListener('click', refreshActiveCombobox);
    document.removeEventListener('keyup', refreshActiveCombobox);
    if (siteAllowsAutofill) document.addEventListener('click', handleStepAdvance);
  }
}

async function scanVisibleFieldsOnce(): Promise<void> {
  const adapter = chooseAdapter(document);
  const controls = Array.from(document.querySelectorAll<HTMLElement>(`${supportedControls}, [role="combobox"]`));
  const seenGroups = new Set<string>();
  for (const control of controls) {
    if (!isEligibleControl(control) || !control.isConnected || control.matches(':disabled, [readonly]')
      || control.closest('[hidden], [aria-hidden="true"]') || control.getClientRects().length === 0) continue;
    if (control instanceof HTMLInputElement && ['radio', 'checkbox'].includes(control.type) && control.name) {
      const groupKey = `${control.type}:${control.form?.id ?? 'document'}:${control.name}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
    }
    const descriptor = describeFocusedField(control, adapter);
    if (descriptor.question) await autofillControl(control, descriptor);
  }
}

function handleStepAdvance(event: MouseEvent): void {
  if (!event.isTrusted || !pageAutomationStopped || !(event.target instanceof Element)) return;
  const action = event.target.closest<HTMLElement>('button, input[type="submit"], input[type="button"], [role="button"], a');
  if (!action) return;
  const label = (action.getAttribute('aria-label') || action.textContent ||
    (action instanceof HTMLInputElement ? action.value : '')).replace(/\s+/g, ' ').trim();
  if (!/^(?:next(?:\s+(?:step|page))?|continue(?:\s+(?:to\s+)?(?:next\s+)?(?:step|page))?|save\s*(?:and|&)\s*continue)$/i.test(label)) return;
  if (nextStepScanTimer !== undefined) window.clearTimeout(nextStepScanTimer);
  nextStepScanTimer = window.setTimeout(() => {
    nextStepScanTimer = undefined;
    void scanVisibleFieldsOnce().catch(() => undefined);
  }, 500);
}

const installationFlag = '__jobAutofillContentInstalled';
const contentWorld = globalThis as typeof globalThis & Record<string, unknown>;
if (!contentWorld[installationFlag]) {
  contentWorld[installationFlag] = true;
  const frameMessageFlag = '__jobAutofillFrameMessage';
  // Matched pages and user-enabled tabs remain idle until a form field receives focus.
  document.addEventListener('focusin', handleFocus);
  document.addEventListener('click', refreshActiveCombobox);
  document.addEventListener('keyup', refreshActiveCombobox);
  // Run one bounded pass after the initial page has had a moment to render its form.
  window.setTimeout(() => void autofillPageOnce(), 350);

  previewBrowser.runtime.onMessage.addListener((message) => {
    if (message.type === 'content-ping') return { ready: true };
    if (message.type === 'site-state' && message.enabled === false) {
      dismissActivePreview();
      if (window.top === window) window.postMessage({ marker: frameMessageFlag, type: message.type }, '*');
    }
    if (message.type === 'refresh-focused-preview') {
      void processFocusedControl(document.activeElement);
      if (window.top === window) window.postMessage({ marker: frameMessageFlag, type: message.type }, '*');
    }
    return undefined;
  });

  window.addEventListener('message', (event: MessageEvent) => {
    if (window.top === window || event.source !== window.top || event.data?.marker !== frameMessageFlag) return;
    if (event.data.type === 'site-state') dismissActivePreview();
    if (event.data.type === 'refresh-focused-preview') void processFocusedControl(document.activeElement);
  });

  window.addEventListener('pagehide', () => {
    if (window.top === window) {
      void previewBrowser.runtime.sendMessage({ type: 'reset-match-count' }).catch(() => undefined);
    }
  });
}
