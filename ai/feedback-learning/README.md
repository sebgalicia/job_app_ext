# Local feedback-based learning plan

**Status: feedback collection implemented; adaptation planned.** The Settings opt-in and explicit Useful/Wrong controls now save examples locally for review. The matcher does not use those records yet; it remains the baseline.

## What the extension will learn

It will learn which saved answer is a better fit for similar questions and how reliable a type of suggestion has been for this user. It will not silently rewrite answers, train transformer weights, or submit applications.

### Feedback signals

| User action | Learning signal | Reason |
| --- | --- | --- |
| Explicitly accepts a suggestion | Positive for that question-to-answer match | The user chose to use it |
| Explicitly marks it wrong | Negative for that question-to-answer match | The user has identified a bad suggestion |
| Starts typing over a text suggestion | Negative for the suggested question-to-answer match; store the replacement alongside it for review | The replacement may give a better answer for that question |
| Dismisses, ignores, or tabs past a suggestion | No signal | The user may be busy or may not have reviewed it |

An accepted preview counts as positive feedback. The **Wrong** action or typing over a text suggestion counts as negative feedback when learning is enabled. Dismissing a preview remains neutral.

## Proposed design

1. **Keep the original score.** The existing matcher produces a similarity score. That score is not a probability, so feedback records preserve it as a score and do not change baseline behavior.
2. **Record explicit feedback locally.** Implemented: when opted in, a deliberate preview acceptance records a useful example. The Wrong button or typing over a text suggestion records a negative example for the suggested answer. Typing a replacement also saves the replacement as `typedAnswer` for review. Records include question wording, suggested answer, answer key when available, original score, field type, and action. Ignoring or dismissing is not counted.
3. **Adapt retrieval first.** Planned: a confirmed correction should be preferred for a later, sufficiently similar question. A rejected question-to-answer pair should be down-ranked for that user. Matching an option must still select an option the page actually offers.
4. **Calibrate cautiously.** Use positive/negative history to estimate reliability for similar matches. Start with conservative prior counts, require enough feedback before changing a confidence band, and cap the adjustment so a few clicks cannot make a weak match look certain.
5. **Preserve safe thresholds.** Feedback must not lower the established high-confidence baseline or broaden generalized answers without meeting their existing confidence and margin requirements. Uncertain matches remain highlighted or blank for the user to resolve.
6. **Evaluate against a fixed baseline.** Run the same labeled questions through the current matcher and the adapted matcher. Track correct suggestions, wrong suggestions, unanswered questions, and how often the system abstains. Keep adaptation only if it improves the tradeoff.

## Privacy and user control

- Learning is off until the user enables it.
- Learned examples and calibration counts stay in local extension storage; never send them to a model host, analytics service, or server.
- Provide a review and clear-data control in Settings.
- Do not treat passive behavior as negative feedback.
- Keep feedback records separate from the user's imported answers file unless the user explicitly exports them.
- Never let feedback authorize application submission or silently override a user's saved answer.

## What this is not

This feature does **not** fine-tune a transformer. It changes local retrieval/ranking and confidence calibration around the existing matcher. That is the right first step because it can be inspected, measured, and rolled back without a large model or training toolchain.

Fine-tuning can be a later learning experiment. It would use reviewed positive and negative question pairs, train offline in a separate environment, and require a measured comparison before any updated model could be considered for the extension.

## Learning and implementation steps

1. **Done:** Trace question detection, matching, previews, acceptance, and dismissal in `src/content.ts`, `src/adapters/field.ts`, `src/matching/matcher.ts`, and `src/preview/text-preview.ts`.
2. **Done:** Define what feedback means: explicit acceptance is positive, pressing **Wrong** is negative, and dismissal or silence is unknown.
3. **Done:** Add an opt-in setting, local collection, export, and delete controls. Collection does not change matching.
4. **Next:** Add a local retrieval preference for accepted examples and down-rank explicitly rejected question-answer pairs.
5. Add conservative confidence calibration and explain the changes with small examples.
6. Compare results with the baseline, then review the feature and privacy controls before enabling any adaptation by default (a separate product decision).

Each implementation step should be small enough to review and commit independently. We will explain the idea before changing code and show what the feedback does with concrete examples.
