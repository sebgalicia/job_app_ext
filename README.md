# Job Autofill

A lightweight Firefox and Zen extension for previewing answers from a private, user supplied file while filling job applications. The planned MVP works locally in the browser and does not send answers anywhere.

## Current status

The extension can import and export an answers JSON file from its settings page, detect focused fields on supported job boards, and preview matching text and native choice answers. The toolbar popup shows an editable company and role, a site on/off switch, and the number of matched fields in the current tab. On other sites, use **Enable on this page** in the popup to grant temporary access for that tab.

## Development setup

Install dependencies and build the extension (the build also compiles the JSON Schema into standalone validation code):

```sh
npm install
npm run build
```

The generated extension is in `dist/`. To load it in Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `dist/manifest.json`. The `web-ext run` workflow will be documented when the development scripts are ready.

## Answers file

`template.json` is a starter file. Make a private copy and edit its `profile`, `facts`, and `answers` sections. `answers.schema.json` provides editor hints and validation for that format. Open the extension settings page to import the file; invalid files show errors and are not saved. Use **Export saved answers** to download the current local copy.

## Privacy

The intended design keeps answer data in local browser storage and makes no network requests. The current scaffold has no answer storage or transmission code. See [PRIVACY.md](PRIVACY.md).

## Publishing

The planned release process is to first publish an unlisted build on addons.mozilla.org for review, then publish a listed release. Packaging and signing instructions will be added before release.
