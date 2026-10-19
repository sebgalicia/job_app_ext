# Hugging Face job-question model lab

This is an isolated, local fine-tuning experiment. It teaches a small sentence encoder to place differently worded questions with the same labeled intent closer together. It does **not** generate answers, decide whether an application answer is true, or fill forms.

## Model choice

- Training base: [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- Training library: Sentence Transformers, which downloads the base model from Hugging Face on its first run.
- Training target: cosine similarity between question pairs with matching or different intent labels.
- Runtime: CPU by default; no GPU is required.
- Export candidate later: ONNX, then browser inference with Transformers.js if evaluation justifies it.

Fine-tuning adapts the model to this task; it does not make the model smaller. Model size reduction would be a separate quantization/export step, and the final downloaded package would also include tokenizer and runtime files. The extension will not download or run this model as part of this experiment.

## Try the experiment on Windows PowerShell

From the repository root:

```powershell
cd ai/hf-embedding-lab
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python train.py
```

If PowerShell blocks venv activation, run the environment's Python directly instead:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe train.py
```

On the first run, Hugging Face downloads the public base model into its normal local cache. Training and evaluation run locally. No question text or answers are uploaded. The experiment writes the fine-tuned model to `output/job-question-minilm/` and its base-versus-fine-tuned comparison to `runs/latest-report.json`.

Both output folders, the virtual environment, and model caches are ignored by Git. Do not put personal answer/profile data into this experiment or push generated model files to GitHub.

## Training data format

Edit `data/job-question-examples.csv`:

```csv
question,intent,split
Are you authorized to work here?,work_authorization,train
Can you legally work in this country?,work_authorization,validation
```

- `intent` is a label for the kind of saved answer the question maps to, not the answer itself.
- `split` is `train` or `validation`. Validation wordings must be held out from training so we can check generalization.
- Each training intent needs at least two different phrasings; include several intents so the model has meaningful alternatives.
- Use synthetic or reviewed question wordings only. Never use a user's private answers as training labels without their deliberate choice.

The script creates balanced positive and negative sentence pairs from the `intent` labels and uses Sentence Transformers' `CoSENTLoss`. It compares nearest-question intent accuracy before and after fine-tuning on held-out wording. Review per-intent results and individual mistakes, not just the overall percentage. Keep labels precise: if two questions need different saved values, they should usually have different intents even if their wording is similar.

The question data has 13 intents, with six or seven training and three held-out validation phrasings per intent. `data/option-fit-examples.csv` is a second task: it gives a form question, a saved answer, the page's available options, and the option that should be selected. A blank `expected_option` means **none of the choices fit**, so the correct action is to abstain. It includes Georgia Tech versus “Other college” as one hard-negative example among school, degree, work-mode, and authorization choices. The examples are still synthetic and limited; they help practice and expose obvious confusion but are **not** a reliable quality benchmark.

The report gives overall and per-intent question accuracy, a confusion matrix, and each incorrect match. It separately reports option-case accuracy, coverage (how often it filled), wrong fills, correct abstentions, and mistakes. For semantic choices, the experiment compares the question and saved answer with the available options, ignores generic fallbacks such as “Other” unless that is literally the saved answer, and only selects a choice when its similarity and lead over the next choice clear provisional thresholds. Those thresholds are experimental, not production-safe; they need calibration on a larger reviewed validation set.

Month/year-only controls use a different general method: infer the requested component from the label, extract only that part from a recognized saved date, normalize it (for example, `May` and `05`), and require an exact option match. If the date is incomplete or ambiguous (for example `03/04/2027` without a known date order), abstain. This prevents a full date from being put into a month or year field. The evaluator also checks start versus end years in a date range. Numeric range controls use unit-aware interval membership (for example, `7 years` maps to `6–10 years`); overlapping ranges, mismatched units, and values outside every range abstain. Empty saved answers always abstain. These are general answer-to-option compatibility rules; Georgia Tech versus “Other college” is one hard-negative example, not a code path for that school.

The fixtures include a small negated yes/no example, but this is a particularly risky case: an embedding model can confuse related wording without understanding whether the saved fact logically supports “Yes” or “No.” A real evaluation set needs many polarity reversals and contradiction examples. Other edge cases include currency conversions and pay periods, duplicate or near-tied options, multi-select controls, inaccessible/disabled option lists, and fields that combine more than one answer. Numeric/date values should use type-aware parsing and exact option membership rather than trusting text similarity. The current lab is still a prototype and does not solve all these cases.

## How this fits the extension

The model can eventually help with both question ranking and answer-to-option compatibility. The extension must still:

1. retrieve an answer the user already saved rather than invent an answer;
2. only select a page option when it is compatible with the saved answer, and abstain when no option fits or the best choices are too close;
3. leave the current rules matcher available as fallback;
4. run locally with a user-controlled setting and no hosted inference API;
5. beat the current matcher on held-out application questions without too many risky false matches.

Only after those checks should we export ONNX and measure browser startup, warm latency, memory, download size, Firefox compatibility, and offline behavior. Hugging Face's [Optimum ONNX export guide](https://huggingface.co/docs/optimum-onnx/onnx/usage_guides/export_a_model) documents exporting feature-extraction models; browser integration is a separate engineering step.

## Learning path

1. **Labels:** the `intent` column tells training which questions point to the same answer.
2. **Pairs:** matching-intent questions become positive pairs; different-intent questions become negative pairs.
3. **Fine-tuning:** CoSENT loss adjusts the encoder so positive pairs score more alike than negative pairs.
4. **Retrieval:** for a new question, compare its vector against saved example-question vectors and pick the closest label.
5. **Evaluation:** compare the unchanged base model with the fine-tuned model on unseen wording and inspect mistakes.
6. **Export:** later turn the trained encoder into a compact local browser model and measure the real extension cost.

See [`../README.md`](../README.md) for the broader AI learning plan and privacy rule.
