import { chooseAdapter } from './adapters';
import { describeFocusedField } from './adapters/field';
import { showChoicePreview, showTextPreview } from './preview/text-preview';

const supportedControls = 'input, textarea, select';

function isEligibleControl(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (!(target instanceof HTMLElement) || !target.matches(supportedControls)) return false;
  if (target instanceof HTMLInputElement) {
    return ['text', 'email', 'tel', 'url', 'search', 'number', 'radio', 'checkbox'].includes(target.type);
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
  if (descriptor.fieldType === 'text') void showTextPreview(event.target, descriptor);
  else void showChoicePreview(event.target, descriptor);
}

// Content scripts are present on matched hosts, but do no work until focus enters a form control.
document.addEventListener('focusin', handleFocus);
