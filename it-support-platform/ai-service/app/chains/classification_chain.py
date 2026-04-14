"""
classification_chain.py
-----------------------
LangChain Classification Chain using DistilBERT.

Supports two modes:
  1. Fine-tuned model (preferred) — loads from models/ticket-classifier/
     Trained on your actual ticket data via train_classifier.py
  2. Zero-shot fallback — uses distilbert-base-uncased-mnli if no trained model found

Pipeline:
  1. User issue text comes in
  2. DistilBERT classifies into category
  3. Priority inferred from keywords
  4. Returns category + priority + confidence
"""

import os
import json
import torch
from langchain_core.runnables import RunnablePassthrough, RunnableLambda

# ── Paths ─────────────────────────────────────────────────────────────────────

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FINETUNED_MODEL_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models", "ticket-classifier"
)

# ── Priority keywords ────────────────────────────────────────────────────────

PRIORITY_KEYWORDS = {
    "Critical": [
        "down", "outage", "crash", "emergency", "production down",
        "data loss", "security breach", "ransomware", "critical",
        "server down", "complete failure", "cannot access anything",
    ],
    "High": [
        "urgent", "asap", "broken", "not working", "blocked",
        "cannot login", "failed", "error", "multiple users affected",
        "high priority", "degraded performance",
    ],
    "Medium": [
        "slow", "intermittent", "sometimes", "issue with",
        "need help", "problem", "trouble", "glitch",
    ],
    "Low": [
        "question", "how to", "request", "information",
        "nice to have", "cosmetic", "minor", "enhancement",
    ],
}


class ClassificationChain:
    """
    LangChain-based classification chain using DistilBERT.

    Auto-detects fine-tuned model at models/ticket-classifier/.
    Falls back to zero-shot if not found.

    Usage:
        chain = ClassificationChain()
        result = chain.classify("My VPN keeps disconnecting every 5 minutes")
        # result = {"category": "Network", "priority": "High", "confidence": 0.92}
    """

    def __init__(self):
        self._mode = None
        self._classifier = None
        self._model = None
        self._tokenizer = None
        self._labels = None
        self._id2label = None
        self._device = None

        # Try loading fine-tuned model first
        if self._load_finetuned():
            self._mode = "finetuned"
            print(f"[ClassificationChain] Loaded FINE-TUNED model from {FINETUNED_MODEL_DIR}")
            print(f"[ClassificationChain] Labels: {self._labels}")
        else:
            self._load_zeroshot()
            self._mode = "zeroshot"
            print("[ClassificationChain] No fine-tuned model found. Using ZERO-SHOT fallback.")
            print("[ClassificationChain] Run 'python train_classifier.py' to train a better model.")

        # Build the LangChain chain
        self.chain = (
            RunnablePassthrough()
            | RunnableLambda(self._run_classification)
        )

    def _load_finetuned(self) -> bool:
        """Try loading the fine-tuned DistilBertForSequenceClassification model."""
        label_map_path = os.path.join(FINETUNED_MODEL_DIR, "label_map.json")
        config_path = os.path.join(FINETUNED_MODEL_DIR, "config.json")

        if not os.path.exists(label_map_path) or not os.path.exists(config_path):
            return False

        try:
            from transformers import DistilBertTokenizer, DistilBertForSequenceClassification

            # Load label map
            with open(label_map_path, "r") as f:
                label_map = json.load(f)
            self._labels = label_map["labels"]
            self._id2label = {int(k): v for k, v in label_map["id2label"].items()}

            # Load model and tokenizer
            self._tokenizer = DistilBertTokenizer.from_pretrained(FINETUNED_MODEL_DIR)
            self._model = DistilBertForSequenceClassification.from_pretrained(FINETUNED_MODEL_DIR)
            self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self._model.to(self._device)
            self._model.eval()

            return True
        except Exception as e:
            print(f"[ClassificationChain] Failed to load fine-tuned model: {e}")
            return False

    def _load_zeroshot(self):
        """Load the zero-shot classification pipeline as fallback."""
        from transformers import pipeline
        print("[ClassificationChain] Loading zero-shot DistilBERT model...")
        self._classifier = pipeline(
            "zero-shot-classification",
            model="typeform/distilbert-base-uncased-mnli",
            device=-1,
        )
        self._labels = [
            "Network", "Hardware", "Software", "Security",
            "Cloud & Servers", "Storage & Backup", "Email",
            "Account", "General",
        ]
        print("[ClassificationChain] Zero-shot model loaded.")

    def _run_classification(self, inputs: dict) -> dict:
        """Route to fine-tuned or zero-shot classification."""
        if self._mode == "finetuned":
            return self._classify_finetuned(inputs)
        else:
            return self._classify_zeroshot(inputs)

    def _classify_finetuned(self, inputs: dict) -> dict:
        """Classify using the fine-tuned DistilBertForSequenceClassification."""
        issue_text = inputs.get("issue", "")

        encoding = self._tokenizer(
            issue_text,
            max_length=128,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        input_ids = encoding["input_ids"].to(self._device)
        attention_mask = encoding["attention_mask"].to(self._device)

        with torch.no_grad():
            outputs = self._model(input_ids=input_ids, attention_mask=attention_mask)
            probs = torch.nn.functional.softmax(outputs.logits, dim=1)

        probs_np = probs.cpu().numpy()[0]
        top_idx = probs_np.argmax()
        top_category = self._id2label[int(top_idx)]
        confidence = float(probs_np[top_idx])

        # Build all_categories dict (top 5)
        sorted_indices = probs_np.argsort()[::-1][:5]
        all_categories = {
            self._id2label[int(i)]: round(float(probs_np[i]), 3)
            for i in sorted_indices
        }

        priority = self._infer_priority(issue_text)

        return {
            "category": top_category,
            "priority": priority,
            "confidence": round(confidence, 3),
            "all_categories": all_categories,
            "model": "finetuned",
        }

    def _classify_zeroshot(self, inputs: dict) -> dict:
        """Classify using zero-shot (fallback)."""
        issue_text = inputs.get("issue", "")

        category_result = self._classifier(
            issue_text,
            candidate_labels=self._labels,
            multi_label=False,
        )

        top_category = category_result["labels"][0]
        category_confidence = category_result["scores"][0]

        if category_confidence < 0.25:
            top_category = "General"

        priority = self._infer_priority(issue_text)

        return {
            "category": top_category,
            "priority": priority,
            "confidence": round(category_confidence, 3),
            "all_categories": dict(
                zip(category_result["labels"][:5],
                    [round(s, 3) for s in category_result["scores"][:5]])
            ),
            "model": "zeroshot",
        }

    def _infer_priority(self, text: str) -> str:
        """Infer priority based on urgency keywords in the issue text."""
        text_lower = text.lower()

        scores = {}
        for level, keywords in PRIORITY_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in text_lower)
            scores[level] = score

        if max(scores.values()) == 0:
            return "Medium"

        return max(scores, key=scores.get)

    def classify(self, issue: str) -> dict:
        """
        Convenience method to classify a single issue.
        Returns: {"category": str, "priority": str, "confidence": float, "model": str}
        """
        return self.chain.invoke({"issue": issue})

    def classify_batch(self, issues: list[str]) -> list[dict]:
        """Classify multiple issues in batch."""
        return self.chain.batch([{"issue": issue} for issue in issues])
