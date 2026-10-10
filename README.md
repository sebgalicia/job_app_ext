# Job Autofill

A lightweight Firefox and Zen extension for previewing answers from a private, user supplied file while filling job applications. It keeps its data in the browser and does not send answer data to a server.

## Current status

The extension can import and export an answers JSON file from its settings page, detect fields on supported job boards, and preview matching text and choice answers. Its optional **Fill matching fields as each step opens, then wait** setting fills visible, empty fields with Medium confidence or above when the page opens. On multi-step forms, it waits for you to press a Next or Continue button before checking the newly shown step. It does not submit the form or show focus previews while this mode is on. The setting is off by default; already-filled fields are left alone. The toolbar popup shows an editable company and role, a site on/off switch, and the number of matched fields in the current tab. You can opt in to tracking an application when saving its company and role; tracked entries remain in local browser storage and link back to the application page. Settings also let you tune the high and medium question-match thresholds. On other sites, use **Enable on this page** in the popup to grant temporary access for that tab.

## Development setup

Install dependencies and build the extension (the build also compiles the JSON Schema into standalone validation code):

```sh
npm install
npm run build
```

The generated extension is in `dist/`. To run it with web-ext, use:

```sh
npx web-ext run --source-dir dist
```

You can also load it manually in Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on...**, and select `dist/manifest.json`. The extension requires Firefox 140 or newer. Rebuild after changing static HTML, CSS, or the answer schema.

To open the local test forms, start the fixture server in another terminal with `npm run serve:fixtures`, then visit a fixture such as `http://127.0.0.1:4173/icims-form.html`, `taleo-form.html`, or `smartrecruiters-form.html`. Since localhost is not a built-in supported host, click the extension toolbar button and choose **Enable on this page** to grant access for that tab. These static fixtures exercise adapter label handling; they do not prove compatibility with every production ATS form.

## Answers file

`template.json` is a starter file. Make a private copy and edit its `profile`, `facts`, and `answers` sections. `answers.schema.json` provides editor hints and validation for that format. Open the extension settings page to import the file; invalid files show errors and are not saved. Use **Export saved answers** to download the current local copy.

## How answer matching works

The current extension uses local, rule-based matching. It does not use an AI model or send form questions to a service. When you focus an empty supported field, it gathers the available question text (such as labels and accessible names) and compares it with the wording attached to your saved answers. It uses the best matching wording for each answer.

Optional local AI matching is planned behind an off-by-default setting. It is not implemented yet, so the Local AI matching control in Settings remains disabled and has no effect on scoring. The planned AI path will load only when enabled and needed, and will supplement weaker rules matches while leaving high-confidence rules matches unchanged. The project will measure model size and Firefox memory use before choosing whether the model ships with the extension or downloads after opt-in.

Before comparing, matching lowercases the text, removes punctuation and common filler words, lightly normalizes word endings, and treats a small built-in set of terms as synonyms. For example, “job title” and “position” can be related. It then combines three similarity measures: weighted word overlap, shared unique words, and character patterns that can tolerate some typos. These are heuristics; unusual wording can still match incorrectly or fail to match.

The **High confidence** and **Medium confidence** sliders control question-to-answer matching. Their defaults are `0.72` and `0.50`. Scores at or above High get a normal preview; scores from Medium up to High get a highlighted preview; lower scores produce no preview. Medium must stay below High. The score is a similarity score, not a probability that the answer is correct. The optional automatic filling setting uses the Medium threshold as its minimum and also fills High matches.

For a choice field, the extension first tries to match the saved answer directly to one offered label or value. If that fails, it can generalize a free-text answer to a broader offered choice only when the question wording score is at least `0.85` and beats the next-best question match by at least `0.08`. For example, “SE Asian” can fit the offered option “Asian.” If equally specific choices fit, it leaves the choice unanswered. This stricter fallback is independent of the settings sliders.

Yes/no facts such as sponsorship, work authorization, relocation, and age use topic and negation rules. The rules look for negation attached to the relevant topic, so “I do not need sponsorship” can map to the saved sponsorship fact. Ambiguous wording or options do not get guessed.

## Preview and acceptance behavior

- The extension only looks for an answer after a supported field gets focus, and previews one field at a time.
- It never previews over a text field that already contains text or a choice field that already has a real selection. A blank or “Select…” dropdown option counts as empty.
- A normal text preview appears as placeholder text. Press **Tab** to accept it; typing dismisses it, and **Esc** dismisses it without filling.
- A choice preview outlines the suggested option. Press **Tab** to accept a normal suggestion.
- Medium-confidence and sensitive suggestions (including sponsorship, work authorization, salary, demographic, and entries marked `sensitive`) are highlighted. Press **Enter** to accept a highlighted suggestion; **Tab** moves on without accepting it.
- `{company}` and `{role}` are filled from the popup’s detected or edited values. If either value is missing, the preview marks it and blocks acceptance until the value is supplied.

Review previews before accepting them. With automatic filling off, the extension previews one suggestion at a time. With it on, the extension fills eligible fields as each step opens and waits for you to press Next or Continue before checking another step; review all filled values before submitting. It never submits applications.

## Evaluate question matching

The scoring CLI first builds the extension (including its generated JSON validator), then runs the same question matcher and yes/no polarity rules used by the extension against a CSV of sample questions. It does not call an AI service. Run it with an answers file and an input CSV:

```sh
npm run score -- --answers answers.json --input questions.csv --out results.csv
```

`questions.csv` must have a `question` column. An optional `options` column contains choices separated by `|`. Optional `expected_key` values identify the expected answer entry (for example, `answers[3]`); `expected_value` can hold the expected selected option label. The CLI copies either expected column into `results.csv` unchanged. `questions.csv` in this repository includes tricky example wording for sponsorship, work authorization, relocation, and age questions.

The results include the best and runner-up answer keys and scores, confidence, any detected yes/no topic and polarity flips, and the option the shared choice logic selected. Scores help inspect errors; they are similarity scores, not probabilities. Rows with an empty `expected_key` are unlabeled and should not be included in answer-key accuracy calculations.

For example, use pandas to calculate labeled answer-key accuracy by detected topic:

```python
import pandas as pd

results = pd.read_csv("results.csv")
labeled = results[results["expected_key"].notna() & results["expected_key"].ne("")].copy()
labeled["correct"] = labeled["best_key"] == labeled["expected_key"]
print(labeled.groupby("detected_topic")["correct"].agg(["mean", "count"]))
```

To explore a stricter high-confidence cutoff, sweep the saved best scores and compare both accuracy and coverage. This analysis does not change the extension settings:

```python
for cutoff in [0.60, 0.65, 0.70, 0.72, 0.75, 0.80, 0.85]:
    accepted = labeled[labeled["best_score"] >= cutoff]
    accuracy = accepted["correct"].mean() if len(accepted) else float("nan")
    coverage = len(accepted) / len(labeled) if len(labeled) else 0
    print(f"{cutoff:.2f}: accuracy={accuracy:.3f}, coverage={coverage:.3f}")
```

When rows have expected option labels, compare `chosen_option` with `expected_value` separately to evaluate option selection.

## Privacy

Imported answers, site preferences, company and role context, matching thresholds, the automatic filling preference, and any opt-in tracked applications are saved in `browser.storage.local` on this device. The extension does not transmit this data. You can remove it by clearing the extension’s local storage or removing the extension. No analytics or remote matching service is used.

See [PRIVACY.md](PRIVACY.md) for the short privacy statement.

## Manual browser checks

Automated tests cover individual logic, but do not replace trying the extension in Firefox. Follow the [manual test checklist](MANUAL_TESTING.md) before relying on it for real applications.

## Publishing

Build and package the generated `dist/` directory with `npx web-ext build --source-dir dist`. Submit the package through the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/) as an unlisted add-on first. Test the signed unlisted version, address review feedback, and then submit it for a listed release. Mozilla’s review and signing requirements may change, so follow the current instructions in the Developer Hub before submission.

## Project status and next steps

The current implementation and remaining roadmap are summarized in [NEXT_STEPS.md](NEXT_STEPS.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for adapter, fixture, and wording-example guidance.
