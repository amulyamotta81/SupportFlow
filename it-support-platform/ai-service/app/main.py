"""
main.py
-------
FastAPI AI service for IT Support RAG chatbot.

Endpoints:
  POST /api/chat    → RAG query + confidence score + decision
  GET  /api/health  → sanity check

Start:
    uvicorn main:app --reload --port 8000
"""

import os
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from faiss_manager import FAISSKBManager
from llm import ask_llm

load_dotenv()

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="IT Support AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load FAISS KB once on startup
kb = FAISSKBManager()

@app.on_event("startup")
def startup():
    try:
        kb.load()
        print(f"✅ KB loaded: {kb.index.ntotal} vectors")
    except Exception as e:
        print(f"❌ KB load failed: {e}")

# ── Schemas ───────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    userId: str = ""

class ChatResponse(BaseModel):
    answer:           str
    category:         str
    priority:         str
    similarity_score: float
    llm_confidence:   float
    success_rate:     float
    final_confidence: float
    decision:         str
    sources:          list[dict]

# ── Confidence engine ─────────────────────────────────────────────────────────
WEIGHTS = {"similarity": 0.4, "llm": 0.3, "success": 0.3}

def compute_confidence(similarity: float, llm_conf: float, success_rate: float) -> float:
    return (
        WEIGHTS["similarity"] * similarity +
        WEIGHTS["llm"]        * llm_conf   +
        WEIGHTS["success"]    * success_rate
    )

def decide(confidence: float) -> str:
    if confidence >= 0.85:
        return "auto_resolve"
    elif confidence >= 0.60:
        return "suggest"
    else:
        return "escalate"

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    vectors = kb.index.ntotal if kb.index else 0
    return {
        "status": "ok",
        "vectors_loaded": vectors,
        "ollama_model": os.getenv("OLLAMA_MODEL", "llama3.2")
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    query = req.message.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    # 1. FAISS retrieval
    try:
        results = kb.search(query, top_k=3)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"FAISS search error: {str(e)}")

    if not results:
        return ChatResponse(
            answer="No relevant knowledge base entries found. A ticket will be created.",
            category="Unknown", priority="Medium",
            similarity_score=0, llm_confidence=0, success_rate=0,
            final_confidence=0, decision="escalate", sources=[]
        )

    top          = results[0]
    similarity   = top["similarity"]
    success_rate = top["success_rate"]

    # 2. Build context for LLM
    context_parts = []
    for r in results:
        context_parts.append(
            f"Issue: {r['issue']}\n"
            f"Category: {r['category']} | Priority: {r['priority']}\n"
            f"Resolution: {r['resolution']}\n"
            f"Historical Success Rate: {r['success_rate']*100:.0f}%"
        )
    context = "\n\n---\n\n".join(context_parts)

    # 3. LLM answer
    try:
        answer, llm_conf = ask_llm(query=query, context=context)
    except RuntimeError as e:
        # Ollama not running — still return FAISS results with fallback answer
        print(f"⚠️  LLM unavailable: {e}")
        answer   = f"Based on similar past issues:\n\n{results[0]['resolution']}"
        llm_conf = 0.0

    # 4. Final confidence + decision
    final_conf = compute_confidence(similarity, llm_conf, success_rate)
    action     = decide(final_conf)

    # 5. Clean sources for response
    sources = [
        {
            "issue":        r["issue"],
            "category":     r["category"],
            "priority":     r["priority"],
            "resolution":   r["resolution"],
            "similarity":   round(r["similarity"], 3),
            "success_rate": r["success_rate"],
        }
        for r in results
    ]

    return ChatResponse(
        answer=answer,
        category=top["category"],
        priority=top["priority"],
        similarity_score=round(similarity,  3),
        llm_confidence=round(llm_conf,      3),
        success_rate=round(success_rate,    3),
        final_confidence=round(final_conf,  3),
        decision=action,
        sources=sources,
    )


# ── Global error handler — always return JSON, never plain text ───────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__}
    )