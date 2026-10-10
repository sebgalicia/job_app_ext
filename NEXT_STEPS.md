# Next steps

The extension currently uses local, rules-based matching. Optional local AI matching is still part of the plan, with an off-by-default setting and the rules matcher preserved as the fallback. Remaining work is focused on AI feasibility, Firefox quality, and release:

1. Evaluate a small local embedding model against the existing labeled question examples. Record matching quality, Firefox load time, memory use, and package or first-run download size before choosing a delivery method.
2. Add an off-by-default Local AI matching setting. Load the local model only when enabled and needed, retain the existing rules-based result for high-confidence matches, and use AI only as a fallback for weaker matches.
3. Run the manual checklist in Firefox against representative Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters application pages; fix issues found. Fixture checks alone do not establish production-site support.
4. Submit an unlisted release on addons.mozilla.org and test the signed package in Firefox.
5. Polish user-facing navigation and documentation, and prepare the Firefox listing description and screenshots.
6. Address review feedback and publish the listed Firefox release.
7. After the Firefox extension is complete and ready, port it to Chrome and verify browser API, permissions, and embedded-form behavior there.

The model delivery choice remains open until the evaluation records its real costs: bundling preserves the no-network runtime but increases the extension package; downloading a model only after opt-in keeps the initial package smaller but makes a one-time model download necessary. Answer data and form questions must never be sent to a service. Keep the AI path optional, lazy-loaded, and limited to weaker rules matches.

## Current implementation notes

- Greenhouse, Workday, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters question-label adapters are implemented; supported pages also have generic field detection.
- Expanded ARIA single-select comboboxes with an exposed listbox are handled generically. The platform adapters have representative local fixture pages, but their production markup still needs real-site verification. Workday custom-control keyboard acceptance and multi-step navigation need particular attention.
- The Local AI matching control in Settings is currently a disabled placeholder. AI matching is not implemented yet and does not affect results.
- The scoring CLI, test suite, and manual browser checklist are development tools; they do not change the extension's local-only runtime behavior.
- `CONTRIBUTING.md` describes the small adapter workflow, fixture expectations, and wording-example guidance.
