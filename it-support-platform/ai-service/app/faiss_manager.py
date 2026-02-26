"""
faiss_manager.py
----------------
Handles FAISS index loading and similarity search.
Drop-in replacement for chromadb_manager.py.
"""

import os
import pickle
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

INDEX_PATH    = os.getenv("FAISS_INDEX_PATH", "kb.faiss")
METADATA_PATH = os.getenv("FAISS_META_PATH",  "kb_metadata.pkl")
MODEL_NAME    = "all-MiniLM-L6-v2"


class FAISSKBManager:
    def __init__(self):
        self.model    = SentenceTransformer(MODEL_NAME)
        self.index    = None
        self.metadata = []

    def load(self):
        if not os.path.exists(INDEX_PATH) or not os.path.exists(METADATA_PATH):
            raise FileNotFoundError(
                "FAISS index not found. Run `python build_kb.py` first."
            )
        self.index = faiss.read_index(INDEX_PATH)
        with open(METADATA_PATH, "rb") as f:
            self.metadata = pickle.load(f)
        print(f"[FAISSKBManager] Loaded {self.index.ntotal} vectors.")

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        """
        Returns top_k matches. Each result dict:
        {
            issue, category, priority, resolution,
            success_rate, ticket_count,
            similarity   # cosine 0-1
        }
        """
        vec = self.model.encode([query], convert_to_numpy=True)
        faiss.normalize_L2(vec)

        scores, indices = self.index.search(vec, top_k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx == -1:
                continue
            row = dict(self.metadata[idx])
            row["similarity"] = float(score)   # cosine similarity
            results.append(row)

        return results