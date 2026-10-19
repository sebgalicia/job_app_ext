# AI learning lab

This folder holds isolated experiments for learning how question matching can improve. Experimental models stay separate from the Firefox extension until they are measured and reviewed.

## Current system

The extension's baseline is a local TypeScript question matcher. When the user enables **Learning feedback**, keeping or changing a suggestion adds an opt-in local example. Similar feedback can affect retrieval and a personalized confidence score. It does not train neural-network weights, generate answers, or send application content to a service.

## Hugging Face model: yes, planned

The first HF experiment will use a small **sentence-embedding transformer** through Hugging Face Transformers.js and ONNX Runtime. The candidate is [`onnx-community/all-MiniLM-L6-v2-ONNX`](https://huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX), an English sentence-similarity model with a Q4F16 ONNX file listed at about 30 MB. Transformers.js supports feature extraction and quantized model loading in-browser. The model turns a question into a vector; the extension can compare that vector with saved question vectors and retrieve the saved answer. It will not write or invent an application answer.

The first experiment will run locally and compare the existing matcher with the embedding model on the same labeled questions. It will measure correct matches, wrong matches, abstentions, download size, startup time, and warm inference time. If it helps, we can add it as a user-controlled option while keeping the rules-based matcher as fallback.

The model weights may be downloaded from Hugging Face once and cached locally; inference should run on the device. The question text must never be sent to Hugging Face or an inference API. Before adding it to the extension, the experiment will check Firefox extension worker behavior, WebAssembly requirements, caching, memory use, and the final packaged size. A browser-extension integration needs extra care because the official Transformers.js browser-extension tutorial is still marked as forthcoming.

### Why not install the model directly in the extension now?

We should first complete the baseline-versus-feedback comparison and build a small isolated model experiment. That gives us a real accuracy and size comparison before adding a runtime dependency or making every extension user download model files. The model experiment uses public, synthetic questions first; a user's real feedback stays local.

## How you will learn the AI architecture

We will follow one question through each layer and keep every stage inspectable:

1. **Question detection:** how page labels and controls become a question string.
2. **Token matching:** normalization, overlap, character trigrams, and the current lexical score.
3. **Feedback learning:** positive and negative examples, local retrieval preferences, and confidence calibration.
4. **Evaluation:** compare correct suggestions, incorrect suggestions, and abstentions against fixed labels.
5. **Embeddings:** tokenize a question, run transformer encoder layers, and turn its output into a vector.
6. **Vector retrieval:** compare question vectors using cosine similarity, then retrieve an existing saved answer.
7. **RAG and fine-tuning:** learn how retrieval differs from generation, and later test offline training with reviewed question pairs if useful.

Each step will use plain-language examples, a small diagram or code exercise, and a reviewable commit.

## Folder map

- [`feedback-learning/README.md`](feedback-learning/README.md): local feedback rules, privacy controls, and evaluation steps.
- [`hf-embedding-lab/README.md`](hf-embedding-lab/README.md): selected HF model, local experiment setup, measurements, and learning exercises.
- `src/feedback.ts`: local feedback collection, retrieval preferences, and confidence adjustment.
- `scripts/compare-feedback.ts`: compare baseline and feedback-adapted matching with labeled questions and a local feedback export.

## Privacy rule

Application questions, answers, and feedback remain on the device. No experiment may send them to a model host, analytics service, or server. Keep real profile and feedback files out of Git.
