# Next steps

The extension uses local, rules-based matching. Remaining work is focused on Firefox quality and release:

1. Continue fixing dropdown questions across Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo, SmartRecruiters, and generic application forms. Prioritize real-site issues such as custom controls, option matching, and multi-step forms; update fixtures and the manual checklist to cover each confirmed fix.
2. Add a separate, user-uploadable work-history JSON format for multiple jobs, with each job's title, employer, description, start date, and end date. Define how imported work history should be matched to repeated or differently worded application fields.
3. Evaluate the opt-in feedback matcher against the unchanged baseline with a local labeled question set. Then build the planned optional Hugging Face sentence-embedding experiment in `ai/hf-embedding-lab/`; compare accuracy, abstentions, model download size, startup time, and memory before deciding whether to add a model toggle to the extension. Keep question text and answers on-device and retain the rules-based matcher as a fallback.
4. Run the manual checklist in Firefox against representative Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters application pages; fix issues found. Fixture checks alone do not establish production-site support.
5. Submit an unlisted release on addons.mozilla.org and test the signed package in Firefox.
6. Polish user-facing navigation and documentation, and prepare the Firefox listing description and screenshots.
7. Address review feedback and publish the listed Firefox release.
8. After the Firefox extension is complete and ready, port it to Chrome and verify browser API, permissions, and embedded-form behavior there.

## Current implementation notes

- Greenhouse, Workday, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters question-label adapters are implemented; supported pages also have generic field detection.
- Expanded ARIA single-select comboboxes with an exposed listbox are handled generically. The platform adapters have representative local fixture pages, but their production markup still needs real-site verification. Workday custom-control keyboard acceptance and multi-step navigation need particular attention.
- The scoring CLI, test suite, and manual browser checklist are development tools; they do not change the extension's local-only runtime behavior.
- `CONTRIBUTING.md` describes the small adapter workflow, fixture expectations, and wording-example guidance.
