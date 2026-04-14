"""
main.py
-------
FastAPI AI service for IT Support RAG chatbot.
Orchestrates LangChain chains:

  1. ClassificationChain  (DistilBERT)    - auto category/priority
  2. RetrievalChain       (FAISS + RAG)   - similar ticket retrieval + KB mgmt
  3. GenerationChain      (Ollama LLM)    - response generation
  4. ConversationManager  (LangChain Memory) - per-user chat history

Endpoints:
  POST /api/chat               - RAG query + confidence + decision
  POST /api/analyze             - Classify a ticket (DistilBERT)
  POST /api/kb/add              - Add resolved ticket to KB
  POST /api/rebuild-knowledge   - Rebuild KB from ticket list
  GET  /api/health              - Sanity check

Start:
    uvicorn main:app --reload --port 8000
"""

import os
import sys
import traceback

# Ensure the app directory is on the Python path so `chains` package is importable
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from chains.classification_chain import ClassificationChain
from chains.retrieval_chain import RetrievalChain
from chains.generation_chain import GenerationChain
from chains.conversation_chain import ConversationManager

load_dotenv()

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="IT Support AI Service — LangChain Architecture", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Initialize LangChain Chains ──────────────────────────────────────────────
classification_chain = ClassificationChain()
retrieval_chain      = RetrievalChain()
generation_chain     = GenerationChain()
conversation_mgr     = ConversationManager(max_history_per_user=20)


@app.on_event("startup")
def startup():
    try:
        retrieval_chain.load()
        print(f"[startup] KB loaded: {retrieval_chain.vector_count} vectors")
        print("[startup] All LangChain chains initialized successfully")
    except Exception as e:
        print(f"[startup] KB load failed: {e}")
        traceback.print_exc()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    userId: str = ""
    chat_history: list[dict] = []  # optional: [{role, content}, ...]

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

class AnalyzeRequest(BaseModel):
    issue: str
    agents: list[dict] = []

class KBAddRequest(BaseModel):
    issue: str
    resolution: str
    category: str = "General"
    priority: str = "Medium"
    root_cause: str = ""
    source: str = "dynamic"
    ticket_id: str = ""
    failed_attempts: list[str] = []
    rounds_to_resolve: int = 1

class RebuildRequest(BaseModel):
    tickets: list[dict]


# ── Confidence Engine ─────────────────────────────────────────────────────────

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


# ── Greeting / small-talk detection ──────────────────────────────────────────

GREETING_PATTERNS = {
    "hi", "hello", "hey", "hii", "hiii", "hiiii", "yo", "sup",
    "good morning", "good afternoon", "good evening", "good day",
    "howdy", "greetings", "what's up", "whats up", "wassup",
    "how are you", "how r u", "hola", "namaste",
    "thanks", "thank you", "thx", "ty", "ok", "okay",
    "bye", "goodbye", "see you", "see ya", "later",
}

def is_greeting(text: str) -> bool:
    """Check if the message is a greeting or small talk, not an IT issue."""
    cleaned = text.lower().strip().rstrip("!.,?")
    # Exact match
    if cleaned in GREETING_PATTERNS:
        return True
    # Short messages (1-3 words) that start with a greeting word
    words = cleaned.split()
    if len(words) <= 3 and words[0] in GREETING_PATTERNS:
        return True
    return False

GREETING_RESPONSE = (
    "Hi there! I'm your IT Support Assistant. "
    "I can help you troubleshoot technical issues like VPN problems, "
    "network connectivity, software errors, account access, and more.\n\n"
    "Just describe your IT issue and I'll search our knowledge base for the best solution!"
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "architecture": "LangChain",
        "chains": {
            "classification": "DistilBERT (zero-shot)",
            "retrieval": f"FAISS ({retrieval_chain.vector_count} vectors)",
            "generation": f"Ollama ({os.getenv('OLLAMA_MODEL', 'llama3.2')})",
            "conversation": f"{conversation_mgr.active_sessions} active sessions",
        },
        "vectors_loaded": retrieval_chain.vector_count,
        "ollama_model": os.getenv("OLLAMA_MODEL", "llama3.2"),
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """
    Main RAG chat endpoint orchestrating all LangChain chains:
      1. Classification Chain  → category + priority (DistilBERT)
      2. Retrieval Chain       → top-3 similar tickets (FAISS)
      3. Generation Chain      → LLM answer (Ollama) with conversation history
      4. Confidence Engine     → weighted score + decision
    """
    query = req.message.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    user_id = req.userId or "anonymous"

    # ── Greeting / small-talk — skip RAG pipeline ─────────────────────────
    if is_greeting(query):
        conversation_mgr.add_user_message(user_id, query)
        conversation_mgr.add_ai_message(user_id, GREETING_RESPONSE)
        return ChatResponse(
            answer=GREETING_RESPONSE,
            category="",
            priority="",
            similarity_score=0.0,
            llm_confidence=0.0,
            success_rate=0.0,
            final_confidence=0.0,
            decision="greeting",
            sources=[],
        )

    # ── Step 1: Classification Chain (DistilBERT) ─────────────────────────
    print(f"\n{'─'*70}")
    print(f"🧠 RAG PIPELINE START │ user={user_id} │ query=\"{query[:60]}\"")
    print(f"{'─'*70}")
    try:
        classification = classification_chain.classify(query)
        classified_category = classification["category"]
        classified_priority = classification["priority"]
        classification_confidence = classification["confidence"]
        print(f"  ① CLASSIFICATION  │ category={classified_category} │ priority={classified_priority} │ confidence={classification_confidence:.3f}")
    except Exception as e:
        print(f"  ① CLASSIFICATION  │ ERROR: {e} — falling back to General/Medium")
        classified_category = "General"
        classified_priority = "Medium"
        classification_confidence = 0.0

    # ── Step 2: Retrieval Chain (FAISS RAG) ───────────────────────────────
    try:
        retrieval_output = retrieval_chain.chain.invoke({"query": query, "top_k": 3})
        results = retrieval_output.get("results", [])
        context = retrieval_output.get("context", "")
        print(f"  ② RETRIEVAL       │ {len(results)} similar tickets found in FAISS")
        for i, r in enumerate(results[:3]):
            print(f"     └─ #{i+1} {r.get('issue','?')[:50]} │ similarity={r.get('similarity',0):.3f}")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Retrieval chain error: {str(e)}")

    if not results:
        return ChatResponse(
            answer="No relevant knowledge base entries found. A ticket will be created.",
            category=classified_category,
            priority=classified_priority,
            similarity_score=0, llm_confidence=0, success_rate=0,
            final_confidence=0, decision="escalate", sources=[]
        )

    top = results[0]
    similarity   = float(top.get("similarity", 0.0))
    success_rate = float(top.get("success_rate", 0.75))

    # Use DistilBERT classification, with retrieval as fallback
    category = classified_category if classified_category != "General" else top.get("category", "General")
    priority = classified_priority

    # ── Step 3: Conversation History (LangChain Memory) ───────────────────
    # Load any history sent from frontend, or use in-memory session
    if req.chat_history:
        conversation_mgr.load_history_from_dicts(user_id, req.chat_history)

    # Add current user message to conversation memory
    conversation_mgr.add_user_message(user_id, query)

    # Get LangChain message history for the generation chain
    chat_history = conversation_mgr.get_langchain_history(user_id)
    print(f"  ③ MEMORY          │ {len(chat_history)} messages in conversation history for user={user_id}")

    # ── Step 4: Generation Chain (Ollama LLM) ─────────────────────────────
    try:
        answer, llm_conf = generation_chain.generate(
            query=query,
            context=context,
            chat_history=chat_history[:-1],  # exclude current message (already in prompt)
        )
        print(f"  ④ LLM GENERATION  │ Ollama responded │ llm_confidence={llm_conf:.3f} │ answer_length={len(answer)} chars")
    except RuntimeError as e:
        print(f"  ④ LLM GENERATION  │ Ollama unavailable — using retrieval fallback")
        answer   = f"Based on similar past issues:\n\n{results[0].get('resolution', 'No solution available')}"
        llm_conf = 0.0

    # Store AI response in conversation memory
    conversation_mgr.add_ai_message(user_id, answer)

    # ── Step 5: Confidence Engine + Decision ──────────────────────────────
    final_conf = compute_confidence(similarity, llm_conf, success_rate)
    action     = decide(final_conf)
    action_emoji = {"auto_resolve": "🟢", "suggest": "🟡", "escalate": "🔴"}.get(action, "⚪")
    print(f"  ⑤ CONFIDENCE      │ similarity={similarity:.3f} × 0.4 + llm={llm_conf:.3f} × 0.3 + success={success_rate:.3f} × 0.3 = {final_conf:.3f}")
    print(f"  ⑥ DECISION        │ {action_emoji} {action.upper()} (threshold: ≥0.85=auto, ≥0.60=suggest, <0.60=escalate)")
    print(f"{'─'*70}\n")

    # ── Step 6: Build response ────────────────────────────────────────────
    sources = [
        {
            "issue":        str(r.get("issue", "N/A")),
            "category":     str(r.get("category", "General")),
            "priority":     str(r.get("priority", "Medium")),
            "resolution":   str(r.get("resolution", "No resolution")),
            "similarity":   float(round(r.get("similarity", 0.0), 3)),
            "success_rate": float(r.get("success_rate", 0.75)),
        }
        for r in results
    ]

    return ChatResponse(
        answer=answer,
        category=category,
        priority=priority,
        similarity_score=round(similarity, 3),
        llm_confidence=round(llm_conf, 3),
        success_rate=round(success_rate, 3),
        final_confidence=round(final_conf, 3),
        decision=action,
        sources=sources,
    )


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    """
    Classification-only endpoint using DistilBERT chain.
    Called by the backend when creating tickets.
    """
    try:
        print(f"\n🏷️  CLASSIFY │ issue=\"{req.issue[:60]}\"")
        result = classification_chain.classify(req.issue)

        # Agent matching: find agent whose skills best match the category
        best_agent = None
        if req.agents:
            category_lower = result["category"].lower()
            for agent in req.agents:
                skills = [s.lower() for s in agent.get("skills", [])]
                if category_lower in skills or any(category_lower in s for s in skills):
                    best_agent = agent["id"]
                    break
            if not best_agent and req.agents:
                best_agent = req.agents[0]["id"]

        print(f"   └─ result │ category={result['category']} │ priority={result['priority']} │ confidence={result['confidence']:.3f} │ agent={'matched' if best_agent else 'none'}")

        return {
            "category": result["category"],
            "priority": result["priority"],
            "confidence": result["confidence"],
            "bestAgent": best_agent,
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Classification error: {str(e)}")


@app.post("/api/kb/add")
def kb_add(req: KBAddRequest):
    """
    Add a resolved ticket to the FAISS knowledge base.
    Called when tickets are resolved — KB grows dynamically.
    """
    try:
        print(f"\n📚 KB ADD │ {req.ticket_id} │ source={req.source} │ category={req.category}")
        print(f"   └─ issue:      \"{req.issue[:70]}\"")
        print(f"   └─ resolution: \"{req.resolution[:70]}\"")
        if req.failed_attempts:
            print(f"   └─ failed({len(req.failed_attempts)}):  {[f[:40] for f in req.failed_attempts]}")
        print(f"   └─ rounds:     {req.rounds_to_resolve}")

        success = retrieval_chain.add_to_kb(
            issue=req.issue,
            resolution=req.resolution,
            category=req.category,
            priority=req.priority,
            root_cause=req.root_cause,
            source=req.source,
            ticket_id=req.ticket_id,
            failed_attempts=req.failed_attempts,
            rounds_to_resolve=req.rounds_to_resolve,
        )
        print(f"   └─ ✅ FAISS vectors now: {retrieval_chain.vector_count}")
        return {"ok": success, "vectors": retrieval_chain.vector_count}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"KB add error: {str(e)}")


@app.post("/api/rebuild-knowledge")
def rebuild_knowledge(req: RebuildRequest):
    """
    Rebuild the entire KB from a list of resolved tickets.
    Used by admin sync endpoint.
    """
    try:
        count = retrieval_chain.rebuild_kb(req.tickets)
        return {"ok": True, "count": count}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"KB rebuild error: {str(e)}")


@app.post("/api/conversation/clear")
def clear_conversation(req: ChatRequest):
    """Clear conversation history for a user (new chat session)."""
    user_id = req.userId or "anonymous"
    conversation_mgr.clear_history(user_id)
    return {"ok": True, "message": f"Conversation cleared for {user_id}"}


# ── Global error handler ─────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__}
    )
