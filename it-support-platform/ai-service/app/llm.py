"""
llm.py
------
LLM layer using Ollama (local, free, no API key needed).
Default model: llama3.2  —  change OLLAMA_MODEL in .env to swap.

Ollama must be running:  ollama serve
Model must be pulled:    ollama pull llama3.2
"""

import re
import os
import requests
from dotenv import load_dotenv

load_dotenv()

OLLAMA_URL   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")

SYSTEM_PROMPT = """You are an expert IT support assistant.
You will be given a user's IT problem and relevant knowledge base articles.

Your response must include:
1. Root Cause: one sentence explaining the likely cause.
2. Fix Steps: clear numbered steps the user can follow.
3. On the very last line, output ONLY this — nothing else after it:
   CONFIDENCE: <a decimal between 0 and 1>

Base your confidence on how well the KB context matches the query.
Be concise and do not invent steps not supported by the context."""


def ask_llm(query: str, context: str) -> tuple[str, float]:
    """
    Calls Ollama and returns (answer_text, llm_confidence).
    """
    user_prompt = f"""User Query: {query}

Knowledge Base Context:
{context}

Provide your answer, then end with CONFIDENCE: <score>"""

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_prompt},
        ],
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_predict": 600,
        }
    }

    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json=payload,
            timeout=12000  # local LLM can be slow on first run
        )
        resp.raise_for_status()
        full_text = resp.json()["message"]["content"].strip()
        return _parse_response(full_text)

    except requests.exceptions.ConnectionError:
        raise RuntimeError(
            "Cannot connect to Ollama. Make sure it is running: ollama serve"
        )
    except requests.exceptions.Timeout:
        raise RuntimeError(
            "Ollama timed out. Try a smaller model: ollama pull llama3.2"
        )
    except Exception as e:
        raise RuntimeError(f"Ollama error: {e}")


def get_llm_confidence(query: str, context: str) -> float:
    """Convenience wrapper — returns just the confidence score."""
    _, conf = ask_llm(query, context)
    return conf


def _parse_response(text: str) -> tuple[str, float]:
    """Splits LLM output into (answer, confidence_score)."""
    conf  = 0.7   # safe default if line is missing
    match = re.search(r"CONFIDENCE:\s*([0-9.]+)", text, re.IGNORECASE)
    if match:
        try:
            conf = float(match.group(1))
            conf = max(0.0, min(1.0, conf))
        except ValueError:
            pass

    answer = re.sub(r"\n?CONFIDENCE:\s*[0-9.]+", "", text, flags=re.IGNORECASE).strip()
    return answer, conf