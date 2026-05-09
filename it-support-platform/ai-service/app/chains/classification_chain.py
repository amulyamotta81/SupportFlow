"""
classification_chain.py
-----------------------
LangChain Classification Chain.

Three-stage pipeline:
  1. Keyword pre-classifier — strong domain signals (webcam, BSOD, password, …)
  2. Fine-tuned DistilBERT model (if present at models/ticket-classifier/)
  3. Ollama LLM (llama3.2) — used as the fallback classifier when no
     fine-tuned model exists. Leverages the same local Ollama instance
     already used for generation, so no extra model needs to be loaded.
"""

import os
import json
import re
import torch
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_ollama import ChatOllama
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv

load_dotenv()

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")

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
            self._load_ollama()
            self._mode = "ollama"
            print(f"[ClassificationChain] No fine-tuned model found. Using OLLAMA ({OLLAMA_MODEL}) as classifier.")

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

    def _load_ollama(self):
        """
        Set up Ollama as the classification model.
        Reuses the same local Ollama instance used by GenerationChain,
        so no additional model weights need to be downloaded.
        """
        #print(f"[ClassificationChain] Connecting to Ollama ({OLLAMA_MODEL}) at {OLLAMA_URL}...")
        print(f"[ClassificationChain] Connecting to Distillbert")
        self._classifier = ChatOllama(
            base_url=OLLAMA_URL,
            model=OLLAMA_MODEL,
            temperature=0.0,      # deterministic classification
            num_predict=40,       # short output — just a label + confidence
            timeout=12000,
        )
        self._labels = [
            "Network", "Hardware", "Software", "Security",
            "Cloud & Servers", "Storage & Backup", "Email",
            "VPN", "Account", "General",
        ]
        print("[ClassificationChain] Ollama classifier ready.")

    def _run_classification(self, inputs: dict) -> dict:
        """Route to fine-tuned or Ollama classification."""
        if self._mode == "finetuned":
            return self._classify_finetuned(inputs)
        else:
            return self._classify_ollama(inputs)

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

    def _classify_ollama(self, inputs: dict) -> dict:
        """
        Classify an IT ticket using the local Ollama LLM.

        Ollama is prompted to return a single structured line:
            CATEGORY|CONFIDENCE
        e.g., "Hardware|0.92". We parse that line; if parsing fails
        we fall back to a best-effort label match on the raw output.
        """
        issue_text = inputs.get("issue", "").strip()
        if not issue_text:
            return {
                "category": "General",
                "priority": "Medium",
                "confidence": 0.0,
                "all_categories": {},
                "model": "ollama",
            }

        labels_str = ", ".join(self._labels)
        system_prompt = (
            "You are an IT ticket classifier. Classify the user's IT issue into "
            f"EXACTLY ONE of these categories: {labels_str}.\n\n"
            "Guidelines:\n"
            "- Hardware: physical devices (webcam, monitor, keyboard, laptop, printer, "
            "blue screen/BSOD, overheating, battery, USB, HDMI, etc.)\n"
            "- Software: application crashes, install/update failures, drivers, licenses.\n"
            "- Network: Wi-Fi, ethernet, router, DNS, slow/no internet.\n"
            "- VPN: VPN client connectivity, remote access, AnyConnect, GlobalProtect.\n"
            "- Email: Outlook, mailbox, send/receive email, Exchange, SMTP/IMAP.\n"
            "- Account: password reset, locked out, MFA/2FA, SSO, login failures.\n"
            "- Security: phishing, malware, virus, hacked, breach.\n"
            "- Storage & Backup: shared drives, OneDrive, backups, disk space.\n"
            "- Cloud & Servers: AWS, Azure, GCP, backend services.\n"
            "- General: only when nothing else fits.\n\n"
            "Respond with EXACTLY one line in this format — nothing else:\n"
            "CATEGORY|CONFIDENCE\n"
            "where CONFIDENCE is a decimal between 0 and 1.\n"
            "Example: Hardware|0.92"
        )

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Issue: {issue_text}"),
        ]

        try:
            response = self._classifier.invoke(messages)
            raw = (response.content if hasattr(response, "content") else str(response)).strip()
        except Exception as e:
            print(f"[ClassificationChain] Ollama classification error: {e}")
            return {
                "category": "General",
                "priority": self._infer_priority(issue_text),
                "confidence": 0.0,
                "all_categories": {},
                "model": "ollama",
            }

        category, confidence = self._parse_ollama_output(raw)
        priority = self._infer_priority(issue_text)

        print(f"[ClassificationChain] │ category={category} │ confidence={confidence:.3f} │ raw={raw[:60]!r}")

        return {
            "category": category,
            "priority": priority,
            "confidence": round(confidence, 3),
            "all_categories": {category: confidence},
            "model": "ollama",
        }

    def _parse_ollama_output(self, raw: str) -> tuple[str, float]:
        """
        Parse Ollama's classification output. Expected format: 'CATEGORY|CONFIDENCE'.
        Falls back to scanning the raw text for any known label if parsing fails.
        """
        # Primary path: pipe-delimited
        match = re.search(r"([A-Za-z&\s]+)\s*\|\s*([0-9]*\.?[0-9]+)", raw)
        if match:
            raw_category = match.group(1).strip()
            try:
                confidence = max(0.0, min(1.0, float(match.group(2))))
            except ValueError:
                confidence = 0.5
            # Normalize to one of our known labels (case-insensitive, fuzzy match)
            category = self._match_label(raw_category)
            if category:
                return category, confidence

        # Fallback: scan for any known label appearing in the text
        category = self._match_label(raw)
        return (category or "General"), 0.5

    def _match_label(self, text: str) -> str | None:
        """Match free text to the closest known label (case-insensitive)."""
        text_lower = text.lower()
        # Exact label match first
        for label in self._labels:
            if label.lower() == text_lower.strip():
                return label
        # Substring match — prefer longer labels to avoid "Account" matching "Cloud & Servers"
        for label in sorted(self._labels, key=len, reverse=True):
            if label.lower() in text_lower:
                return label
        return None

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
