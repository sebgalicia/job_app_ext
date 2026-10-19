# AI learning lab

This folder is the home for the project's AI architecture notes and small learning experiments. It is separate from the extension's production code.

## Current status

The extension currently uses a rules-based matcher. The first feedback-collection slice is implemented: when enabled, explicit suggestion acceptance and “Wrong” reports are stored locally for review. This collection does not yet adapt rankings or confidence, and it does not train or change neural-network weights.

This first version does not use a Hugging Face model and does not need a Python virtual environment, model download, or additional runtime dependency. It uses the existing TypeScript code and local browser storage. We can later compare it with a small Hugging Face model as a separate experiment if evaluation shows a model would help.

## How we will learn AI architecture

We will learn the architecture one small idea at a time, using this extension as the example:

1. **A matching pipeline:** follow a form question from the page, through question detection and scoring, to a preview and the user's decision.
2. **Feedback and labels:** distinguish an accepted answer, an explicitly rejected answer, a user correction, and an unanswered suggestion. Only the first three provide evidence; silence is unknown.
3. **Ranking and calibration:** learn how a similarity score differs from a probability, how positive/negative examples affect ranking, and how to keep confidence cautious when examples are scarce.
4. **Evaluation:** compare the original matcher with the adapted matcher on labeled questions, measuring both accuracy and how often it chooses to answer.
5. **Transformer architecture:** in a separate, optional study exercise, explore tokenization, embeddings, encoder layers, self-attention, and vector similarity. We can compare an embedding-based retriever with the current matcher without making it a production dependency.
6. **Retrieval and RAG:** understand indexing, retrieval, reranking, and generation. The extension's first feedback feature is retrieval/adaptation only; it will not generate answers with an LLM.
7. **Fine-tuning:** later, learn how positive and negative question pairs can train an embedding model offline, and compare that model against the simpler local adaptation approach.

Each lesson will use plain-language explanations, a small diagram or concrete example, and a focused code or data exercise. We will work in reviewable steps so you can inspect, understand, and commit each change. I will explain new terms and the reason for each design choice as we go.

## Folder map

- [`feedback-learning/README.md`](feedback-learning/README.md) describes the proposed local feedback loop, safeguards, and implementation steps.
- `src/feedback.ts` stores opt-in feedback records locally; Settings lets you enable collection, export the records, or delete them.
- Future throwaway experiments can go in a clearly named subfolder here. They should stay separate from production code until they have been measured and reviewed.

## Privacy rule

Application questions and answers are personal. Any future feedback feature must be opt-in, remain on the device, provide a way to review and delete learned examples, and make no network requests with application content.
