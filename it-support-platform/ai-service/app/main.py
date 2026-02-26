from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Tuple
import numpy as np
import json
import os

app = FastAPI(title="IT Support AI Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FAISS_INDEX_PATH = "faiss_index"
METADATA_PATH = "ticket_metadata.json"

class ChatRequest(BaseModel):
    message: str
    userId: Optional[str] = None

class AgentInput(BaseModel):
    id: str
    skills: list = []

class AnalyzeRequest(BaseModel):
    issue: str
    agents: Optional[List[AgentInput]] = None

class TicketInput(BaseModel):
    issue: str
    category: str = "General"
    resolution: str = "N/A"

class RebuildKnowledgeRequest(BaseModel):
    tickets: List[TicketInput]

vector_store = None
metadata = []

def load_or_create_faiss():
    global vector_store, metadata
    if os.path.exists(FAISS_INDEX_PATH) and os.path.exists(METADATA_PATH):
        try:
            import faiss
            vector_store = faiss.read_index(FAISS_INDEX_PATH)
            with open(METADATA_PATH, "r") as f:
                metadata = json.load(f)
            return
        except Exception as e:
            print(f"Error loading FAISS: {e}")
    init_faiss()

def init_faiss():
    global vector_store, metadata
    try:
        from sentence_transformers import SentenceTransformer
        import faiss

        model = SentenceTransformer("all-MiniLM-L6-v2")
        
        knowledge_base = [
            ("VPN not connecting", "Network", "High", "Certificate expired or VPN client outdated", "Renew certificate, update VPN client, restart service"),
            ("Email not working", "Email", "High", "Server credentials or Outlook cache", "Reset password, clear Outlook cache, check server settings"),
            ("Printer not printing", "Hardware", "Medium", "Print spooler or driver issue", "Restart print spooler, reinstall printer driver"),
            ("Laptop slow", "Software", "Medium", "Too many startup apps or low memory", "Disable startup apps, add RAM, run disk cleanup"),
            ("Password reset", "Account", "High", "User forgot password", "Reset via admin panel or self-service portal"),
            ("WiFi disconnected", "Network", "Medium", "Driver or router issue", "Update WiFi driver, restart router"),
            ("Monitor not displaying", "Hardware", "Medium", "Cable or display settings", "Check cable connection, adjust display settings"),
            ("Software installation", "Software", "Low", "Admin rights required", "Use software center or contact IT for install"),
            ("Blue screen error", "Hardware", "High", "Driver or memory failure", "Update drivers, run memory diagnostic"),
            ("Disk space full", "Software", "Medium", "Temp files and old data", "Run disk cleanup, move files to network drive"),
        ]
        
        for _ in range(100):
            knowledge_base.append((
                "VPN certificate expired - user cannot connect",
                "Network", "High", "Certificate expired", "Renew VPN certificate"
            ))
            knowledge_base.append((
                "Outlook keeps crashing on startup",
                "Email", "High", "Corrupted profile", "Create new Outlook profile"
            ))
        
        texts = [f"{t[0]} | {t[2]} | {t[3]}" for t in knowledge_base]
        embeddings = model.encode(texts)
        embeddings = np.array(embeddings).astype("float32")
        
        dim = embeddings.shape[1]
        index = faiss.IndexFlatL2(dim)
        index.add(embeddings)
        
        metadata = [
            {"issue": t[0], "category": t[1], "priority": t[2], "root_cause": t[3], "solution": t[4]}
            for t in knowledge_base
        ]
        
        faiss.write_index(index, FAISS_INDEX_PATH)
        with open(METADATA_PATH, "w") as f:
            json.dump(metadata, f)
        
        vector_store = index
        print("FAISS index created")
    except Exception as e:
        print(f"FAISS init error (using fallback): {e}")
        vector_store = None
        metadata = []

def _get_best_agent(agents: list, category: str) -> Optional[str]:
    """Pick agent whose skills match the ticket category (dynamic from DB)."""
    if not agents:
        return None
    category_lower = category.lower()
    for a in agents:
        skills = [s.lower() for s in (a.get("skills") or [])]
        if category_lower in skills or any(s in category_lower for s in skills):
            return a.get("id")
    return agents[0].get("id") if agents else None

def analyze_issue_simple(issue: str, agents: Optional[list] = None) -> dict:
    issue_lower = issue.lower()
    category = "General"
    priority = "Medium"
    root_cause = "Further investigation needed"
    suggested_fix = ["Review similar tickets", "Apply standard fix", "Escalate if needed"]
    confidence = 0.75

    if "vpn" in issue_lower or "network" in issue_lower:
        category = "Network"
        priority = "High" if "not" in issue_lower or "connect" in issue_lower else "Medium"
        root_cause = "Certificate expired or network configuration"
        confidence = 0.91
    elif "email" in issue_lower or "outlook" in issue_lower:
        category = "Email"
        priority = "High"
        root_cause = "Credentials or cache corruption"
        confidence = 0.88
    elif "printer" in issue_lower or "print" in issue_lower:
        category = "Hardware"
        priority = "Medium"
        root_cause = "Print spooler or driver"
        confidence = 0.85
    elif "password" in issue_lower or "login" in issue_lower:
        category = "Account"
        priority = "High"
        root_cause = "Credentials expired or locked"
        confidence = 0.92
    elif "slow" in issue_lower or "freeze" in issue_lower:
        category = "Software"
        priority = "Medium"
        root_cause = "Memory or startup applications"
        confidence = 0.82

    # similarTickets: backend will replace with real MongoDB data
    best_agent = _get_best_agent(agents or [], category) if agents else None

    return {
        "category": category,
        "priority": priority,
        "confidence": confidence,
        "rootCause": root_cause,
        "suggestedFix": suggested_fix,
        "similarTickets": [],
        "bestAgent": best_agent
    }

@app.on_event("startup")
def startup():
    try:
        load_or_create_faiss()
    except Exception as e:
        print(f"FAISS init skipped, using keyword fallback: {e}")

@app.get("/")
def root():
    return {"service": "IT Support AI", "status": "running"}

@app.post("/api/chat")
def chat(request: ChatRequest):
    issue = request.message
    analysis = analyze_issue_simple(issue)
    if vector_store is not None and metadata:
        try:
            results = _do_rag_search(issue)
            if results:
                fixes = [r.get("solution", "")[:150] for r in results[:3] if r.get("solution")]
                if fixes:
                    analysis["suggestedFix"] = fixes
                if results[0].get("root_cause"):
                    analysis["rootCause"] = results[0]["root_cause"]
        except Exception:
            pass
    
    response_text = f"""Based on your issue "{issue}", here's what I found:

**Possible Root Cause:** {analysis['rootCause']}

**Suggested Steps:**
1. {analysis['suggestedFix'][0]}
2. {analysis['suggestedFix'][1]}
3. {analysis['suggestedFix'][2]}

**Confidence:** {int(analysis['confidence']*100)}%

Would you like to try these steps, or shall I create a ticket for an agent to assist you?"""
    
    return {
        "response": response_text,
        "confidence": analysis["confidence"],
        "suggestedCategory": analysis["category"],
        "suggestedPriority": analysis["priority"],
        "rootCause": analysis["rootCause"],
        "suggestedFix": analysis["suggestedFix"]
    }

def _build_faiss_from_tickets(ticket_list: list) -> Tuple[bool, Optional[str]]:
    """Build FAISS index from ticket data. Returns (success, error_message)."""
    global vector_store, metadata
    if not ticket_list:
        return False, "No tickets to sync"
    try:
        from sentence_transformers import SentenceTransformer
        import faiss

        model = SentenceTransformer("all-MiniLM-L6-v2")
        texts = [f"{t['issue']} | {t.get('category', '')} | {t.get('resolution', '')}" for t in ticket_list]
        embeddings = model.encode(texts)
        embeddings = np.array(embeddings).astype("float32")
        dim = embeddings.shape[1]
        index = faiss.IndexFlatL2(dim)
        index.add(embeddings)
        metadata = [
            {"issue": t["issue"], "category": t.get("category", ""), "priority": "Medium",
             "root_cause": (t.get("resolution", "") or "")[:200], "solution": t.get("resolution", "") or ""}
            for t in ticket_list
        ]
        faiss.write_index(index, FAISS_INDEX_PATH)
        with open(METADATA_PATH, "w") as f:
            json.dump(metadata, f)
        vector_store = index
        return True, None
    except Exception as e:
        import traceback
        err_msg = str(e)
        print(f"FAISS rebuild error: {err_msg}")
        traceback.print_exc()
        return False, err_msg

@app.post("/api/rebuild-knowledge")
def rebuild_knowledge(request: RebuildKnowledgeRequest):
    """Rebuild FAISS from resolved tickets sent by backend (dynamic)."""
    tickets = [{"issue": t.issue, "category": t.category or "General", "resolution": t.resolution or "N/A"} for t in request.tickets]
    ok, err = _build_faiss_from_tickets(tickets)
    return {"ok": ok, "count": len(tickets), "error": err}

def _do_rag_search(issue: str) -> list:
    """Internal RAG search over FAISS index."""
    if vector_store is None:
        return metadata[:5] if metadata else []
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer("all-MiniLM-L6-v2")
        query_emb = model.encode([issue])
        query_emb = np.array(query_emb).astype("float32")
        k = min(5, len(metadata))
        distances, indices = vector_store.search(query_emb, k)
        return [metadata[i] for i in indices[0] if i < len(metadata)]
    except Exception:
        return []

@app.post("/api/analyze")
def analyze(request: AnalyzeRequest):
    agents_data = [{"id": a.id, "skills": a.skills} for a in (request.agents or [])]
    result = analyze_issue_simple(request.issue, agents_data)
    if vector_store is not None and metadata:
        try:
            results = _do_rag_search(request.issue)
            if results:
                fixes = [r.get("solution", "")[:150] for r in results[:3] if r.get("solution")]
                if fixes:
                    result["suggestedFix"] = fixes
                if results[0].get("root_cause"):
                    result["rootCause"] = results[0]["root_cause"]
        except Exception:
            pass
    return result

@app.post("/api/rag/search")
def rag_search(request: AnalyzeRequest):
    try:
        results = _do_rag_search(request.issue)
        return {"results": results}
    except Exception as e:
        return {"results": [], "error": str(e)}
