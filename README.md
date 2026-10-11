# Job Autofill

A lightweight Firefox and Zen extension that helps you answer repeat questions on job applications using answers you save yourself. It keeps your answers in local browser storage and does not send them to a server.

## Who it helps

Job seekers who are tired of repeatedly entering the same profile details and answers across application forms. The extension can suggest saved answers as you focus fields, or optionally fill eligible fields as each application step opens so you can review them before continuing.

## What it does

- Finds questions on supported application sites and compares them with wording in your answers file.
- Shows one field preview at a time, or optionally fills visible, empty fields when a step opens.
- Leaves fields with existing answers alone and never submits an application.
- Lets you save company and role details and optionally track applications locally.
- Works with a rules-based matcher; it does not use an AI model or remote matching service.

**Availability:** The extension is not yet published on AMO. To try it, build it from this repository and load the temporary add-on in Firefox. Firefox 140 or newer is required.

## Get started

1. Install Node.js, then open a terminal in the repository folder.
2. Install dependencies and build the extension:

   ```sh
   npm install
   npm run build
   ```

3. In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on...**, and select `dist/manifest.json`.
4. Open the extension's Settings, import your answers file, and visit an application page.

The temporary add-on stays installed until Firefox restarts. Build again after changing source code, HTML, CSS, or the answer schema.

## Prepare your answers

Start with [`template.json`](template.json), which contains fake example details. In VS Code, open it and choose **File > Save As...**, then save your copy in the repository root as `answers.private.json`. That filename is ignored by Git, so it will not appear as a file to commit. You can also save it outside this repository if you prefer. Do not put real details in `template.json`.

Edit `answers.private.json` and replace the examples in `profile`, `facts`, and `answers` with your own information. The [`answers.schema.json`](answers.schema.json) file describes the format and enables editor hints in tools such as VS Code. In the extension's Settings, import your private copy; invalid files are rejected with specific errors. Importing stores the answers in the browser's local storage on your device. You can export the saved copy from Settings as well.

If you choose a different filename inside the repository, add it to `.gitignore` before committing. Never commit a completed answers file or share it publicly; you do not need to send your personal answers to anyone to use the extension.

Keep personal answers private. Do not add your completed answers file to this repository.

## Preview and automatic filling

With automatic filling off, focus an empty field to see a suggestion. **Tab** accepts a normal suggestion. Medium-confidence and sensitive suggestions are highlighted and require **Enter**; **Tab** moves on without accepting them. Typing dismisses a text preview, and **Esc** dismisses it without filling. The extension does not overwrite a field that already has text or a real choice selected.

The optional **Fill matching fields as each step opens, then wait** setting fills visible, empty fields with Medium confidence or above. It then waits for you to press Next or Continue before checking the newly opened step. Review the values before submitting; the extension never submits applications.

On a site outside the supported list, use **Enable on this page** in the popup to grant temporary access for that tab. The popup also lets you edit detected company and role details and turn the extension off for a site.

## Privacy

Answers, preferences, thresholds, company and role context, and opt-in tracked applications are saved in `browser.storage.local` on your device. The extension does not transmit them. See [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Supported sites

Built-in page access covers Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters. A generic form adapter handles common field markup, and you can temporarily enable the extension on other sites from the popup. Employers customize their forms, so support for one company's form does not guarantee every form on that platform works.

## Project files

| Location | Purpose |
| --- | --- |
| `src/adapters/` | Generic and ATS-specific question label discovery |
| `src/matching/` | Question similarity, normalization, and yes/no polarity rules |
| `src/preview/` | Preview and acceptance behavior |
| `src/popup/`, `src/settings/` | Extension popup and settings interface |
| `fixtures/` | Local sample application forms for manual checks |
| `examples/questions.csv` | Sanitized sample questions for the scoring CLI |
| `tests/` | Automated unit and integration tests |
| `scripts/` | Build, scoring CLI, and local fixture server |
| `docs/` | Privacy, manual testing, roadmap, and archived project brief |
| `template.json`, `answers.schema.json` | Starter answers file and its schema |

## For contributors

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the adapter workflow, fixture guidance, and project rules. Before relying on browser behavior, follow the [Firefox manual checklist](docs/MANUAL_TESTING.md). The [roadmap](docs/NEXT_STEPS.md) lists remaining release work.

### Try a local form

Start the fixture server in a terminal:

```sh
npm run serve:fixtures
```

Open a sample URL such as `http://127.0.0.1:4173/workday-form.html`. Since localhost is not a built-in supported host, click the extension toolbar button and choose **Enable on this page**. These sanitized fixtures are repeatable examples; they do not prove compatibility with every production form.

### Build, test, and lint

```sh
npm run build
npm test
npm run lint:extension
```

The build compiles the JSON schema into standalone validation code. `dist/` is generated output and is not checked into source control.

## How matching works

This section is for readers who want the implementation details. Matching lowercases text, removes punctuation and common filler words, lightly normalizes word endings, and expands a small synonym list. It combines weighted word overlap, token-set overlap, and character-trigram similarity to tolerate some wording differences and typos. The score is a similarity score, not a probability.

The High and Medium thresholds default to `0.72` and `0.50`. High matches get a normal preview, Medium matches get a highlighted preview, and weaker matches produce no preview. Medium must remain below High.

For choices, the extension first looks for a direct match between the saved answer and an offered option. A broader option can be suggested for a free-text answer only when the question match reaches `0.85` and leads the next-best question match by at least `0.08`; if multiple options fit equally well, it leaves the field unanswered. Yes/no facts use topic and negation rules to account for reversed questions. Ambiguous wording is not guessed.

### Inspect matching with the scoring CLI

Run the same matcher and polarity logic used by the extension against a CSV:

```sh
npm run score -- --answers answers.json --input examples/questions.csv --out results.csv
```

The input needs a `question` column. An optional `options` column contains choices separated by `|`. `expected_key` and `expected_value` let you label expected answers and choices; those columns are copied to the results. The output includes the best and runner-up answer keys and scores, confidence, detected yes/no topic, polarity flips, and chosen option. Unlabeled rows should be excluded from accuracy calculations.

Use pandas to summarize labeled answer-key accuracy by topic:

```python
import pandas as pd

results = pd.read_csv("results.csv")
labeled = results[results["expected_key"].notna() & results["expected_key"].ne("")].copy()
labeled["correct"] = labeled["best_key"] == labeled["expected_key"]
print(labeled.groupby("detected_topic")["correct"].agg(["mean", "count"]))
```

You can sweep score cutoffs to compare accuracy with coverage. This analysis does not change extension settings. Compare `chosen_option` with `expected_value` separately when evaluating choice selection.

## Publishing

Build the package with `npx web-ext build --source-dir dist`. It writes the ZIP archive to `web-ext-artifacts/`, which is ignored by Git. Submit it through the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/) as an unlisted add-on first, test the signed version, address review feedback, and then submit for a listed release. Check the current Developer Hub guidance before submission.
