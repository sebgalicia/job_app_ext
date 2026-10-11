import { chooseAdapter } from './adapters';
import { choiceWidgetExpanded, describeFocusedField, isChoiceWidget } from './adapters/field';
import { autoAgreeTermsControl, autofillControl, detectPageContext, dismissActivePreview, saveDetectedPageContext, showChoicePreview, showTextPreview } from './preview/text-preview';

const supportedControls = 'input, textarea, select';

function isEligibleControl(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (isChoiceWidget(target)) return true;
  if (!target.matches(supportedControls)) return false;
  if (target instanceof HTMLInputElement) {
    return ['text', 'email', 'tel', 'url', 'search', 'number', 'date', 'radio', 'checkbox'].includes(target.type);
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
let onePassSiteAllowed = false;
let nextStepScanTimer: number | undefined;
const onePassAutofillEnabled = previewBrowser.storage.local.get('autofillOnOpen')
  .then((stored) => stored.autofillOnOpen === true)
  .catch(() => false);

async function processFocusedControl(target: EventTarget | null): Promise<void> {
  if (!isEligibleControl(target)) return;
  try {
    const stored = await previewBrowser.storage.local.get(['siteEnabled', 'autoAgreeTerms']);
    const siteEnabled = stored.siteEnabled as Record<string, boolean> | undefined;
    if (siteEnabled?.[location.hostname] === false) return;
    void saveDetectedPageContext();
    const adapter = chooseAdapter(document);
    const descriptor = describeFocusedField(target, adapter);
    if (!descriptor.question) return;
    if (stored.autoAgreeTerms === true) await autoAgreeTermsControl(target, descriptor);
    if (pageAutomationStopped || await onePassAutofillEnabled) return;

    document.dispatchEvent(new CustomEvent('job-autofill:question-detected', {
      detail: { ...descriptor, field: target },
    }));
    const closedTextCombobox = isChoiceWidget(target)
      && target instanceof HTMLInputElement
      && !choiceWidgetExpanded(target);
    if ((descriptor.fieldType === 'text' || closedTextCombobox)
      && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
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
  const eventTarget = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [data-automation-id="selectWidget"]')
    : null;
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeTarget = activeElement && isChoiceWidget(activeElement)
    ? activeElement
    : activeElement?.closest<HTMLElement>('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [data-automation-id="selectWidget"]') ?? null;
  const target = eventTarget ?? activeTarget;
  if (target) requestAnimationFrame(() => void processFocusedControl(target));
}

async function autofillPageOnce(): Promise<void> {
  if (!await onePassAutofillEnabled) return;
  pageAutomationStopped = true;
  try {
    const stored = await previewBrowser.storage.local.get('siteEnabled');
    const siteEnabled = stored.siteEnabled as Record<string, boolean> | undefined;
    if (siteEnabled?.[location.hostname] === false) return;
    onePassSiteAllowed = true;

    await scanVisibleFieldsOnce(true);
  } catch {
    // A failed automatic pass remains contained to this page and does not submit the form.
  } finally {
    const settings = await previewBrowser.storage.local.get('autoAgreeTerms').catch(() => ({ autoAgreeTerms: false }));
    if (settings.autoAgreeTerms !== true) {
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('input', refreshActiveCombobox);
      document.removeEventListener('click', refreshActiveCombobox);
      document.removeEventListener('keyup', refreshActiveCombobox);
    }
  }
}

async function scanVisibleFieldsOnce(includeRegularAutofill: boolean): Promise<void> {
  const settings = await previewBrowser.storage.local.get(['siteEnabled', 'autoAgreeTerms']);
  const siteEnabled = settings.siteEnabled as Record<string, boolean> | undefined;
  if (siteEnabled?.[location.hostname] === false) return;
  if (!includeRegularAutofill && settings.autoAgreeTerms !== true) return;
  const adapter = chooseAdapter(document);
  const controls = Array.from(document.querySelectorAll<HTMLElement>(
    `${supportedControls}, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [data-automation-id="selectWidget"]`,
  ));
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
    if (!descriptor.question) continue;
    if (settings.autoAgreeTerms === true) await autoAgreeTermsControl(control, descriptor);
    if (includeRegularAutofill) await autofillControl(control, descriptor);
  }
}

function handleStepAdvance(event: MouseEvent): void {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const action = event.target.closest<HTMLElement>('button, input[type="submit"], input[type="button"], [role="button"], a');
  if (!action) return;
  const label = (action.getAttribute('aria-label') || action.textContent ||
    (action instanceof HTMLInputElement ? action.value : '')).replace(/\s+/g, ' ').trim();
  if (!/^(?:next(?:\s+(?:step|page))?|continue(?:\s+(?:to\s+)?(?:next\s+)?(?:step|page))?|save\s*(?:and|&)\s*continue)$/i.test(label)) return;
  if (nextStepScanTimer !== undefined) window.clearTimeout(nextStepScanTimer);
  nextStepScanTimer = window.setTimeout(() => {
    nextStepScanTimer = undefined;
    void scanVisibleFieldsOnce(pageAutomationStopped && onePassSiteAllowed).catch(() => undefined);
  }, 500);
}

async function initialPagePass(): Promise<void> {
  if (await onePassAutofillEnabled) await autofillPageOnce();
  else await scanVisibleFieldsOnce(false);
}

const installationFlag = '__jobAutofillContentInstalled';
const contentWorld = globalThis as typeof globalThis & Record<string, unknown>;
if (!contentWorld[installationFlag]) {
  contentWorld[installationFlag] = true;
  const frameMessageFlag = '__jobAutofillFrameMessage';
  // With optional automation off, pages remain idle until a form field receives focus.
  document.addEventListener('focusin', handleFocus);
  document.addEventListener('input', refreshActiveCombobox);
  document.addEventListener('click', refreshActiveCombobox);
  document.addEventListener('keyup', refreshActiveCombobox);
  // Run one bounded pass after the initial page has had a moment to render its form.
  window.setTimeout(() => void initialPagePass().catch(() => undefined), 350);
  document.addEventListener('click', handleStepAdvance);

  previewBrowser.runtime.onMessage.addListener((message) => {
    if (message.type === 'content-ping') return { ready: true };
    if (message.type === 'get-page-context') {
      if (window.top !== window) return undefined;
      const context = detectPageContext();
      void saveDetectedPageContext();
      return { context };
    }
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

  if (window.top === window) {
    void saveDetectedPageContext();
    window.setTimeout(() => void saveDetectedPageContext(), 900);
  }

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
