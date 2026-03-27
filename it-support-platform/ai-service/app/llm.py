"""
llm.py
------
LLM layer using Ollama.

Key design:
- ask_llm() returns structured JSON — no regex parsing downstream
- classify_query() runs a fast separate call for category + priority
- LLM confidence = self-reported from structured output (0-1)
- Final confidence computed in main.py from: similarity + llm_conf + resolution_quality
  (No success_rate from CSV — computed from resolution text quality instead)
"""

import re
import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")

# ── RAG answer prompt ─────────────────────────────────────────────────────────
RAG_SYSTEM_PROMPT = """You are an expert IT support assistant.
You receive a user's IT issue and relevant knowledge base articles.

Respond with ONLY a valid JSON object. No text before or after. No markdown. Raw JSON only.

{
  "root_cause": "one sentence: the most likely technical cause",
  "fix_steps":  ["step 1", "step 2", "step 3"],
  "summary":    "one sentence plain-English solution summary",
  "confidence": 0.85
}

Rules:
- fix_steps: array of clear, actionable strings. Minimum 2, maximum 7.
- confidence: float 0.0-1.0. How well does the KB context match this specific query?
  0.9+ = KB has near-identical issue with proven fix
  0.7-0.9 = KB has related issue, fix likely applies
  0.5-0.7 = KB is somewhat relevant, fix may need adaptation
  <0.5 = KB context is not relevant to this query
- Do NOT invent steps not supported by KB context
- If KB context is irrelevant, say so in root_cause and set confidence < 0.4"""

# ── Classification prompt ─────────────────────────────────────────────────────
CLASSIFY_PROMPT = """You are an IT support ticket classifier.
Respond with ONLY valid JSON. No extra text.

{
  "category": "Network",
  "priority": "High",
  "confidence": 0.9
}

Category: Network | Hardware | Software | Security | Email | VPN | Account | General

Priority — based on business impact AND urgency tone in the message:
  Critical: system/company-wide outage, data breach, ransomware, production stopped
  High: single user fully blocked, VPN down, security threat, BSOD, cannot do job at all
  Medium: degraded performance, partial functionality, email issues, software problems
  Low: minor inconvenience, cosmetic, non-urgent question, how-to request"""


def _call_ollama(system: str, user_msg: str, max_tokens: int = 600) -> str:
    payload = {
        "model":   OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user_msg},
        ],
        "stream":  False,
        "options": {"temperature": 0.1, "num_predict": max_tokens}
    }
    try:
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()
    except requests.exceptions.ConnectionError:
        raise RuntimeError("Cannot connect to Ollama. Run: ollama serve")
    except requests.exceptions.Timeout:
        raise RuntimeError("Ollama timed out.")
    except Exception as e:
        raise RuntimeError(f"Ollama error: {e}")


def _safe_json(text: str) -> dict:
    """Robustly extract JSON from LLM output."""
    # Direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # Strip markdown fences
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Find first {...} block
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    return {}


def classify_query(query: str) -> dict:
    """
    Returns { category, priority, confidence }.
    Fast separate call — does not affect RAG answer quality.
    Falls back to keyword rules if Ollama is unavailable.
    """
    from build_kb import infer_category, infer_priority

    try:
        raw    = _call_ollama(CLASSIFY_PROMPT, f"IT Issue: {query}", max_tokens=80)
        result = _safe_json(raw)

        valid_cats = {"Network","Hardware","Software","Security","Email","VPN","Account","General"}
        valid_pris = {"Low","Medium","High","Critical"}

        category = result.get("category", "")
        priority = result.get("priority", "")
        conf     = max(0.0, min(1.0, float(result.get("confidence", 0.7))))

        if category not in valid_cats:
            category = infer_category(query)
        if priority not in valid_pris:
            priority = infer_priority(query, category=category)

        return {"category": category, "priority": priority, "confidence": conf}

    except RuntimeError:
        from build_kb import infer_category, infer_priority
        return {
            "category":   infer_category(query),
            "priority":   infer_priority(query),
            "confidence": 0.5
        }


def ask_llm(query: str, context: str) -> tuple[str, float, list[str], str]:
    """
    Returns: (answer_text, llm_confidence, fix_steps, root_cause)

    llm_confidence = how confident the LLM is that KB context answers this query.
    Completely independent of CSV — computed from reasoning, not lookup.
    """
    user_prompt = (
        f"User IT Issue: {query}\n\n"
        f"Knowledge Base Context:\n{context}\n\n"
        f"Respond with ONLY the JSON object."
    )

    raw    = _call_ollama(RAG_SYSTEM_PROMPT, user_prompt, max_tokens=800)
    result = _safe_json(raw)

    root_cause = str(result.get("root_cause", "Unable to determine root cause."))
    fix_steps  = result.get("fix_steps", [])
    confidence = float(result.get("confidence", 0.5))
    summary    = str(result.get("summary", root_cause))

    confidence = max(0.0, min(1.0, confidence))

    if not isinstance(fix_steps, list):
        fix_steps = [str(fix_steps)]
    fix_steps = [s.strip() for s in fix_steps if isinstance(s, str) and s.strip()]

    answer = f"{summary}\n\nRoot Cause: {root_cause}"
    return answer, confidence, fix_steps, root_cause