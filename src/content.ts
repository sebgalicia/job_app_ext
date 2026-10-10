import { chooseAdapter } from './adapters';
import { describeFocusedField } from './adapters/field';

const supportedControls = 'input, textarea, select';

function isEligibleControl(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (!(target instanceof HTMLElement) || !target.matches(supportedControls)) return false;
  if (target instanceof HTMLInputElement) {
    return !['hidden', 'button', 'submit', 'reset', 'image', 'file', 'password'].includes(target.type);
  }
  return true;
}

function handleFocus(event: FocusEvent): void {
  if (!isEligibleControl(event.target)) return;
  const adapter = chooseAdapter(document);
  const descriptor = describeFocusedField(event.target, adapter);
  if (!descriptor.question) return;

  document.dispatchEvent(new CustomEvent('job-autofill:question-detected', {
    detail: { ...descriptor, field: event.target },
  }));
}

// Content scripts are present on matched hosts, but do no work until focus enters a form control.
document.addEventListener('focusin', handleFocus);
