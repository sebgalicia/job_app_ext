import type { FormAdapter } from './generic';
import {
  classifySectionText, detectDateBoundary, detectDatePart,
  type DateBoundary, type DatePart, type FieldSection,
} from '../matching/structured-fields';

export type DetectedField = {
  /** Repeated form section the field sits in, such as Education 1 or Work Experience 2. */
  section?: FieldSection;
  /** The part of a date this box holds, when it is a date box. */
  datePart?: DatePart;
  /** Whether a date box is the start or end of a period. */
  dateBoundary?: DateBoundary;
  placeholder?: string;
  adapter: string;
  question: string;
  questionParts: string[];
  fieldType: 'text' | 'choice' | 'yesno';
  inputType?: string;
  autocomplete?: string;
  /** Machine names from markup (name, id, data-automation-id, ...) used for deterministic profile hints. */
  attributeHints: string[];
  groupSize: number;
  optionLabels: string[];
};

const choiceWidgetSelector = '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"], [data-automation-id="selectWidget"]';

export function isChoiceWidget(field: HTMLElement): boolean {
  if (typeof field.matches === 'function') return field.matches(choiceWidgetSelector);
  return field.getAttribute('role') === 'combobox'
    || field.getAttribute('aria-haspopup') === 'listbox'
    || field.getAttribute('aria-haspopup') === 'true'
    || field.getAttribute('data-automation-id') === 'selectWidget';
}

export function choiceWidgetExpanded(field: HTMLElement): boolean {
  if (field.getAttribute('aria-expanded') === 'true'
    || (typeof field.querySelector === 'function' && field.querySelector('[aria-expanded="true"]'))) return true;
  const active = field.ownerDocument.activeElement;
  if (active && active !== field
    && !(typeof Node !== 'undefined' && active instanceof Node && field.contains(active))) return false;
  const ids = `${field.getAttribute('aria-controls') ?? ''} ${field.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean);
  if (ids.some((id) => {
    const popup = field.ownerDocument.getElementById(id);
    return Boolean(popup && typeof popup.getAttribute === 'function' && isVisible(popup as HTMLElement)
      && typeof popup.querySelector === 'function'
      && popup.querySelector('[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]'));
  })) return true;
  if (typeof field.ownerDocument.querySelectorAll !== 'function') return false;
  return Array.from(field.ownerDocument.querySelectorAll<HTMLElement>(
    '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]',
  )).some(isVisible);
}

function optionLabel(option: HTMLOptionElement): string {
  return option.label.trim() || option.textContent?.trim() || '';
}

function groupMembers(field: HTMLElement): HTMLElement[] {
  if (field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox') && field.name) {
    const scope: ParentNode = field.form ?? field.ownerDocument;
    return Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="${field.type}"]`))
      .filter((candidate) => candidate.name === field.name);
  }
  const role = field.getAttribute('role');
  if (role === 'radio' || role === 'checkbox') {
    const group = field.closest<HTMLElement>('[role="radiogroup"], [role="group"]');
    return group ? Array.from(group.querySelectorAll<HTMLElement>(`[role="${role}"]`)) : [field];
  }
  return [field];
}

export function ariaComboboxOptions(field: HTMLElement): HTMLElement[] {
  if (!isChoiceWidget(field) || !choiceWidgetExpanded(field)) return [];
  const ids = new Set(`${field.getAttribute('aria-controls') ?? ''} ${field.getAttribute('aria-owns') ?? ''}`.trim().split(/\s+/).filter(Boolean));
  const linkedListboxes = Array.from(ids).flatMap((id) => {
    const element = field.ownerDocument.getElementById(id);
    if (!element) return [];
    return element.getAttribute('role') === 'listbox'
      ? [element]
      : Array.from(element.querySelectorAll<HTMLElement>('[role="listbox"]'));
  });
  const listboxes = new Set(linkedListboxes.filter((listbox) => listbox.getAttribute('aria-multiselectable') !== 'true'));
  if (linkedListboxes.length > 0 && listboxes.size === 0) return [];
  // Workday and some Greenhouse builds render an open popup without linking it
  // through aria-controls; use only visible listboxes/options in that case.
  if (listboxes.size === 0) {
    const pageListboxes = typeof field.ownerDocument.querySelectorAll === 'function'
      ? field.ownerDocument.querySelectorAll<HTMLElement>('[role="listbox"]')
      : [];
    for (const listbox of pageListboxes) {
      if (listbox.getAttribute('aria-multiselectable') !== 'true' && isVisible(listbox)) listboxes.add(listbox);
    }
  }
  const fromListboxes = Array.from(listboxes).flatMap((listbox) => Array.from(listbox.querySelectorAll<HTMLElement>(
    '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]',
  )));
  const allPageOptions = typeof field.ownerDocument.querySelectorAll === 'function'
    ? Array.from(field.ownerDocument.querySelectorAll<HTMLElement>(
      '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]',
    ))
    : [];
  const candidates = fromListboxes.length > 0 ? fromListboxes : allPageOptions.filter(isVisible);
  return Array.from(new Set(candidates))
    .filter((option) => option.getAttribute('aria-disabled') !== 'true'
      && option.getAttribute('data-automation-id') !== 'promptOptionDisabled'
      && !option.hasAttribute('hidden')
      && !option.closest('[hidden], [aria-hidden="true"]')
      && isVisible(option));
}

function isVisible(element: HTMLElement): boolean {
  const visibility = element.ownerDocument?.defaultView?.getComputedStyle(element).visibility;
  const connected = element.isConnected !== false;
  const hasVisibleBox = typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
  const hiddenAncestor = typeof element.closest === 'function' && element.closest('[hidden], [aria-hidden="true"]');
  return connected && hasVisibleBox
    && !hiddenAncestor
    && visibility !== 'hidden';
}

export function describeFocusedField(
  field: HTMLElement,
  adapter: FormAdapter,
): DetectedField {
  const members = groupMembers(field);
  const questionParts = adapter.questionParts(field);
  let fieldType: DetectedField['fieldType'] = 'text';
  let optionLabels: string[] = [];

  if (isChoiceWidget(field)) {
    fieldType = 'choice';
    optionLabels = ariaComboboxOptions(field).map((option) =>
      (option.getAttribute('aria-label') || option.textContent || '').replace(/\s+/g, ' ').trim(),
    ).filter(Boolean);
  } else if (field instanceof HTMLSelectElement) {
    fieldType = 'choice';
    optionLabels = Array.from(field.options, optionLabel).filter(Boolean);
  } else if (field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type)) {
    const allYesNo = members.length === 2 && members.every((member) => member instanceof HTMLInputElement
      && /^(?:yes|no|true|false)$/i.test(member.labels?.[0]?.textContent?.trim() || member.value));
    fieldType = allYesNo || members.length === 1 ? 'yesno' : 'choice';
    optionLabels = members.filter((member): member is HTMLInputElement => member instanceof HTMLInputElement).map((input) => {
      const label = input.labels?.[0];
      return label?.textContent?.replace(/\s+/g, ' ').trim() || input.value;
    }).filter(Boolean);
  } else if (field.getAttribute('role') === 'radio' || field.getAttribute('role') === 'checkbox') {
    const labels = members.map((member) => (member.getAttribute('aria-label') || member.textContent || '').replace(/\s+/g, ' ').trim());
    const allYesNo = labels.length === 2 && labels.every((label) => /^(?:yes|no|true|false)$/i.test(label));
    fieldType = allYesNo || members.length === 1 ? 'yesno' : 'choice';
    optionLabels = labels.filter(Boolean);
  }

  const attributeHints = fieldAttributeHints(field);
  const placeholder = field.getAttribute('placeholder')?.trim() || undefined;
  const inputType = field instanceof HTMLInputElement ? field.type : undefined;
  const datePart = fieldType === 'yesno' ? undefined : detectDatePart({ inputType, placeholder, attributeHints, questionParts });
  const section = sectionOf(field, attributeHints);
  // Boundary words come from the box's own labels and the wrapper label ("From", "To (Actual or Expected)").
  let dateBoundary = detectDateBoundary([...questionParts.slice(0, 3), ...attributeHints]);
  if (!dateBoundary && datePart && section?.kind === 'education' && onlyDateBoxInSection(field, datePart)) {
    // A lone "Year" box under Education is the graduation year.
    dateBoundary = 'end';
  }

  return {
    section,
    datePart,
    dateBoundary,
    placeholder,
    adapter: adapter.name,
    // The first part is the accessible, user-facing label. Keep noisy nearby
    // text, IDs, and placeholders as fallbacks instead of diluting that label.
    question: questionParts[0] ?? questionParts.join(' '),
    questionParts,
    fieldType,
    inputType,
    autocomplete: field.getAttribute('autocomplete') ?? undefined,
    attributeHints,
    groupSize: members.length,
    optionLabels,
  };
}

const hintAttributes = ['name', 'id', 'data-automation-id', 'data-qa', 'data-testid'];

/**
 * Machine names for the field, plus its Workday wrapper's (`formField-lastYearAttended`),
 * which names the question when the box itself is only `dateSectionYear-input`.
 */
function fieldAttributeHints(field: HTMLElement): string[] {
  const hints = hintAttributes.map((attribute) => field.getAttribute(attribute)?.trim() ?? '').filter(Boolean);
  const wrapper = typeof field.closest === 'function' ? field.closest('[data-automation-id^="formField-"]') : null;
  const wrapperId = wrapper?.getAttribute('data-automation-id');
  if (wrapperId && !hints.includes(wrapperId)) hints.push(wrapperId);
  return hints;
}

const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

function shortText(element: Element | null | undefined): string | undefined {
  const text = element?.textContent?.replace(/\s+/g, ' ').trim();
  return text && text.length <= 60 ? text : undefined;
}

/** Labels a container gives itself: aria-label, aria-labelledby, a fieldset legend, or machine names. */
function containerSection(element: HTMLElement): FieldSection | undefined {
  const doc = element.ownerDocument;
  const labelledBy = element.getAttribute('aria-labelledby')?.trim().split(/\s+/)
    .map((id) => shortText(doc.getElementById(id))).filter(Boolean).join(' ');
  const legend = element.tagName === 'FIELDSET'
    ? shortText(Array.from(element.children).find((child) => child.tagName === 'LEGEND'))
    : undefined;
  for (const text of [element.getAttribute('aria-label'), labelledBy, legend]) {
    const section = text ? classifySectionText(text, 'heading') : undefined;
    if (section) return section;
  }
  for (const text of [element.getAttribute('data-automation-id'), element.id]) {
    const section = text ? classifySectionText(text, 'name') : undefined;
    if (section) return section;
  }
  return undefined;
}

/**
 * The nearest repeated section around a field. Container labels win first; otherwise
 * the closest heading before the field decides, so a later "Education" heading never
 * reaches back over a "Contact information" heading.
 */
export function sectionOf(field: HTMLElement, attributeHints: string[] = []): FieldSection | undefined {
  for (const hint of attributeHints) {
    const section = classifySectionText(hint, 'name');
    if (section) return section;
  }
  let ancestor = field.parentElement;
  for (let depth = 0; ancestor && depth < 20 && ancestor !== field.ownerDocument.body; depth += 1, ancestor = ancestor.parentElement) {
    const labelled = containerSection(ancestor);
    if (labelled) return labelled;
    const headings = Array.from(ancestor.querySelectorAll<HTMLElement>(headingSelector))
      .filter((heading) => heading.tagName !== 'H1' && !heading.contains(field)
        && Boolean(heading.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING));
    const nearest = headings.at(-1);
    if (nearest) {
      const text = shortText(nearest);
      return text ? classifySectionText(text, 'heading') : undefined;
    }
  }
  return undefined;
}

/** True when the field is the only box of its date part inside its section's container. */
function onlyDateBoxInSection(field: HTMLElement, part: DatePart): boolean {
  let ancestor = field.parentElement;
  for (let depth = 0; ancestor && depth < 20 && ancestor !== field.ownerDocument.body; depth += 1, ancestor = ancestor.parentElement) {
    const isSection = Boolean(containerSection(ancestor))
      || Array.from(ancestor.querySelectorAll(headingSelector)).some((heading) => !heading.contains(field)
        && Boolean(heading.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!isSection) continue;
    const boxes = Array.from(ancestor.querySelectorAll<HTMLElement>('input, select, [role="combobox"], [aria-haspopup="listbox"], [role="spinbutton"]'))
      .filter((box) => detectDatePart({
        inputType: box instanceof HTMLInputElement ? box.type : undefined,
        placeholder: box.getAttribute('placeholder') ?? undefined,
        attributeHints: hintAttributes.map((attribute) => box.getAttribute(attribute) ?? '').filter(Boolean),
        questionParts: [box.getAttribute('aria-label') ?? '', ...(box instanceof HTMLInputElement || box instanceof HTMLSelectElement
          ? Array.from(box.labels ?? []).map((label) => label.textContent ?? '') : [])],
      }) === part);
    return boxes.length === 1;
  }
  return false;
}
