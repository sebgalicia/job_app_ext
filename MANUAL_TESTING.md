# Manual Firefox test checklist

Use Firefox 140 or newer and a private test answers file. Avoid putting real personal information in fixture tests. Build and load the extension using the [README development setup](README.md#development-setup).

The fixtures in `fixtures/` can be served from localhost and enabled with the popup's **Enable on this page** action. Also try an actual supported job board if you have a test application available. A fixture is useful for repeatable checks, but does not prove compatibility with every site's production form.

## Focus and text fields

- [ ] No preview appears before a field is focused.
- [ ] Focusing an empty matching text field shows a preview; only the focused field has a preview at a time.
- [ ] Pressing Tab accepts a normal-confidence preview.
- [ ] Typing dismisses the preview and keeps the text you typed.
- [ ] Pressing Esc dismisses the preview, and a following Tab leaves the field blank.
- [ ] A medium-confidence preview is highlighted and is not accepted by Tab; Enter accepts it.
- [ ] A field that already contains text is never previewed or overwritten.

## Choices and sensitive answers

- [ ] A blank or placeholder native select can show a suggested option.
- [ ] A select with an already chosen real option is never previewed or changed.
- [ ] Radio and checkbox groups show a clear suggestion without selecting it immediately.
- [ ] Tab accepts a normal choice preview; Enter accepts a highlighted or sensitive preview; Tab does not accept a highlighted preview.
- [ ] Yes/no questions with reversed wording (for example, "Do you not require sponsorship?") map to the right meaning, or produce no preview if ambiguous.
- [ ] A generalized free-text answer only maps to an offered choice when the question match passes the stricter gate described in the README.

## Placeholders, context, and page scope

- [ ] `{company}` and `{role}` use detected or popup-edited values.
- [ ] A missing company or role is clearly marked and prevents accepting the preview until supplied.
- [ ] The toolbar popup can enable and disable previews for a site.
- [ ] On an unsupported site, previews begin only after granting access from **Enable on this page**.
- [ ] The Greenhouse iframe fixture detects and previews fields inside the embedded form.
- [ ] Disabling a site removes any active preview and stops further previews.

## Settings and local data

- [ ] A valid answers JSON file imports and exports; an invalid one is rejected with useful errors.
- [ ] Matching thresholds persist after closing and reopening Settings, and Medium remains below High.
- [ ] The Local AI matching control is disabled and does not affect matching.
- [ ] The job tracker stays off unless opted into; saving with it enabled records the current application locally.
- [ ] No answer or page data is transmitted; the extension works without a remote matching service.
