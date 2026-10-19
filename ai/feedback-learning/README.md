# Local feedback-based learning plan

**Status: local feedback collection, retrieval preferences, and responsive confidence calibration implemented.** When enabled, strongly similar prior questions can favor an accepted saved answer, suppress a saved answer the user changed, and adjust the personalized confidence score after every matching feedback event.

## What the extension will learn

It will learn which saved answer is a better fit for similar questions and how reliable a type of suggestion has been for this user. It will not silently rewrite answers, train transformer weights, or submit applications.

### Feedback signals

| User action | Learning signal | Reason |
| --- | --- | --- |
| Accepts or chooses the suggested value | Positive for that question-to-answer match | The final answer agrees with the suggestion |
| Chooses a different dropdown option | Negative for the suggested option; save the selected option for review | The final answer differs from the suggestion |
| Types the same text as the suggestion | Positive for that question-to-answer match | The final answer agrees with the suggestion |
| Types different text over a suggestion | Negative for the suggested answer; save the replacement text for review | The final answer differs from the suggestion |
| Dismisses, ignores, or leaves without accepting | No signal | The user may be busy or may not have reviewed it |

When learning is enabled, the extension compares the suggestion with the final value: the same value counts as useful, and a different value counts as wrong. Dismissing a preview remains neutral.

### Record format

Each local `suggestionFeedback` record has this shape:

```json
{
  "timestamp": "2026-10-19T14:30:00.000Z",
  "action": "wrong",
  "question": "What is your degree?",
  "answer": "Bachelor's degree",
  "typedAnswer": "Bachelor of Science",
  "answerKey": "profile.degree",
  "fieldType": "text",
  "score": 0.81
}
```

`answer` is always the extension's proposal. `typedAnswer` appears when the user enters different text; `replacementAnswer` appears when the user picks a different dropdown option. `answerKey` and `score` are optional when there was no saved candidate key or comparable score. The score is the matcher's lexical similarity score, not a probability. Records are validated before saving, stored locally, and capped at 1,000 entries.

## Proposed design

1. **Keep the original score.** The existing matcher produces a similarity score. That score is not a probability, so feedback records preserve it as a score and do not change baseline behavior.
2. **Record explicit feedback locally.** Implemented: when opted in, accepting a suggestion, entering the same text, or choosing the same dropdown option records a useful example. Entering different text or choosing a different dropdown option records a wrong example and saves the replacement as `typedAnswer` or `replacementAnswer`. Records include question wording, suggested answer, answer key when available, original score, field type, and action. Ignoring or dismissing is not counted.
3. **Adapt retrieval first.** Implemented: only feedback for a strongly similar question of the same field type is used. A saved answer that has more positive than negative feedback can win when its existing score is within 0.08 of the top match. An answer with more negative than positive feedback is excluded for that similar question. Dropdown adaptation still matches against the options the page actually offers. Candidate wording scores and threshold settings are preserved. Typed replacement answers are recorded for review but are not suggested as new answers yet.
4. **Calibrate responsively.** Implemented: each strongly similar feedback record of the same field type adjusts a separate personalized confidence score. A Beta(2, 2) prior makes early changes small; the adjustment is capped at 0.10 in either direction. The extension compares this personalized score with the user's existing medium and high thresholds, so confidence can rise or fall across bands. The original lexical score remains available separately.
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
2. **Done:** Define what feedback means: accepting the suggested value is positive, changing it is negative, and dismissal or silence is unknown.
3. **Done:** Add an opt-in setting, local collection, export, and delete controls. Collection does not change matching.
4. **Done:** Add a local retrieval preference for accepted examples and down-rank explicitly rejected question-answer pairs.
5. **Done:** Add responsive confidence calibration. With the Beta(2, 2) prior, one useful response raises the personalized score by 0.02 and one wrong response lowers it by 0.02. Repeated same-direction feedback moves it further, up to 0.10. If a score is close to a band boundary, one response can move it to the next band; this does not rewrite the original lexical score or threshold settings.
6. **Next:** Compare results with the baseline, then review the feature and privacy controls before enabling any adaptation by default (a separate product decision).

Each implementation step should be small enough to review and commit independently. We will explain the idea before changing code and show what the feedback does with concrete examples.
