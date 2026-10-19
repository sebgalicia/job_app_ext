"""Fine-tune a small sentence encoder on labeled job-application questions."""

from __future__ import annotations

import argparse
import calendar
import csv
import json
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from datasets import Dataset
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer
from sentence_transformers.sentence_transformer.losses import CoSENTLoss
from sentence_transformers.sentence_transformer.training_args import SentenceTransformerTrainingArguments


ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = ROOT / "data" / "job-question-examples.csv"
DEFAULT_OPTION_DATA = ROOT / "data" / "option-fit-examples.csv"
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
        {"sentence1": f"Application question: {left}", "sentence2": f"Application question: {right}", "score": 1.0}
        for left, right in positives
    ] + [
        {"sentence1": f"Application question: {left}", "sentence2": f"Application question: {right}", "score": 0.0}
        for left, right in negatives
    ]
    rng.shuffle(pairs)
    return pairs


def load_option_cases(path: Path, split: str) -> list[dict[str, object]]:
    """Group page options into cases whose expected_option may be blank (abstain)."""
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    required = {"case_id", "question", "saved_answer", "option", "expected_option", "split"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"Option CSV must have these columns: {', '.join(sorted(required))}")

    grouped: dict[str, dict[str, object]] = {}
    for row in rows:
        if row["split"].strip().lower() != split:
            continue
        case_id = row["case_id"].strip()
        current = grouped.setdefault(
            case_id,
            {
                "case_id": case_id,
                "question": row["question"].strip(),
                "saved_answer": row["saved_answer"].strip(),
                "expected_option": row["expected_option"].strip(),
                "options": [],
            },
        )
        if current["question"] != row["question"].strip() or current["saved_answer"] != row["saved_answer"].strip():
            raise ValueError(f"Case {case_id!r} has inconsistent question or saved_answer values.")
        if current["expected_option"] != row["expected_option"].strip():
            raise ValueError(f"Case {case_id!r} has inconsistent expected_option values.")
        option = row["option"].strip()
        if option:
            current["options"].append(option)
    cases = list(grouped.values())
    if not cases:
        raise ValueError(f"Option CSV has no rows marked {split!r}.")
    return cases


def make_option_pairs(cases: list[dict[str, object]]) -> list[dict[str, object]]:
    """Teach compatibility of a saved value with page options, including no-match cases."""
    pairs = []
    for case in cases:
        component = requested_date_component(str(case["question"]))
        if component:
            # Date parts are parsed and checked against exact options by the
            # type-aware matcher; semantic embeddings should not guess numbers.
            continue
        saved_value = str(case["saved_answer"])
        context = (
            f"Application question: {case['question']} "
            f"User's saved answer: {saved_value}"
        )
        expected_option = str(case["expected_option"]).strip().casefold()
        for option in case["options"]:
            pairs.append(
                {
                    "sentence1": context,
                    "sentence2": f"Page answer option: {option}",
                    "score": 1.0 if str(option).strip().casefold() == expected_option and expected_option else 0.0,
                }
            )
    return pairs


MONTH_LOOKUP = {
    name.casefold(): f"{number:02d}"
    for number in range(1, 13)
    for name in (calendar.month_name[number], calendar.month_abbr[number])
}


def requested_date_component(question: str) -> str | None:
    """Infer a month/year-only control from its visible label for this experiment."""
    normalized = question.casefold()
    has_end = bool(re.search(r"\b(end|ending|finish|finished|complete|completed|graduat(?:e|ed|ion))\b", normalized))
    has_start = bool(re.search(r"\b(start|starting|begin|beginning|began|commence|commencement)\b", normalized))
    position = "ambiguous" if has_start and has_end else "end" if has_end else "start" if has_start else ""
    if re.search(r"\bmonth\b", normalized):
        return f"{position}_month" if position else "month"
    if re.search(r"\byear\b", normalized):
        return f"{position}_year" if position else "year"
    return None


def extract_date_component(value: str, component: str | None) -> str | None:
    """Extract only an unambiguous month or year; unknown formats must abstain."""
    if component and component.startswith("ambiguous"):
        return None
    if component and component.endswith("year"):
        matches = re.findall(r"\b(?:19|20)\d{2}\b", value)
        if not matches:
            return None
        if component.startswith("start"):
            return matches[0]
        if component.startswith("end"):
            return matches[-1]
        return matches[0] if len(set(matches)) == 1 else None
    if not component or not component.endswith("month"):
        return None

    normalized = value.casefold()
    for month, number in MONTH_LOOKUP.items():
        if re.search(rf"\b{re.escape(month)}\b", normalized):
            return number
    # ISO year-month or full ISO date.
    match = re.search(r"\b(?:19|20)\d{2}[-/](0?[1-9]|1[0-2])(?:[-/]\d{1,2})?\b", normalized)
    if match:
        return f"{int(match.group(1)):02d}"
    # Numeric month/year is unambiguous. Full slash dates are only accepted
    # when one ordering is impossible (e.g. 13/04/2027 means day/month/year).
    match = re.search(r"(?<![\d/])\b(0?[1-9]|1[0-2])/(?:19|20)\d{2}\b", normalized)
    if match:
        return f"{int(match.group(1)):02d}"
    match = re.search(r"\b(0?[1-9]|1[0-2])/(1[3-9]|2\d|3[01])/(?:19|20)\d{2}\b", normalized)
    if match:
        return f"{int(match.group(1)):02d}"
    match = re.search(r"\b(1[3-9]|2\d|3[01])/(0?[1-9]|1[0-2])/(?:19|20)\d{2}\b", normalized)
    if match:
        return f"{int(match.group(2)):02d}"
    return None


def normalized_option(option: str, component: str | None) -> str:
    """Normalize typed values so a month/year matches the equivalent option."""
    value = option.strip().casefold()
    if component and component.endswith("month"):
        if value in MONTH_LOOKUP:
            return MONTH_LOOKUP[value]
        if re.fullmatch(r"0?[1-9]|1[0-2]", value):
            return f"{int(value):02d}"
        named_month = next((number for name, number in MONTH_LOOKUP.items() if re.search(rf"\b{re.escape(name)}\b", value)), None)
        if named_month:
            return named_month
    if component and component.endswith("year"):
        match = re.fullmatch(r"(?:19|20)\d{2}", value)
        if match:
            return match.group(0)
        years = re.findall(r"\b(?:19|20)\d{2}\b", value)
        if len(set(years)) == 1:
            return years[0]
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def is_generic_fallback_option(option: str) -> bool:
    """Do not autofill generic fallbacks such as Other or None of the above."""
    normalized = re.sub(r"[^a-z0-9]+", " ", option.casefold()).strip()
    return (
        normalized == "other"
        or normalized.startswith("other ")
        or normalized in {"none of the above", "none listed", "not listed", "not applicable"}
        or normalized.startswith("prefer not to ")
        or normalized.startswith("something else")
        or normalized.startswith("not in list")
    )


def compact_text(value: str) -> str:
    """Normalize case, spaces, and punctuation for conservative exact matching."""
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def numeric_unit(value: str) -> str:
    words = re.sub(r"\d[\d,]*(?:\.\d+)?", " ", value.casefold())
    words = re.sub(r"[$€£]", " usd ", words)
    words = re.sub(r"\b(annual|annually|per annum)\b", "year", words)
    words = re.sub(r"\b(of|professional|total|relevant|experience|per)\b", " ", words)
    normalized = re.sub(r"[^a-z]+", " ", words).strip()
    normalized = re.sub(r"\b(?:yrs?|years)\b", "year", normalized)
    return re.sub(r"\b(?:mos?|months)\b", "month", normalized)


def parse_numeric_answer(value: str) -> tuple[float, str] | None:
    matches = re.findall(r"\d[\d,]*(?:\.\d+)?", value)
    if len(matches) != 1:
        return None
    try:
        return float(matches[0].replace(",", "")), numeric_unit(value)
    except ValueError:
        return None


def parse_numeric_interval(option: str) -> tuple[float, float, str] | None:
    number = r"(\d[\d,]*(?:\.\d+)?)"
    interval = re.fullmatch(rf"\s*{number}\s*(?:-|–|—|to)\s*{number}\s*(.*?)\s*", option, re.IGNORECASE)
    if interval:
        return float(interval.group(1).replace(",", "")), float(interval.group(2).replace(",", "")), numeric_unit(interval.group(3))
    open_ended = re.fullmatch(rf"\s*{number}\s*\+\s*(.*?)\s*", option)
    if open_ended:
        return float(open_ended.group(1).replace(",", "")), float("inf"), numeric_unit(open_ended.group(2))
    return None


def numeric_range_choice(saved_answer: str, options: list[str]) -> tuple[bool, str]:
    """Resolve numeric range choices exactly when every option can be interpreted safely."""
    candidates = [option for option in options if not is_generic_fallback_option(option)]
    parsed_options = [parse_numeric_interval(option) for option in candidates]
    if not parsed_options or not any(parsed_options):
        return False, ""
    exact_matches = [option for option in options if compact_text(option) == compact_text(saved_answer)]
    if len(exact_matches) == 1:
        return True, exact_matches[0]
    if len(exact_matches) > 1:
        return True, ""
    if any(interval is None for interval in parsed_options):
        return True, ""
    answer = parse_numeric_answer(saved_answer)
    if answer is None:
        return True, ""
    value, answer_unit = answer
    intervals = [interval for interval in parsed_options if interval is not None]
    if any(unit != answer_unit for _, _, unit in intervals):
        return True, ""
    matches = [option for option, (lower, upper, _) in zip(candidates, intervals) if lower <= value <= upper]
    return True, matches[0] if len(matches) == 1 else ""


def option_fit_accuracy(
    model: SentenceTransformer,
    cases: list[dict[str, object]],
    threshold: float,
    min_margin: float,
) -> dict[str, object]:
    """Pick a compatible option only when its similarity and lead are sufficient."""
    contexts = [
        f"Application question: {case['question']} User's saved answer: {case['saved_answer']}"
        for case in cases
    ]
    option_texts = [option for case in cases for option in case["options"]]
    context_vectors = model.encode(contexts, normalize_embeddings=True, show_progress_bar=False)
    option_vectors = model.encode(option_texts, normalize_embeddings=True, show_progress_bar=False)

    correct = 0
    abstained = 0
    correct_abstentions = 0
    mistakes = []
    offset = 0
    for case_index, case in enumerate(cases):
        options = case["options"]
        vectors = option_vectors[offset : offset + len(options)]
        offset += len(options)
        component = requested_date_component(str(case["question"]))
        expected = str(case["expected_option"])
        saved_answer = str(case["saved_answer"]).strip()
        if not saved_answer:
            predicted = ""
            is_correct = not expected
            correct += is_correct
            abstained += 1
            correct_abstentions += is_correct
            if not is_correct:
                mistakes.append({
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "saved_answer": "",
                    "expected_option": expected or None,
                    "predicted_option": None,
                    "method": "blank_answer_abstention",
                })
            continue
        if component:
            component_value = extract_date_component(saved_answer, component)
            matches = [
                option for option in options
                if component_value and normalized_option(option, component) == component_value
            ]
            # Date component questions use type-aware extraction plus exact
            # normalized option membership, not fuzzy embedding similarity.
            predicted = matches[0] if len(matches) == 1 else ""
            is_correct = normalized_option(predicted, component) == normalized_option(expected, component) if predicted and expected else not predicted and not expected
            correct += is_correct
            abstained += not predicted
            correct_abstentions += is_correct and not predicted
            if not is_correct:
                mistakes.append({
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "saved_answer": case["saved_answer"],
                    "extracted_component": component_value,
                    "expected_option": expected or None,
                    "predicted_option": predicted or None,
                    "method": "typed_date_exact_match",
                    "available_options": options,
                })
            continue
        range_detected, range_choice = numeric_range_choice(saved_answer, [str(option) for option in options])
        if range_detected:
            predicted = range_choice
            is_correct = predicted.casefold() == expected.casefold()
            correct += is_correct
            abstained += not predicted
            correct_abstentions += is_correct and not predicted
            if not is_correct:
                mistakes.append({
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "saved_answer": saved_answer,
                    "expected_option": expected or None,
                    "predicted_option": predicted or None,
                    "method": "numeric_range_exact_membership",
                    "available_options": options,
                })
            continue
        exact_answer = compact_text(saved_answer)
        eligible_indices = [
            index for index, option in enumerate(options)
            if not is_generic_fallback_option(str(option))
            or compact_text(str(option)) == exact_answer
        ]
        exact_matches = [index for index in eligible_indices if compact_text(str(options[index])) == exact_answer]
        if len(exact_matches) == 1:
            predicted = str(options[exact_matches[0]])
            is_correct = predicted.casefold() == expected.casefold()
            correct += is_correct
            if not is_correct:
                mistakes.append({
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "saved_answer": saved_answer,
                    "expected_option": expected or None,
                    "predicted_option": predicted,
                    "method": "normalized_exact_match",
                })
            continue
        if len(exact_matches) > 1:
            is_correct = not expected
            correct += is_correct
            abstained += 1
            correct_abstentions += is_correct
            if not is_correct:
                mistakes.append({
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "saved_answer": saved_answer,
                    "expected_option": expected,
                    "predicted_option": None,
                    "method": "ambiguous_duplicate_exact_options",
                })
            continue
        scores = context_vectors[case_index] @ vectors.T
        if not eligible_indices:
            ranked_indices = []
        else:
            ranked_indices = sorted(eligible_indices, key=lambda index: float(scores[index]), reverse=True)
        if not ranked_indices:
            predicted = ""
            top_score = -1.0
            second_score = -1.0
            margin = 0.0
        else:
            top_index = int(ranked_indices[0])
            top_score = float(scores[top_index])
            second_score = float(scores[ranked_indices[1]]) if len(ranked_indices) > 1 else -1.0
            margin = top_score - second_score
            predicted = options[top_index] if top_score >= threshold and margin >= min_margin else ""
        is_correct = predicted.casefold() == expected.casefold()
        correct += is_correct
        abstained += not predicted
        correct_abstentions += is_correct and not predicted
        if not is_correct:
            mistakes.append(
                {
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "saved_answer": case["saved_answer"],
                    "expected_option": expected or None,
                    "predicted_option": predicted or None,
                    "top_score": top_score,
                    "margin": margin,
                    "method": "semantic_similarity_with_abstention",
                    "options": [
                        {"option": options[index], "score": float(scores[index])}
                        for index in ranked_indices
                    ],
                }
            )
    filled = len(cases) - abstained
    correct_fills = correct - correct_abstentions
    return {
        "correct": correct,
        "total": len(cases),
        "accuracy": correct / len(cases) if cases else 0.0,
        "abstained": abstained,
        "correct_abstentions": correct_abstentions,
        "coverage": filled / len(cases) if cases else 0.0,
        "accuracy_when_filled": correct_fills / filled if filled else 0.0,
        "false_fills": sum(bool(mistake.get("predicted_option")) for mistake in mistakes),
        "threshold": threshold,
        "minimum_margin": min_margin,
        "mistakes": mistakes,
    }


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
    totals_by_intent: Counter[str] = Counter()
    correct_by_intent: Counter[str] = Counter()
    confusion: dict[str, Counter[str]] = defaultdict(Counter)
    for question, expected_intent, vector in zip(queries, expected, query_vectors):
        scores = train_vectors @ vector
        predicted = train_intents[int(scores.argmax())]
        correct += predicted == expected_intent
        totals_by_intent[expected_intent] += 1
        correct_by_intent[expected_intent] += predicted == expected_intent
        confusion[expected_intent][predicted] += 1
        if predicted != expected_intent:
            mistakes.append({"question": question, "expected": expected_intent, "predicted": predicted})
    per_intent = {
        intent: {
            "correct": correct_by_intent[intent],
            "total": total,
            "accuracy": correct_by_intent[intent] / total,
        }
        for intent, total in sorted(totals_by_intent.items())
    }
    return {
        "correct": correct,
        "total": len(validation),
        "accuracy": correct / len(validation) if validation else 0.0,
        "per_intent": per_intent,
        "confusion_matrix": {intent: dict(sorted(counts.items())) for intent, counts in sorted(confusion.items())},
        "mistakes": mistakes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="CSV with question,intent,split columns")
    parser.add_argument("--option-data", type=Path, default=DEFAULT_OPTION_DATA, help="CSV with saved-answer and page-option cases")
    parser.add_argument("--base-model", default=BASE_MODEL, help="Sentence Transformers model ID or local model path")
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--option-threshold", type=float, default=0.70, help="Provisional minimum similarity for selecting an option")
    parser.add_argument("--option-margin", type=float, default=0.05, help="Provisional minimum lead over the next option")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "job-question-minilm")
    args = parser.parse_args()

    random.seed(args.seed)
    train_rows, validation_rows = load_examples(args.data)
    option_train_cases = load_option_cases(args.option_data, "train")
    option_validation_cases = load_option_cases(args.option_data, "validation")
    question_pairs = make_pairs(train_rows, args.seed)
    option_pairs = make_option_pairs(option_train_cases)
    # The question paraphrase dataset is larger; repeat the option-fit examples
    # so that this second task has meaningful weight during the same fine-tune.
    pairs = question_pairs + option_pairs * 8
    random.Random(args.seed).shuffle(pairs)
    dataset = Dataset.from_list(pairs)
    print(f"Training on {len(question_pairs)} question pairs and {len(option_pairs)} option pairs (option pairs repeated 8x).")
    print(f"Holding out {len(validation_rows)} questions across {len({row['intent'] for row in validation_rows})} intents.")
    print(f"Holding out {len(option_validation_cases)} complete answer-option cases, including cases where no option is valid.")
    print(f"Loading base model {args.base_model}; first run downloads public model files from Hugging Face.")

    base_model = SentenceTransformer(args.base_model, device="cpu")
    before = retrieval_accuracy(base_model, train_rows, validation_rows)
    option_before = option_fit_accuracy(base_model, option_validation_cases, args.option_threshold, args.option_margin)
    print(f"Base model held-out accuracy: {before['correct']}/{before['total']} ({before['accuracy']:.1%})")
    print(
        f"Base answer-option cases: {option_before['correct']}/{option_before['total']} correct "
        f"({option_before['accuracy']:.1%}); filled {option_before['coverage']:.1%}; "
        f"wrong fills {option_before['false_fills']}; abstained {option_before['abstained']}"
    )

    model = SentenceTransformer(args.base_model, device="cpu")
    training_args = SentenceTransformerTrainingArguments(
        output_dir=str(ROOT / "runs" / "trainer-output"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=2e-5,
        warmup_steps=0.1,
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
        loss=CoSENTLoss(model),
    )
    trainer.train()

    args.output.mkdir(parents=True, exist_ok=True)
    model.save(str(args.output))
    after = retrieval_accuracy(model, train_rows, validation_rows)
    option_after = option_fit_accuracy(model, option_validation_cases, args.option_threshold, args.option_margin)
    validation_delta = after["correct"] - before["correct"]
    if validation_delta > 0:
        comparison = "Fine-tuned model matched more held-out questions than the base model. Review mistakes and use a larger test set before relying on this result."
    elif validation_delta < 0:
        comparison = "Fine-tuned model matched fewer held-out questions than the base model; this training run did not help on this validation set."
    else:
        comparison = "Both models matched the same number of held-out questions; this run shows no overall accuracy change. Compare per-intent scores and mistakes."
    option_delta = option_after["correct"] - option_before["correct"]
    if option_delta > 0:
        option_comparison = "Fine-tuning improved answer-option case accuracy on this small held-out set; inspect wrong selections and abstentions before relying on it."
    elif option_delta < 0:
        option_comparison = "Fine-tuning reduced answer-option case accuracy on this held-out set; this run did not help with option matching."
    else:
        option_comparison = "Fine-tuning did not change answer-option case accuracy on this held-out set; inspect the score details and abstentions."
    report = {
        "base_model": args.base_model,
        "trained_at_utc": datetime.now(timezone.utc).isoformat(),
        "training_examples": len(train_rows),
        "question_training_pairs": len(question_pairs),
        "option_training_pairs_before_repeats": len(option_pairs),
        "combined_training_pairs": len(pairs),
        "validation_examples": len(validation_rows),
        "option_validation_cases": len(option_validation_cases),
        "validation_examples_by_intent": dict(sorted(Counter(row["intent"].strip() for row in validation_rows).items())),
        "base_model_retrieval": before,
        "fine_tuned_retrieval": after,
        "base_model_option_fit": option_before,
        "fine_tuned_option_fit": option_after,
        "comparison_interpretation": comparison,
        "option_fit_interpretation": option_comparison,
        "warning": "Synthetic fixtures measure wiring and known edge cases only; replace them with reviewed, diverse, privacy-safe labeled data before drawing quality conclusions.",
    }
    report_path = ROOT / "runs" / "latest-report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Fine-tuned held-out accuracy: {after['correct']}/{after['total']} ({after['accuracy']:.1%})")
    print(
        f"Fine-tuned answer-option cases: {option_after['correct']}/{option_after['total']} correct "
        f"({option_after['accuracy']:.1%}); filled {option_after['coverage']:.1%}; "
        f"wrong fills {option_after['false_fills']}; abstained {option_after['abstained']}"
    )
    print(option_comparison)
    print("Per-intent held-out accuracy (base -> fine-tuned):")
    for intent in sorted(after["per_intent"]):
        base_score = before["per_intent"].get(intent, {"correct": 0, "total": 0, "accuracy": 0.0})
        tuned_score = after["per_intent"][intent]
        print(
            f"  {intent}: {base_score['correct']}/{base_score['total']} ({base_score['accuracy']:.0%})"
            f" -> {tuned_score['correct']}/{tuned_score['total']} ({tuned_score['accuracy']:.0%})"
        )
    print(comparison)
    print(f"Saved local model to: {args.output}")
    print(f"Saved local comparison report to: {report_path}")
    print("Review the held-out mistakes; this sample is too small to justify production integration.")


if __name__ == "__main__":
    main()
