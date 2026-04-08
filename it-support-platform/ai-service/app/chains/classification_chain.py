"""
classification_chain.py
-----------------------
LangChain Classification Chain using DistilBERT.

Automatically assigns Category and Priority to a ticket based on the
issue description text. Uses a fine-tuned DistilBERT zero-shot
classification model wrapped as a LangChain Runnable.

Pipeline:
  1. User issue text comes in
  2. DistilBERT zero-shot classifier scores candidate labels
  3. Returns top category + inferred priority
"""

import re
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from transformers import pipeline

# ── Category & Priority labels ────────────────────────────────────────────────

CATEGORY_LABELS = [
    "VPN",
    "Network",
    "Security",
    "Hardware",
    "Cloud & Servers",
    "Storage & Backup",
    "Software",
    "Email",
    "Account",
    "Database",
    "General",
]

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
    LangChain-based classification chain using DistilBERT zero-shot classifier.

    Usage:
        chain = ClassificationChain()
        result = chain.classify("My VPN keeps disconnecting every 5 minutes")
        # result = {"category": "VPN", "priority": "High", "confidence": 0.87}
    """

    def __init__(self):
        # Load DistilBERT zero-shot classification pipeline
        # Uses distilbert-base-uncased-mnli for zero-shot classification
        print("[ClassificationChain] Loading DistilBERT model...")
        self._classifier = pipeline(
            "zero-shot-classification",
            model="typeform/distilbert-base-uncased-mnli",
            device=-1,  # CPU; set to 0 for GPU
        )
        print("[ClassificationChain] DistilBERT model loaded.")

        # Build the LangChain chain
        self.chain = (
            RunnablePassthrough()
            | RunnableLambda(self._run_classification)
        )

    def _run_classification(self, inputs: dict) -> dict:
        """
        Core classification logic:
        1. Run DistilBERT zero-shot on category labels
        2. Infer priority from keywords + urgency tone
        """
        issue_text = inputs.get("issue", "")

        # ── Step 1: Category classification with DistilBERT ──────────────
        category_result = self._classifier(
            issue_text,
            candidate_labels=CATEGORY_LABELS,
            multi_label=False,
        )

        top_category = category_result["labels"][0]
        category_confidence = category_result["scores"][0]

        # If confidence is too low, fall back to "General"
        if category_confidence < 0.25:
            top_category = "General"

        # ── Step 2: Priority inference from keywords ─────────────────────
        priority = self._infer_priority(issue_text)

        return {
            "category": top_category,
            "priority": priority,
            "confidence": round(category_confidence, 3),
            "all_categories": dict(
                zip(category_result["labels"][:5],
                    [round(s, 3) for s in category_result["scores"][:5]])
            ),
        }

    def _infer_priority(self, text: str) -> str:
        """Infer priority based on urgency keywords in the issue text."""
        text_lower = text.lower()

        # Score each priority level
        scores = {}
        for level, keywords in PRIORITY_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in text_lower)
            scores[level] = score

        # Pick highest-scoring priority, default to Medium
        if max(scores.values()) == 0:
            return "Medium"

        return max(scores, key=scores.get)

    def classify(self, issue: str) -> dict:
        """
        Convenience method to classify a single issue.
        Returns: {"category": str, "priority": str, "confidence": float}
        """
        return self.chain.invoke({"issue": issue})

    def classify_batch(self, issues: list[str]) -> list[dict]:
        """Classify multiple issues in batch."""
        return self.chain.batch([{"issue": issue} for issue in issues])
