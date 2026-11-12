import { chooseAdapter } from './adapters';
import { choiceWidgetExpanded, describeFocusedField, isChoiceWidget } from './adapters/field';
import { isDrivingDropdown } from './preview/dropdown-driver';
import { autoAgreeTermsControl, autofillControl, detectPageContext, dismissActivePreview, saveDetectedPageContext, showChoicePreview, showTextPreview } from './preview/text-preview';

const supportedControls = 'input, textarea, select, [role="radio"], [role="checkbox"]';

function isEligibleControl(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (isChoiceWidget(target)) return true;
  if (target.matches('[role="radio"], [role="checkbox"]')) return true;
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
let siteAllowsAutofill = false;
let nextStepScanTimer: number | undefined;
// Each control is tried once per page, so rescans never refill a field the user cleared.
const attemptedControls = new WeakSet<HTMLElement>();
let scanInProgress: Promise<void> | undefined;
let scanQueued = false;
const scannableControls = 'input, textarea, select, [role="radio"], [role="checkbox"], [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [data-automation-id="selectWidget"]';
// Filling as each step opens is the default; only an explicit "off" in Settings disables it.
const onePassAutofillEnabled = previewBrowser.storage.local.get('autofillOnOpen')
  .then((stored) => stored.autofillOnOpen !== false)
  .catch(() => false);

async function processFocusedControl(target: EventTarget | null): Promise<void> {
  // Focus suggestions stay on after an automatic pass: they cover fields the pass
  // skipped (such as closed custom dropdowns) and never change a field without Tab/Enter.
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
    if (descriptor.fieldType === 'text'
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

function refreshClearedField(event: Event): void {
  const target = event.target;
  const isClearedTextField = (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    && target.value.trim() === '' && document.activeElement === target;
  const isClearedSelect = target instanceof HTMLSelectElement
    && target.selectedOptions.length > 0
    && (target.selectedOptions[0].value === '' || /^(?:select|choose|please select)\b/i.test(target.selectedOptions[0].textContent?.trim() ?? ''))
    && document.activeElement === target;
  if (isClearedTextField || isClearedSelect) {
    requestAnimationFrame(() => void processFocusedControl(target));
  }
}

async function autofillPageOnce(): Promise<void> {
  if (!await onePassAutofillEnabled) return;
  pageAutomationStopped = true;
  try {
    const stored = await previewBrowser.storage.local.get('siteEnabled');
    const siteEnabled = stored.siteEnabled as Record<string, boolean> | undefined;
    if (siteEnabled?.[location.hostname] === false) return;
    siteAllowsAutofill = true;

    await scanVisibleFieldsOnce(true);
  } catch {
    // A failed automatic pass remains contained to this page and does not submit the form.
  }
}

async function scanVisibleFieldsOnce(includeRegularAutofill: boolean): Promise<void> {
  const settings = await previewBrowser.storage.local.get(['siteEnabled', 'autoAgreeTerms']);
  const siteEnabled = settings.siteEnabled as Record<string, boolean> | undefined;
  if (siteEnabled?.[location.hostname] === false) return;
  if (!includeRegularAutofill && settings.autoAgreeTerms !== true) return;
  const adapter = chooseAdapter(document);
  const controls = Array.from(document.querySelectorAll<HTMLElement>(scannableControls));
  const seenGroups = new Set<string>();
  const seenCustomGroups = new Set<HTMLElement>();
  for (const control of controls) {
    if (!isEligibleControl(control) || !control.isConnected || control.matches(':disabled, [readonly]')
      || control.closest('[hidden], [aria-hidden="true"]') || control.getClientRects().length === 0) continue;
    if (control instanceof HTMLInputElement && ['radio', 'checkbox'].includes(control.type) && control.name) {
      const groupKey = `${control.type}:${control.form?.id ?? 'document'}:${control.name}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
    }
    if (control.getAttribute('role') === 'radio' || control.getAttribute('role') === 'checkbox') {
      const group = control.closest<HTMLElement>('[role="radiogroup"], [role="group"]');
      if (group) {
        if (seenCustomGroups.has(group)) continue;
        seenCustomGroups.add(group);
      }
    }
    if (attemptedControls.has(control)) continue;
    const descriptor = describeFocusedField(control, adapter);
    if (!descriptor.question) continue;
    attemptedControls.add(control);
    if (settings.autoAgreeTerms === true) await autoAgreeTermsControl(control, descriptor);
    if (includeRegularAutofill) await autofillControl(control, descriptor);
  }
}

/** Run one scan at a time; a request during a scan runs once more afterwards. */
function requestScan(): void {
  if (scanInProgress) {
    scanQueued = true;
    return;
  }
  scanInProgress = scanVisibleFieldsOnce(pageAutomationStopped && siteAllowsAutofill)
    .catch(() => undefined)
    .finally(() => {
      scanInProgress = undefined;
      if (scanQueued) {
        scanQueued = false;
        requestScan();
      }
    });
}

function addsFormControls(mutation: MutationRecord): boolean {
  if (mutation.type === 'attributes') {
    return mutation.target instanceof Element
      && (mutation.target.matches(scannableControls) || mutation.target.querySelector(scannableControls) !== null);
  }
  return Array.from(mutation.addedNodes).some((node) => node instanceof Element
    && (node.matches(scannableControls) || node.querySelector(scannableControls) !== null));
}

/**
 * Application sites render fields late and swap steps without reloading, so watch for
 * new or newly shown form controls instead of relying on a single timed pass.
 */
function watchForNewFields(): void {
  let timer: number | undefined;
  const observer = new MutationObserver((mutations) => {
    // Menus the extension opens itself add options, not new questions.
    if (isDrivingDropdown() || !mutations.some(addsFormControls)) return;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      requestScan();
    }, 400);
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'],
  });
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
    requestScan();
  }, 500);
}

async function initialPagePass(): Promise<void> {
  if (await onePassAutofillEnabled) await autofillPageOnce();
  else await scanVisibleFieldsOnce(false);
  watchForNewFields();
}

const installationFlag = '__jobAutofillContentInstalled';
const contentWorld = globalThis as typeof globalThis & Record<string, unknown>;
if (!contentWorld[installationFlag]) {
  contentWorld[installationFlag] = true;
  const frameMessageFlag = '__jobAutofillFrameMessage';
  // With optional automation off, pages remain idle until a form field receives focus.
  document.addEventListener('focusin', handleFocus);
  document.addEventListener('input', refreshActiveCombobox);
  document.addEventListener('input', refreshClearedField);
  document.addEventListener('change', refreshClearedField);
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
