"""
faiss_manager.py
----------------
FAISS vector store wrapper.

Key design decisions:
- Similarity score = cosine similarity computed LIVE at query time
- No success_rate stored — confidence computed in main.py from live signals
- Metadata contains only: issue, resolution, description, category, priority, source
- reload() method for hot-reload after live KB updates
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
        self._model:    SentenceTransformer = None
        self.index:     faiss.Index         = None
        self.metadata:  list[dict]          = []

    @property
    def model(self) -> SentenceTransformer:
        """Lazy-load model on first use."""
        if self._model is None:
            print(f"[FAISS] Loading embedding model: {MODEL_NAME}")
            self._model = SentenceTransformer(MODEL_NAME)
        return self._model

    def load(self):
        if not os.path.exists(INDEX_PATH):
            raise FileNotFoundError(
                f"FAISS index not found at '{INDEX_PATH}'. Run build_kb.py first."
            )
        if not os.path.exists(METADATA_PATH):
            raise FileNotFoundError(
                f"Metadata not found at '{METADATA_PATH}'. Run build_kb.py first."
            )
        self.index = faiss.read_index(INDEX_PATH)
        with open(METADATA_PATH, "rb") as f:
            self.metadata = pickle.load(f)
        print(f"[FAISS] Loaded {self.index.ntotal} vectors, {len(self.metadata)} metadata entries.")

    def reload(self):
        """Hot-reload index and metadata after a live KB update."""
        self.load()
        print("[FAISS] Hot-reloaded KB.")

    def embed_query(self, query: str) -> np.ndarray:
        """Embed and L2-normalise a query string."""
        vec = self.model.encode([query], convert_to_numpy=True).astype("float32")
        faiss.normalize_L2(vec)
        return vec

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        """
        Search KB and return top_k results.

        Similarity score = cosine similarity (0.0 - 1.0), computed live.
        NOT read from CSV, NOT stored — always freshly computed per query.

        Each result dict:
        {
            issue, resolution, description, category, priority, source,
            similarity   ← LIVE cosine score, 0-1
        }
        """
        if self.index is None:
            raise RuntimeError("KB not loaded. Call load() first.")

        vec = self.embed_query(query)
        scores, indices = self.index.search(vec, min(top_k, self.index.ntotal))

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx == -1 or idx >= len(self.metadata):
                continue
            entry = dict(self.metadata[idx])
            # Cosine similarity — computed NOW from the live query vector
            # IndexFlatIP with L2-normalised vectors = exact cosine similarity
            entry["similarity"] = round(float(score), 4)
            results.append(entry)

        # Sort by similarity descending (FAISS already does this but be explicit)
        results.sort(key=lambda r: r["similarity"], reverse=True)
        return results

    def add_document(self, issue: str, resolution: str, category: str,
                     priority: str, description: str = "", source: str = "live_update",
                     extra: dict = None) -> dict:
        """
        Add a single new document to the live index.
        Used by kb_manager.py for agent/admin/user-confirmed updates.
        """
        from datetime import datetime

        text = f"{issue} | {description} | {resolution}".strip(" |")
        vec  = self.model.encode([text])[0].astype("float32")
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        vec = vec.reshape(1, -1)

        self.index.add(vec)
        faiss.write_index(self.index, INDEX_PATH)

        new_entry = {
            "issue":       issue.strip(),
            "resolution":  resolution.strip(),
            "description": description.strip(),
            "category":    category,
            "priority":    priority,
            "source":      source,
            "added_at":    datetime.utcnow().isoformat(),
            **(extra or {})
        }
        self.metadata.append(new_entry)

        with open(METADATA_PATH, "wb") as f:
            pickle.dump(self.metadata, f)

        print(f"[FAISS] Added document. Total: {self.index.ntotal} vectors.")
        return new_entry

    @property
    def total_vectors(self) -> int:
        return self.index.ntotal if self.index else 0