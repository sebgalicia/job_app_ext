# Next steps

The MVP uses local, rules-based matching. It does not include an AI model. The following work is intentionally deferred until after the MVP is tested:

1. Verify the Workday adapter's custom dropdown keyboard behavior and multi-step navigation on a real application.
2. Verify Lever and Ashby label discovery on real application pages and adjust the first-pass wrapper selectors where needed.
3. Optionally add local AI matching behind an off-by-default switch. Evaluate a small in-browser embedding model with Transformers.js; load it only on demand, release it after use, and measure real memory use in Firefox before documenting it. Use it only when rules matching falls below its threshold.
4. Publish a listed release on addons.mozilla.org after an unlisted review and test release.
5. Add a contribution guide for adapters and the wording test list.
6. After the Firefox extension is complete and ready, port it to Chrome and verify browser API, permissions, and embedded-form behavior there.

## Current implementation notes

- Greenhouse, Workday, Lever, and Ashby question-label adapters are implemented; supported pages also have generic field detection.
- Expanded ARIA single-select comboboxes with an exposed listbox are handled generically. Workday, Lever, and Ashby adapters have local fixture pages, but their production markup still needs real-site verification. Workday custom-control keyboard acceptance and multi-step navigation need particular attention.
- The Local AI matching control in Settings is disabled placeholder text. It does not load a model or affect matching.
- The scoring CLI, test suite, and manual browser checklist are development tools; they do not change the extension's local-only runtime behavior.
