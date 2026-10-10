# Next steps

The extension uses local, rules-based matching. Remaining work is focused on Firefox quality and release:

1. Run the manual checklist in Firefox against representative Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters application pages; fix issues found. Fixture checks alone do not establish production-site support.
2. Submit an unlisted release on addons.mozilla.org and test the signed package in Firefox.
3. Polish user-facing navigation and documentation, and prepare the Firefox listing description and screenshots.
4. Address review feedback and publish the listed Firefox release.
5. After the Firefox extension is complete and ready, port it to Chrome and verify browser API, permissions, and embedded-form behavior there.

## Current implementation notes

- Greenhouse, Workday, Lever, Ashby, iCIMS, Taleo, and SmartRecruiters question-label adapters are implemented; supported pages also have generic field detection.
- Expanded ARIA single-select comboboxes with an exposed listbox are handled generically. The platform adapters have representative local fixture pages, but their production markup still needs real-site verification. Workday custom-control keyboard acceptance and multi-step navigation need particular attention.
- The scoring CLI, test suite, and manual browser checklist are development tools; they do not change the extension's local-only runtime behavior.
- `CONTRIBUTING.md` describes the small adapter workflow, fixture expectations, and wording-example guidance.
