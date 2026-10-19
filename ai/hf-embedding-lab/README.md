# Hugging Face embedding experiment

## Goal

Compare a local Hugging Face question-embedding model with the extension's existing rules-based matcher. The model only ranks saved question/answer pairs; it does not generate answers or fill a form on its own.

## Candidate model

- Model: [`onnx-community/all-MiniLM-L6-v2-ONNX`](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX)
- Task: English sentence embeddings / similarity
- Runtime candidate: `@huggingface/transformers` with ONNX Runtime
- Initial quantization: Q4F16, whose ONNX weight data is listed at about 30 MB on the model repository
- License shown on the model page: Apache-2.0

This is a candidate for an experiment, not a decision to bundle it into the extension. The actual download and extension package also include tokenizer files, runtime code, and WebAssembly support. We will measure the complete size rather than treating the weight file as the final size.

## Locality and privacy

Transformers.js can download model weights from Hugging Face and cache them in the browser. The experiment must download only public model files; question text and user answers are passed to local inference and never to a hosted inference API. After the first download, test that embeddings can be computed offline. If the extension integration needs remote weights, explain that download clearly and offer a way to disable/remove the model. The final extension should prefer packaged or locally cached model files.

Do not use personal profile files in early experiments. Start with `examples/questions.csv` and fake answers. Keep any local Hugging Face cache, feedback export, and comparison output out of Git.

## Experiment sequence

1. Finish and review the rules-baseline versus feedback-adapted comparison.
2. Create a standalone local Node.js experiment using Transformers.js; do not change production extension matching yet.
3. Download the selected Q4F16 model from the HF Hub once and cache it locally.
4. Embed the example question wordings and compare each new question vector with saved question vectors using cosine similarity.
5. Keep option validation and confidence/abstention gates outside the model. A dropdown result must still correspond to a page option, and the model cannot create an answer.
6. Compare model rankings with baseline rankings using the same labeled rows. Measure accuracy, wrong suggestions, abstentions, cold startup, warm latency, memory, and total download size.
7. Only if it improves results, prototype browser-extension inference behind a setting. Keep the rules-based matcher as fallback and preserve the user's control over enabling the model.

## What you will learn

- Tokenization splits each question into model-readable pieces.
- The transformer encoder uses self-attention to represent the question's context.
- Pooling turns token representations into one sentence vector.
- Cosine similarity compares two vectors to rank related questions.
- Retrieval chooses a saved answer by its linked question; generation is not part of this experiment.
- A labeled comparison shows whether embeddings actually improve this application task.

## Current state

Plan and candidate selected. The model runtime and weights have not been installed or added to the extension. The baseline/adaptation comparison command is:

```sh
npm run compare:feedback -- --answers answers.private.json --input my-labeled-questions.csv --feedback job-autofill-feedback.json --out feedback-comparison.csv --work-history work-history.private.json
```

The feedback export and private answers file are local inputs. `my-labeled-questions.csv` needs `question` and `expected_key` columns; keys such as `answers[3]` and `profile.degree` must match the exact answers file passed to the command. Add `options` for dropdown rows. `--work-history` is optional. The command writes a CSV comparison to the requested local output path and does not send any input to a server. The existing `examples/questions.csv` uses labels from an older sample answers ordering, so check its keys before reusing it with a different answers file.
