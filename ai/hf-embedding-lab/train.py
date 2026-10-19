"""Fine-tune a small sentence encoder on labeled job-application questions."""

from __future__ import annotations

import argparse
import csv
import json
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from datasets import Dataset
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, losses
from sentence_transformers.training_args import SentenceTransformerTrainingArguments


ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = ROOT / "data" / "job-question-examples.csv"
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def load_examples(path: Path) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    required = {"question", "intent", "split"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"CSV must have these columns: {', '.join(sorted(required))}")

    train = [row for row in rows if row["split"].strip().lower() == "train"]
    validation = [row for row in rows if row["split"].strip().lower() == "validation"]
    if len({row["intent"] for row in train}) < 2:
        raise ValueError("Training data needs at least two different intents.")
    if not validation:
        raise ValueError("Add held-out rows marked 'validation' to the CSV.")
    known_intents = {row["intent"] for row in train}
    unknown = sorted({row["intent"] for row in validation} - known_intents)
    if unknown:
        raise ValueError(f"Validation intents need training examples too: {', '.join(unknown)}")
    return train, validation


def make_pairs(rows: list[dict[str, str]], seed: int) -> list[dict[str, object]]:
    """Create balanced positive and negative similarity pairs from intent labels."""
    by_intent: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        question = row["question"].strip()
        intent = row["intent"].strip()
        if question and intent:
            by_intent[intent].append(question)

    positives: list[tuple[str, str]] = []
    negatives: list[tuple[str, str]] = []
    intent_names = sorted(by_intent)
    for intent, questions in by_intent.items():
        for i, left in enumerate(questions):
            positives.extend((left, right) for right in questions[i + 1 :])
    for left_index, left_intent in enumerate(intent_names):
        for right_intent in intent_names[left_index + 1 :]:
            negatives.extend(
                (left, right)
                for left in by_intent[left_intent]
                for right in by_intent[right_intent]
            )

    if not positives:
        raise ValueError("Each training intent needs at least two paraphrases.")
    rng = random.Random(seed)
    rng.shuffle(negatives)
    negatives = negatives[: len(positives)]
    pairs = [
        {"sentence1": left, "sentence2": right, "score": 1.0}
        for left, right in positives
    ] + [
        {"sentence1": left, "sentence2": right, "score": 0.0}
        for left, right in negatives
    ]
    rng.shuffle(pairs)
    return pairs


def retrieval_accuracy(
    model: SentenceTransformer,
    train: list[dict[str, str]],
    validation: list[dict[str, str]],
) -> dict[str, object]:
    train_texts = [row["question"].strip() for row in train]
    train_intents = [row["intent"].strip() for row in train]
    queries = [row["question"].strip() for row in validation]
    expected = [row["intent"].strip() for row in validation]
    train_vectors = model.encode(train_texts, normalize_embeddings=True, show_progress_bar=False)
    query_vectors = model.encode(queries, normalize_embeddings=True, show_progress_bar=False)

    correct = 0
    mistakes = []
    for question, expected_intent, vector in zip(queries, expected, query_vectors):
        scores = train_vectors @ vector
        predicted = train_intents[int(scores.argmax())]
        correct += predicted == expected_intent
        if predicted != expected_intent:
            mistakes.append({"question": question, "expected": expected_intent, "predicted": predicted})
    return {
        "correct": correct,
        "total": len(validation),
        "accuracy": correct / len(validation) if validation else 0.0,
        "mistakes": mistakes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="CSV with question,intent,split columns")
    parser.add_argument("--base-model", default=BASE_MODEL, help="Sentence Transformers model ID or local model path")
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "job-question-minilm")
    args = parser.parse_args()

    random.seed(args.seed)
    train_rows, validation_rows = load_examples(args.data)
    pairs = make_pairs(train_rows, args.seed)
    dataset = Dataset.from_list(pairs)
    print(f"Training on {len(pairs)} question pairs from {len(train_rows)} examples.")
    print(f"Holding out {len(validation_rows)} questions across {len({row['intent'] for row in validation_rows})} intents.")
    print(f"Loading base model {args.base_model}; first run downloads public model files from Hugging Face.")

    base_model = SentenceTransformer(args.base_model, device="cpu")
    before = retrieval_accuracy(base_model, train_rows, validation_rows)
    print(f"Base model held-out accuracy: {before['correct']}/{before['total']} ({before['accuracy']:.1%})")

    model = SentenceTransformer(args.base_model, device="cpu")
    training_args = SentenceTransformerTrainingArguments(
        output_dir=str(ROOT / "runs" / "trainer-output"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=2e-5,
        warmup_ratio=0.1,
        weight_decay=0.01,
        fp16=False,
        bf16=False,
        eval_strategy="no",
        save_strategy="no",
        logging_strategy="epoch",
        report_to="none",
        seed=args.seed,
        data_seed=args.seed,
    )
    trainer = SentenceTransformerTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        loss=losses.CoSENTLoss(model),
    )
    trainer.train()

    args.output.mkdir(parents=True, exist_ok=True)
    model.save(str(args.output))
    after = retrieval_accuracy(model, train_rows, validation_rows)
    report = {
        "base_model": args.base_model,
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "training_examples": len(train_rows),
        "training_pairs": len(pairs),
        "validation_examples": len(validation_rows),
        "base_model_retrieval": before,
        "fine_tuned_retrieval": after,
        "warning": "This tiny synthetic fixture measures wiring only; replace it with reviewed, diverse, privacy-safe labels before drawing quality conclusions.",
    }
    report_path = ROOT / "runs" / "latest-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Fine-tuned held-out accuracy: {after['correct']}/{after['total']} ({after['accuracy']:.1%})")
    print(f"Saved local model to: {args.output}")
    print(f"Saved local comparison report to: {report_path}")
    print("Review the held-out mistakes; this sample is too small to justify production integration.")


if __name__ == "__main__":
    main()
