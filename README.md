# Job Autofill

A lightweight Firefox and Zen extension for previewing answers from a private, user supplied file while filling job applications. It keeps its data in the browser and does not send answer data to a server.

## Current status

The extension can import and export an answers JSON file from its settings page, detect focused fields on supported job boards, and preview matching text and native choice answers. The toolbar popup shows an editable company and role, a site on/off switch, and the number of matched fields in the current tab. You can opt in to tracking an application when saving its company and role; tracked entries remain in local browser storage and link back to the application page. Settings also let you tune the high and medium question-match thresholds. On other sites, use **Enable on this page** in the popup to grant temporary access for that tab.

## Development setup

Install dependencies and build the extension (the build also compiles the JSON Schema into standalone validation code):

```sh
npm install
npm run build
```

The generated extension is in `dist/`. To load it in Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `dist/manifest.json`. The `web-ext run` workflow will be documented when the development scripts are ready.

## Answers file

`template.json` is a starter file. Make a private copy and edit its `profile`, `facts`, and `answers` sections. `answers.schema.json` provides editor hints and validation for that format. Open the extension settings page to import the file; invalid files show errors and are not saved. Use **Export saved answers** to download the current local copy.

## How answer matching works

The extension uses local, rule-based matching. It does not use an AI model or send form questions to a service. When you focus an empty supported field, it gathers the available question text (such as labels and accessible names) and compares it with the wording attached to your saved answers. It uses the best matching wording for each answer.

The Local AI matching control in Settings is a disabled placeholder only. It does not load an AI model or participate in scoring.

Before comparing, matching lowercases the text, removes punctuation and common filler words, lightly normalizes word endings, and treats a small built-in set of terms as synonyms. For example, “job title” and “position” can be related. It then combines three similarity measures: weighted word overlap, shared unique words, and character patterns that can tolerate some typos. These are heuristics; unusual wording can still match incorrectly or fail to match.

The **High confidence** and **Medium confidence** sliders control question-to-answer matching. Their defaults are `0.72` and `0.50`. Scores at or above High get a normal preview; scores from Medium up to High get a highlighted preview; lower scores produce no preview. Medium must stay below High. The score is a similarity score, not a probability that the answer is correct.

For a choice field, the extension first tries to match the saved answer directly to one offered label or value. If that fails, it can generalize a free-text answer to a broader offered choice only when the question wording score is at least `0.85` and beats the next-best question match by at least `0.08`. For example, “SE Asian” can fit the offered option “Asian.” If equally specific choices fit, it leaves the choice unanswered. This stricter fallback is independent of the settings sliders.

Yes/no facts such as sponsorship, work authorization, relocation, and age use topic and negation rules. The rules look for negation attached to the relevant topic, so “I do not need sponsorship” can map to the saved sponsorship fact. Ambiguous wording or options do not get guessed.

## Preview and acceptance behavior

- The extension only looks for an answer after a supported field gets focus, and previews one field at a time.
- It never previews over a text field that already contains text or a choice field that already has a real selection. A blank or “Select…” dropdown option counts as empty.
- A normal text preview appears as placeholder text. Press **Tab** to accept it; typing dismisses it, and **Esc** dismisses it without filling.
- A choice preview outlines the suggested option. Press **Tab** to accept a normal suggestion.
- Medium-confidence and sensitive suggestions (including sponsorship, work authorization, salary, demographic, and entries marked `sensitive`) are highlighted. Press **Enter** to accept a highlighted suggestion; **Tab** moves on without accepting it.
- `{company}` and `{role}` are filled from the popup’s detected or edited values. If either value is missing, the preview marks it and blocks acceptance until the value is supplied.

Review previews before accepting them. The extension previews one suggestion at a time; it does not submit applications or fill the whole page automatically.

## Privacy

Imported answers, site preferences, company and role context, matching thresholds, and any opt-in tracked applications are saved in `browser.storage.local` on this device. The extension does not transmit this data. You can remove it by clearing the extension’s local storage or removing the extension. No analytics or remote matching service is used.

## Publishing

The planned release process is to first publish an unlisted build on addons.mozilla.org for review, then publish a listed release. Packaging and signing instructions will be added before release.
