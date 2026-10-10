# Next steps

The extension currently uses local, rules-based matching. Optional local AI matching is still part of the plan, with an off-by-default setting and the rules matcher preserved as the fallback. Remaining work is focused on AI feasibility, Firefox quality, and release:

1. Done for an initial development-only benchmark: `evaluate:embeddings` compares int8 MiniLM with rules matching on labeled questions. On the repository's 31 labeled sample questions, embeddings ranked the expected key first for 30, versus 28 for rules, but once confused sponsorship with work authorization. This is too small a sample to set a production threshold; yes/no topic and polarity rules must constrain any future AI fallback.
2. Profile the model in Firefox and decide whether its 22.6 MB cached model files should be bundled or downloaded only after opt-in. Record real Firefox load time and memory use before enabling any shipped AI setting; the Node measurements from the experiment are not Firefox measurements.
3. Add an off-by-default Local AI matching setting. Load the local model only when enabled and needed, retain the existing rules-based result for high-confidence matches, and use AI only as a fallback for weaker matches.
4. Run the manual checklist in Firefox against representative Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters application pages; fix issues found. Fixture checks alone do not establish production-site support.
5. Submit an unlisted release on addons.mozilla.org and test the signed package in Firefox.
6. Polish user-facing navigation and documentation, and prepare the Firefox listing description and screenshots.
7. Address review feedback and publish the listed Firefox release.
8. After the Firefox extension is complete and ready, port it to Chrome and verify browser API, permissions, and embedded-form behavior there.

The model delivery choice remains open until the evaluation records its real costs: bundling preserves the no-network runtime but increases the extension package; downloading a model only after opt-in keeps the initial package smaller but makes a one-time model download necessary. Answer data and form questions must never be sent to a service. Keep the AI path optional, lazy-loaded, and limited to weaker rules matches.

## Current implementation notes

- Greenhouse, Workday, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters question-label adapters are implemented; supported pages also have generic field detection.
- Expanded ARIA single-select comboboxes with an exposed listbox are handled generically. The platform adapters have representative local fixture pages, but their production markup still needs real-site verification. Workday custom-control keyboard acceptance and multi-step navigation need particular attention.
- The Local AI matching control in Settings is currently a disabled placeholder. AI matching is not implemented yet and does not affect results. `npm run evaluate:embeddings` is a separate developer experiment; Transformers.js is not bundled into the extension.
- The scoring CLI, test suite, and manual browser checklist are development tools; they do not change the extension's local-only runtime behavior.
- `CONTRIBUTING.md` describes the small adapter workflow, fixture expectations, and wording-example guidance.
