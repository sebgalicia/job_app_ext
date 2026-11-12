import { ariaComboboxOptions, choiceWidgetExpanded } from '../adapters/field';

/**
 * Operate custom (non-<select>) dropdowns the way a person does. Most ATS dropdowns
 * (Workday, React Select on Greenhouse/Ashby, and similar) only add their options to
 * the page while the menu is open, and many react to mouse-press events rather than
 * a bare click(). So: open, wait for options, optionally type to filter, press the
 * option with a full pointer sequence, then check that the choice stuck.
 */

export const dropdownTiming = { openTimeoutMs: 1500, filterTimeoutMs: 1500, settleMs: 120, pollMs: 40 };

let driving = 0;

/** True while the extension itself is operating a dropdown; focus suggestions should stay out of the way. */
export function isDrivingDropdown(): boolean {
  return driving > 0;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) return undefined;
    await wait(dropdownTiming.pollMs);
  }
}

/** Dispatch the pointer and mouse sequence a real click produces. */
export function pressElement(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView ?? undefined;
  const init = { bubbles: true, cancelable: true, composed: true, view, button: 0, buttons: 1 };
  const PointerEventCtor = (view as (Window & { PointerEvent?: typeof PointerEvent }) | undefined)?.PointerEvent;
  if (PointerEventCtor) element.dispatchEvent(new PointerEventCtor('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mousedown', init));
  if (PointerEventCtor) element.dispatchEvent(new PointerEventCtor('pointerup', { ...init, buttons: 0, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
}

function pressKey(element: HTMLElement, key: string): void {
  const init = { key, code: key, bubbles: true, cancelable: true, composed: true };
  element.dispatchEvent(new KeyboardEvent('keydown', init));
  element.dispatchEvent(new KeyboardEvent('keyup', init));
}

function availableOptions(target: HTMLElement): HTMLElement[] | undefined {
  if (!choiceWidgetExpanded(target)) return undefined;
  const options = ariaComboboxOptions(target);
  return options.length > 0 ? options : undefined;
}

/** Open a closed custom dropdown and return its options, or [] if none appeared. */
export async function openDropdown(target: HTMLElement): Promise<HTMLElement[]> {
  target.focus();
  pressElement(target);
  let options = await waitFor(() => availableOptions(target), dropdownTiming.openTimeoutMs / 2);
  if (!options) {
    // Keyboard-first widgets open on ArrowDown instead of a click.
    pressKey(target, 'ArrowDown');
    options = await waitFor(() => availableOptions(target), dropdownTiming.openTimeoutMs / 2);
  }
  return options ?? [];
}

/** Type into a searchable dropdown's input to filter its options. */
export async function filterDropdown(target: HTMLElement, text: string): Promise<HTMLElement[]> {
  const input = target instanceof HTMLInputElement
    ? target
    : target.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (!input) return [];
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(dropdownTiming.settleMs);
  return await waitFor(() => availableOptions(target), dropdownTiming.filterTimeoutMs) ?? [];
}

/** Clear text typed into a searchable dropdown when nothing was selected. */
export function clearTypedFilter(target: HTMLElement): void {
  const input = target instanceof HTMLInputElement ? target : target.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (!input || !input.value) return;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, '');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: null, inputType: 'deleteContentBackward' }));
}

/** Close a dropdown that is still open, without choosing anything. */
export async function closeDropdown(target: HTMLElement): Promise<void> {
  if (!choiceWidgetExpanded(target)) return;
  pressKey(target, 'Escape');
  await wait(dropdownTiming.settleMs);
}

/** Run `work` while marking the dropdown as extension-driven. */
export async function whileDriving<T>(work: () => Promise<T>): Promise<T> {
  driving += 1;
  try {
    return await work();
  } finally {
    driving -= 1;
  }
}

export async function settle(): Promise<void> {
  await wait(dropdownTiming.settleMs);
}
