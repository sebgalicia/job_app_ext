# Next steps

The MVP uses local, rules-based matching. It does not include an AI model. The following work is intentionally deferred until after the MVP is tested:

1. Add a Workday adapter for custom dropdowns and multi-step pages. Verify keyboard acceptance on Workday's custom elements early.
2. Add dedicated Lever and Ashby adapters.
3. Optionally add local AI matching behind an off-by-default switch. Evaluate a small in-browser embedding model with Transformers.js; load it only on demand, release it after use, and measure real memory use in Firefox before documenting it. Use it only when rules matching falls below its threshold.
4. Publish a listed release on addons.mozilla.org after an unlisted review and test release.
5. Add a contribution guide for adapters and the wording test list.

## Current implementation notes

- Greenhouse has a dedicated adapter; supported pages also have generic field detection.
- Workday, Lever, and Ashby do not yet have dedicated adapters. Custom controls and multi-step navigation need real-site testing.
- The Local AI matching control in Settings is disabled placeholder text. It does not load a model or affect matching.
- The scoring CLI, test suite, and manual browser checklist are development tools; they do not change the extension's local-only runtime behavior.
