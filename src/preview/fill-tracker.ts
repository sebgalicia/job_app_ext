/**
 * Track every field the extension fills automatically: outline it so the person can
 * review it before submitting, drop the outline once they change the field themselves,
 * and offer "Undo all" in a small panel.
 *
 * Undo restores text boxes, native selects, and native radio/checkbox inputs. Custom
 * dropdowns (Workday, React Select) have no reliable programmatic "clear", so they keep
 * their outline and the panel says how many need changing by hand.
 */

export type FillUndo =
  | { kind: 'text'; value: string }
  | { kind: 'select'; value: string; previous: string }
  | { kind: 'check' }
  | { kind: 'custom' };

type Fill = { control: HTMLElement; visual: HTMLElement; undo: FillUndo; stop: () => void };

const filledClass = 'job-autofill-filled';
const fills: Fill[] = [];
let panel: { host: HTMLElement; message: HTMLElement; undoButton: HTMLButtonElement } | undefined;
let lastUndoNote = '';

export function filledCount(): number {
  return fills.length;
}

/** Fields that would be restored by Undo all (custom dropdowns excluded). */
export function undoableCount(): number {
  return fills.filter((fill) => fill.undo.kind !== 'custom').length;
}

/** Register a field the extension just filled. `visual` is the element to outline. */
export function recordFill(control: HTMLElement, undo: FillUndo, visual: HTMLElement = control): void {
  if (fills.some((fill) => fill.control === control)) return;
  visual.classList.add(filledClass);
  const fill: Fill = { control, visual, undo, stop: () => undefined };
  fill.stop = watchForPersonEdit(fill);
  fills.push(fill);
  lastUndoNote = '';
  renderPanel();
}

/** Forget a fill: remove its outline and stop watching it. */
function forget(fill: Fill): void {
  const index = fills.indexOf(fill);
  if (index < 0) return;
  fills.splice(index, 1);
  fill.stop();
  fill.visual.classList.remove(filledClass);
  renderPanel();
}

function snapshot(element: HTMLElement): string {
  return `${element.textContent ?? ''}|${element.getAttribute('aria-checked') ?? ''}|${element.getAttribute('aria-selected') ?? ''}`;
}

/**
 * Once the person edits a filled field, it is theirs: the outline goes and Undo all
 * no longer touches it. Only trusted (real user) events count, so the extension's own
 * input/change events never clear the outline.
 */
function watchForPersonEdit(fill: Fill): () => void {
  const { control, undo } = fill;
  const doc = control.ownerDocument;
  if (undo.kind === 'custom') {
    const before = snapshot(fill.visual);
    const view = doc.defaultView;
    if (!view?.MutationObserver) return () => undefined;
    const observer = new view.MutationObserver(() => {
      if (snapshot(fill.visual) !== before) forget(fill);
    });
    observer.observe(fill.visual, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-checked', 'aria-selected'] });
    return () => observer.disconnect();
  }
  const onEdit = (event: Event) => {
    if (!event.isTrusted) return;
    const target = event.target;
    const sameGroup = undo.kind === 'check' && control instanceof HTMLInputElement && target instanceof HTMLInputElement
      && target.type === control.type && Boolean(control.name) && target.name === control.name;
    if (target === control || sameGroup) forget(fill);
  };
  doc.addEventListener('input', onEdit, true);
  doc.addEventListener('change', onEdit, true);
  return () => {
    doc.removeEventListener('input', onEdit, true);
    doc.removeEventListener('change', onEdit, true);
  };
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Restore one fill. Returns false when it cannot be undone (custom dropdowns, or the value changed). */
function undoOne(fill: Fill): boolean {
  const { control, undo } = fill;
  if (!control.isConnected) return true;
  if (undo.kind === 'text' && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
    if (control.value === undo.value) setNativeValue(control, '');
    return true;
  }
  if (undo.kind === 'select' && control instanceof HTMLSelectElement) {
    if (control.value === undo.value) setNativeValue(control, undo.previous);
    return true;
  }
  if (undo.kind === 'check' && control instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    if (setter) setter.call(control, false);
    else control.checked = false;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

/** Undo every automatic fill that can be undone. Returns how many were left (custom dropdowns). */
export function undoAllFills(): { undone: number; left: number } {
  let undone = 0;
  for (const fill of [...fills]) {
    if (undoOne(fill)) {
      undone += 1;
      forget(fill);
    }
  }
  const left = fills.length;
  lastUndoNote = left > 0
    ? `Cleared ${undone} field${undone === 1 ? '' : 's'}. ${left} dropdown choice${left === 1 ? '' : 's'} could not be cleared automatically; change ${left === 1 ? 'it' : 'them'} by hand.`
    : '';
  renderPanel();
  return { undone, left };
}

/** Remove all outlines and the panel, keeping the filled values. */
export function clearFillHighlights(): void {
  for (const fill of [...fills]) forget(fill);
  lastUndoNote = '';
  removePanel();
}

function removePanel(): void {
  panel?.host.remove();
  panel = undefined;
}

const panelStyles = `
:host { all: initial; }
.panel {
  --bg: #ffffff; --fg: #1c2321; --muted: #4f5b57; --border: #c9d6d1; --accent: #1f7a4d; --accent-fg: #ffffff;
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; max-width: min(340px, calc(100vw - 32px));
  box-sizing: border-box; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg); color: var(--fg); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  .panel { --bg: #1d2422; --fg: #e8efec; --muted: #a9b7b2; --border: #3a4945; --accent: #4cc38a; --accent-fg: #0d1a14; }
}
.message { margin: 0 0 10px; }
.note { margin: 0 0 10px; color: var(--muted); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit; cursor: pointer; border-radius: 6px; padding: 5px 10px;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
}
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

function ensurePanel(): NonNullable<typeof panel> | undefined {
  if (panel?.host.isConnected) return panel;
  const doc = globalThis.document;
  if (!doc?.body) return undefined;
  const host = doc.createElement('div');
  host.setAttribute('data-job-autofill-panel', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = panelStyles;
  const box = doc.createElement('div');
  box.className = 'panel';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  const message = doc.createElement('p');
  message.className = 'message';
  const actions = doc.createElement('div');
  actions.className = 'actions';
  const undoButton = doc.createElement('button');
  undoButton.type = 'button';
  undoButton.className = 'primary';
  undoButton.textContent = 'Undo all';
  undoButton.addEventListener('click', () => void undoAllFills());
  const doneButton = doc.createElement('button');
  doneButton.type = 'button';
  doneButton.textContent = 'Done reviewing';
  doneButton.addEventListener('click', clearFillHighlights);
  actions.append(undoButton, doneButton);
  box.append(message, actions);
  root.append(style, box);
  doc.body.append(host);
  panel = { host, message, undoButton };
  return panel;
}

function renderPanel(): void {
  if (fills.length === 0 && !lastUndoNote) {
    removePanel();
    return;
  }
  const current = ensurePanel();
  if (!current) return;
  const count = fills.length;
  const lines = [];
  if (count > 0) lines.push(`Filled ${count} field${count === 1 ? '' : 's'}. Check the outlined answers before you submit.`);
  if (lastUndoNote) lines.push(lastUndoNote);
  current.message.textContent = lines.join(' ');
  current.undoButton.hidden = undoableCount() === 0;
}

/** Test hook: forget everything without touching the page. */
export function resetFillTracker(): void {
  for (const fill of [...fills]) {
    fill.stop();
    fill.visual.classList.remove(filledClass);
  }
  fills.length = 0;
  lastUndoNote = '';
  removePanel();
}
