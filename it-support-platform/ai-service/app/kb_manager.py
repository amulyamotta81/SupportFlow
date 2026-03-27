"""
kb_manager.py
-------------
Live KB update API. Called when:
  - Agent marks ticket resolved (source: agent_resolution)
  - Admin approves escalated ticket resolution (source: admin_resolution)
  - User confirms "This solved my issue" (source: user_confirmed)

Replaces kb_updater.py — now uses faiss_manager.add_document() directly.
"""

import os
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from build_kb import infer_category, infer_priority   # reuse same logic

router = APIRouter()

# Injected by main.py at startup
_kb = None

def set_kb(kb_instance):
    global _kb
    _kb = kb_instance


class KBAddRequest(BaseModel):
    issue:       str
    resolution:  str
    category:    str  = ""
    priority:    str  = ""
    description: str  = ""
    source:      str  = "agent_resolution"   # agent_resolution | admin_resolution | user_confirmed
    ticket_id:   str  = ""


@router.post("/api/kb/add")
def add_to_kb(req: KBAddRequest):
    """
    Add a resolved ticket to the live FAISS KB.
    Category and priority are always re-inferred from text —
    never trusted from the request if they look wrong.
    """
    if not req.issue.strip() or not req.resolution.strip():
        raise HTTPException(status_code=400, detail="issue and resolution are required")

    if _kb is None:
        raise HTTPException(status_code=500, detail="KB not initialised")

    valid_cats = {"Network","Hardware","Software","Security","Email","VPN","Account","General"}
    valid_pris = {"Low","Medium","High","Critical"}

    # Validate or re-infer category
    category = req.category.strip()
    if category not in valid_cats:
        category = infer_category(req.issue, req.description)

    # Validate or re-infer priority
    priority = req.priority.strip()
    if priority not in valid_pris:
        priority = infer_priority(req.issue, req.description, category)

    entry = _kb.add_document(
        issue=req.issue,
        resolution=req.resolution,
        category=category,
        priority=priority,
        description=req.description,
        source=req.source,
        extra={"ticket_id": req.ticket_id}
    )

    return {
        "success":       True,
        "total_vectors": _kb.total_vectors,
        "entry":         entry,
    }


@router.get("/api/kb/stats")
def kb_stats():
    if _kb is None:
        return {"status": "not initialised", "total_vectors": 0}

    # Count by source
    source_counts = {}
    for m in _kb.metadata:
        src = m.get("source", "csv")
        source_counts[src] = source_counts.get(src, 0) + 1

    # Recent live updates
    live_sources = {"agent_resolution", "admin_resolution", "user_confirmed"}
    recent = [
        m for m in _kb.metadata
        if m.get("source", "") in live_sources
    ][-5:]

    return {
        "status":        "ready",
        "total_vectors": _kb.total_vectors,
        "source_counts": source_counts,
        "recent_updates": [
            {
                "issue":    m["issue"][:60],
                "source":   m.get("source"),
                "added_at": m.get("added_at", "?")[:19],
                "category": m.get("category"),
                "priority": m.get("priority"),
            }
            for m in recent
        ]
    }


@router.get("/api/kb/search")
def kb_search(q: str, top_k: int = 3):
    """Debug endpoint — test retrieval without going through full chat pipeline."""
    if _kb is None:
        raise HTTPException(status_code=500, detail="KB not initialised")
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    results = _kb.search(q, top_k=top_k)
    return {
        "query":   q,
        "results": [
            {
                "rank":       i + 1,
                "similarity": r["similarity"],   # live cosine score
                "issue":      r["issue"][:80],
                "category":   r["category"],
                "priority":   r["priority"],
                "resolution": r["resolution"][:120],
            }
            for i, r in enumerate(results)
        ]
    }