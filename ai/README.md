# AI learning lab

This folder holds isolated experiments for learning how question matching can improve. Experimental models stay separate from the Firefox extension until they are measured and reviewed.

## Current system

The extension's baseline is a local TypeScript question matcher. When the user enables **Learning feedback**, keeping or changing a suggestion adds an opt-in local example. Similar feedback can affect retrieval and a personalized confidence score. It does not train neural-network weights, generate answers, or send application content to a service.

## Hugging Face model experiment: setup added

The isolated lab fine-tunes [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on labeled job-application question pairs and answer-to-option compatibility pairs. It compares the base and fine-tuned model on held-out question phrasings and page-option cases, including abstention examples, and saves model weights and metrics locally. Type-aware date component and numeric range checks are evaluated separately from embedding similarity. The lab instructions are in [`hf-embedding-lab/README.md`](hf-embedding-lab/README.md).

This is an experiment, not extension integration. The user installs training dependencies into an ignored Python virtual environment; first run downloads public model files. Fine-tuning runs on-device and does not upload questions. Fine-tuning itself does not shrink model files; ONNX export/quantization and browser integration are later steps, contingent on measured benefit.

Do not add the model to the extension until it improves held-out question retrieval and safe answer-option selection over the current system, and preserves confidence gates, blank-answer abstention, date/value type checks, privacy, offline operation, Firefox compatibility, and an acceptable package/runtime footprint.

## How you will learn the AI architecture

We will follow one question through each layer and keep every stage inspectable:

1. **Question detection:** how page labels and controls become a question string.
2. **Token matching:** normalization, overlap, character trigrams, and the current lexical score.
3. **Feedback learning:** positive and negative examples, local retrieval preferences, and confidence calibration.
4. **Evaluation:** compare correct suggestions, incorrect suggestions, and abstentions against fixed labels.
5. **Embeddings:** tokenize a question, run transformer encoder layers, and turn its output into a vector.
6. **Vector retrieval:** compare question vectors using cosine similarity, then retrieve an existing saved answer.
7. **RAG and fine-tuning:** learn how retrieval differs from generation, then fine-tune the local encoder on reviewed question pairs in the HF lab.
8. **Model evaluation and export:** inspect held-out mistakes, then explore ONNX export and quantization only if the fine-tuned model improves matching.

Each step will use plain-language examples, a small diagram or code exercise, and a reviewable commit.

## Folder map

- [`feedback-learning/README.md`](feedback-learning/README.md): local feedback rules, privacy controls, and evaluation steps.
- [`hf-embedding-lab/README.md`](hf-embedding-lab/README.md): selected HF model, local experiment setup, measurements, and learning exercises.
- `src/feedback.ts`: local feedback collection, retrieval preferences, and confidence adjustment.
- `scripts/compare-feedback.ts`: compare baseline and feedback-adapted matching with labeled questions and a local feedback export.

## Privacy rule

Application questions, answers, and feedback remain on the device. No experiment may send them to a model host, analytics service, or server. Keep real profile and feedback files out of Git.
