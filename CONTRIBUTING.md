# Contributing

Thanks for helping improve Job Autofill. The project is a small Firefox/Zen extension that stores answers locally and uses rules-based matching. Please keep changes focused and preserve the privacy and user-control rules below.

## Project rules

- Do not add network requests, analytics, remote matching, or automatic application submission.
- Do not overwrite a field that already has an answer or a real choice selected.
- Keep automatic filling opt-in and limited to the visible application step. Never add background scanning of unrelated pages.
- Prefer the generic adapter. Add ATS-specific code only to fix a demonstrated label or page-structure issue.
- Keep dependencies small. Optional local AI matching is planned, but do not add an ML library or model until its match quality, Firefox load time, memory use, and delivery size have been measured. Never send answer data or form questions to a remote service.

## Add or update an adapter

Adapters implement `FormAdapter` from `src/adapters/generic.ts`:

```ts
interface FormAdapter {
  readonly name: string;
  questionParts(field: HTMLElement): string[];
}
```

The generic adapter already looks for associated labels, accessible names, fieldset legends, nearby text, names, IDs, and placeholders. A site adapter should delegate to `GenericAdapter`, then add only a reliable ATS-specific question label when generic discovery misses it. Keep labels short and avoid treating answer choices or unrelated section text as the question.

To add a supported ATS:

1. Add a small adapter in `src/adapters/` only when a real form demonstrates the need.
2. Route its recognized hostname in `src/adapters/index.ts`.
3. Add the hostname to the Firefox content-script matches in `manifest.json` and the supported-host list in `src/popup/popup.ts`.
4. Add a sanitized representative HTML fixture in `fixtures/` and allowlist its filename in `scripts/serve-fixtures.mjs`.
5. Update `MANUAL_TESTING.md` and `NEXT_STEPS.md`. Record production-site verification separately from fixture coverage.

Do not claim that an ATS works on every employer's form because one fixture passes. Employers can customize their fields, labels, steps, and widgets.

## Add question wording examples

The matcher compares saved question wordings with detected form labels. When fixing a wording gap, add examples that cover both the wording that should match and a nearby wording that should not. For yes/no facts, include reversed and ambiguous phrasing so the polarity logic does not turn a risky guess into a match.

For CLI evaluation, add sanitized rows to `questions.csv`. Use `expected_key` for the expected answer entry and `expected_value` for an expected choice label. Keep private user answers and personal data out of committed fixtures and CSV files.

## Local development checks

Install dependencies, build, and run the automated checks:

```sh
npm install
npm test
npm run lint:extension
```

Use `npm run serve:fixtures` to open sanitized forms locally. Follow [MANUAL_TESTING.md](MANUAL_TESTING.md) in Firefox; a passing unit test or fixture does not replace checking interactive browser behavior.

To inspect matcher behavior with a private answers file:

```sh
npm run score -- --answers answers.json --input questions.csv --out results.csv
```

To compare the experimental local embedding ranker with the rules matcher on labeled examples:

```sh
npm run evaluate:embeddings -- --answers answers.json --input questions.csv --out embedding-results.csv
```

This downloads the model for local development into the operating system's temporary directory. It is not part of the extension build. Keep personal answers and question wordings out of committed files.

Do not commit personal answers or generated result files.
