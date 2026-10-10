You are building an open-source Firefox/Zen browser extension (Zen is Firefox-based) that helps job seekers fill application forms from their own saved answers. Build the minimum viable product (MVP) first, fully working and tested, then write NEXT_STEPS.md. Do not build roadmap items yet.

## Core principles
- Lightweight. No background work on unrelated sites.
  - Content scripts run only on: *.myworkdayjobs.com, *.myworkday.com, boards.greenhouse.io, job-boards.greenhouse.io (including /embed/*), jobs.lever.co, jobs.ashbyhq.com.
  - Set "all_frames": true so the extension also works inside Greenhouse forms embedded on company career pages.
  - Anywhere else, run only when the user clicks the toolbar button (activeTab).
  - On a matched page, do nothing until the user focuses a form field.
- Private. No network requests of any kind. All data lives in browser.storage.local.
- Never overwrite. Never preview or fill a field that already has a value.
  - A dropdown counts as empty when its selected option is a placeholder: an empty value, or text like "Select...", "Choose...", "Please select", or "--".
- No AI in the MVP. Matching is rules-only.

## Tech stack (use exactly this)
- TypeScript, compiled with esbuild to readable, unminified output.
- Firefox WebExtensions, Manifest V3, with:
  "browser_specific_settings": { "gecko": { "id": "@job-autofill", "strict_min_version": "140.0", "data_collection_permissions": { "required": ["none"] } } }
- No UI framework. Use plain HTML/CSS for the popup and settings, and a small in-page overlay for previews.
- JSON validation with Ajv, PRECOMPILED AT BUILD TIME using Ajv's standalone code option. The MV3 content security policy blocks runtime code generation, so the extension must never use eval or new Function.
- Matching and polarity logic is hand-written TypeScript. No ML libraries.
- Vitest for unit tests, plus HTML fixture pages for manual testing.
- web-ext for running, linting, and signing. `web-ext lint` must pass with no errors.
- GitHub Actions runs the tests and web-ext lint on every push.

## Answers file (JSON)
The user writes one JSON file and imports it on the settings page.

Ship these with the extension:
- `template.json`, a starter file with an "_instructions" field and an example of every entry type.
- `answers.schema.json`, so VS Code shows hints, autocompletes field names, and flags errors as you type.
- A short guide in the README.

The file has three sections:
- "profile": firstName, lastName, email, phone, address, city, state, zip, country, linkedin, github, website, school, degree, major, gradYear.
- "facts": stored facts for common yes/no topics, e.g. "needsSponsorship": false, "authorizedToWork": true, "willingToRelocate": true, "over18": true. It also holds optional salary text and optional demographic answers; any of these may be left out.
- "answers": an array of entries shaped { "questions": [several wordings], "type": "text" | "choice" | "yesno", "answer": string or boolean, "sensitive": optional boolean }.

Answers may contain the {company} and {role} placeholders.

On import, validate the file and show clear errors with their location, e.g. "answers[3].type must be text, choice, or yesno". Never fail silently.

## Question detection
- For each focused input, textarea, select, radio group, or checkbox group, build its question text from: the label element, aria-label, aria-labelledby, the fieldset legend, nearby preceding text, the name and id attributes, and the placeholder.
- Include a generic adapter that works on any form, and a Greenhouse adapter.
- Put adapters behind a small interface so Workday, Lever, and Ashby adapters can be added later.

## Matching (no AI)
- Normalize text before comparing:
  - lowercase it and strip punctuation,
  - remove stopwords,
  - apply light stemming,
  - expand a built-in synonym list (company/employer/organization, job/role/position, and so on).
- Score similarity as a weighted blend of three measures:
  - TF-IDF-weighted token cosine similarity, with IDF computed over all question wordings in the user's file,
  - token-set overlap,
  - character-trigram similarity, so typos still match.
- Compare against every question wording in the file and keep the best score.
- Use two thresholds:
  - high: a confident, normal preview,
  - medium: a highlighted preview,
  - below medium: no preview.
- For profile fields, also match on the autocomplete attribute and the input type (email, tel).

## Yes/no and reversed wording
1. Topic: detect it by keywords. "sponsor" or "visa" means sponsorship. "authorized", "eligible", or "legally" means authorization. "relocate" means relocation. Add others as needed.
2. Polarity: count a negation ("not", "no", "never", "without", "don't", "won't", "no longer") only when it attaches directly to the topic phrase, e.g. "not require sponsorship" or "without sponsorship". Don't count negations that attach to other words, e.g. "authorized to work without restriction", "unless", or "other than". An odd count means the question is reversed; an even count means it isn't.
3. Options: run the same polarity check on each answer option, then pick the option whose meaning matches the stored fact.
4. Ambiguity: if the negations are tangled or no option clearly matches, show a highlighted preview or none. Never guess.

This must handle radio groups, checkboxes, native selects, and options worded like "Yes, I am authorized" or "I will not require sponsorship".

## Preview and accept
- Show a preview only in the focused field, one field at a time. Never fill the whole page at once.
- Text fields: show the answer as gray ghost text.
  - Tab accepts it and moves to the next field.
  - Typing any character dismisses the preview and leaves the user in control.
  - Esc dismisses it, so a following Tab leaves the field blank.
- Choice fields: visually outline the option that would be picked. Tab accepts it and moves on.
- Highlighted previews do NOT accept on Tab; they need Enter, and Tab moves on and leaves the field blank. A preview is highlighted when it is a medium-confidence match, or when it is sensitive (sponsorship, authorization, salary, demographics, or any entry with "sensitive": true).
- Only one active preview at a time, clearly outlined.
- Intercept Tab, Enter, and Esc only while a preview is showing on the focused field, and call preventDefault only then. Enter must never submit the form by accident, and normal typing must never be affected.
- Fill values using the native value setter plus input and change events, so React and similar frameworks register the change.

## Placeholders
- Detect {company} and {role} from the page title and headings.
- Show the detected values in the toolbar popup, where the user can edit them.
- Never insert a literal {company} or {role}. If a value wasn't detected, show the preview highlighted with the missing part marked, and block accepting it until the user enters the value in the popup.

## Popup and settings
- Popup: the detected company and role (editable), an on/off switch for the current site, and how many fields on the page matched.
- Settings page:
  - import and export of the JSON file,
  - validation results,
  - sliders for the two thresholds,
  - a disabled "Local AI matching (coming later)" switch.

## Matcher evaluation CLI
- Add `scripts/score.ts`, run as `npm run score -- --answers answers.json --input questions.csv --out results.csv`.
- It must import the SAME matcher and polarity modules the extension uses. No duplicated logic.
- Input CSV columns:
  - question
  - options (pipe-separated, optional)
  - expected_key (optional)
  - expected_value (optional)
- Output CSV columns:
  - question
  - best_key, best_score
  - second_key, second_score
  - confidence (high/medium/none)
  - detected_topic
  - polarity_flips
  - chosen_option
  - the expected columns, passed through unchanged
- Include a sample questions.csv containing the tricky wordings from the tests.
- In the README, document how to analyze results.csv with Python/pandas: accuracy by topic and a threshold sweep.

## Tests
- Vitest unit tests covering normalization, similarity scoring, and polarity detection.
- At least 40 real-style wordings, including:
  - "Are you authorized to work without restriction?"
  - "Will you now or in the future require sponsorship?"
  - "Can you work in the US without sponsorship?"
  - "Do you not require visa support?"
  - options such as "I do not need sponsorship".
- HTML fixture pages for a Greenhouse-style form, an embedded Greenhouse iframe, and a generic form.
- A manual test checklist covering:
  - previews appear only on focus,
  - Tab accepts,
  - typing overrides,
  - Esc clears,
  - filled fields and real dropdown choices are never touched,
  - sensitive fields need Enter,
  - missing placeholders block acceptance.

## Deliverables
- Source code, manifest, template.json, answers.schema.json, the scoring CLI, tests, and the CI config.
- A README covering: install for development (`web-ext run`, or about:debugging and Load Temporary Add-on), the answers file format, privacy (no data collected, nothing leaves the device), and how to publish (unlisted first, then listed).
- A short PRIVACY.md stating that no data is collected or transmitted.
- NEXT_STEPS.md, in this order:
  1. Workday adapter, handling custom dropdowns and multi-step pages. Verify early that keyboard accept works on Workday's custom elements.
  2. Lever and Ashby adapters.
  3. Optional local AI matching behind an off-by-default switch, using a small in-browser embedding model via Transformers.js. Load it only on demand, free it afterward, and measure real memory use in Firefox before documenting it. Use it only when rules matching falls below threshold.
  4. A listed release on addons.mozilla.org.
  5. A contribution guide for adapters and the wording test list.

When finished, report what works, what is stubbed, and how to run the tests and the scoring CLI.
