"""
build_kb.py
-----------
Loads the IT support CSV, generates embeddings using sentence-transformers,
and saves a FAISS index + metadata for fast retrieval.

Run once (or whenever your CSV changes):
    python build_kb.py
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
import faiss
from sentence_transformers import SentenceTransformer

# ── Config ────────────────────────────────────────────────────────────────────
CSV_PATH      = os.getenv("KB_CSV_PATH", "../../data/it_support_ticket.csv")
INDEX_PATH    = "kb.faiss"
METADATA_PATH = "kb_metadata.pkl"
MODEL_NAME    = "all-MiniLM-L6-v2"
# ──────────────────────────────────────────────────────────────────────────────


def build_kb(csv_path: str = CSV_PATH):
    print(f"[build_kb] Loading CSV from: {csv_path}")
    df = pd.read_csv(csv_path)

    # Normalise column names (lowercase, strip spaces)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    required = {"issue", "category", "priority", "resolution", "success_rate"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing columns: {missing}\nFound: {list(df.columns)}")

    df = df.dropna(subset=["issue", "resolution"])
    df["success_rate"] = pd.to_numeric(df["success_rate"], errors="coerce").fillna(0.5)
    df["ticket_count"] = pd.to_numeric(df.get("ticket_count", pd.Series([1]*len(df))), errors="coerce").fillna(1)

    print(f"[build_kb] {len(df)} records loaded.")

    # Build text to embed: combine issue + resolution for richer semantic match
    texts = (
        "Issue: " + df["issue"].astype(str) +
        " | Category: " + df["category"].astype(str) +
        " | Resolution: " + df["resolution"].astype(str)
    ).tolist()

    print(f"[build_kb] Encoding with {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)
    embeddings = model.encode(texts, show_progress_bar=True, convert_to_numpy=True)

    # Normalise for cosine similarity via inner product
    faiss.normalize_L2(embeddings)

    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)   # Inner Product == cosine after L2-norm
    index.add(embeddings)

    faiss.write_index(index, INDEX_PATH)
    print(f"[build_kb] FAISS index saved → {INDEX_PATH}")

    # Save metadata so we can look up results by row index
    metadata = df[["issue", "category", "priority", "resolution", "success_rate", "ticket_count"]].to_dict(orient="records")
    with open(METADATA_PATH, "wb") as f:
        pickle.dump(metadata, f)
    print(f"[build_kb] Metadata saved → {METADATA_PATH}")

    print("[build_kb] ✅ Knowledge base built successfully!")


if __name__ == "__main__":
    build_kb()