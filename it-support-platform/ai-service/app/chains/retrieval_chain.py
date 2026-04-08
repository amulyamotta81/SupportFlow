"""
retrieval_chain.py
------------------
LangChain Retrieval Chain using FAISS vector store.

Handles:
  - Loading / building the FAISS knowledge base via LangChain
  - Semantic similarity search (top-k retrieval)
  - Dynamic KB updates when tickets are resolved
  - KB rebuilding from ticket data

Uses LangChain's FAISS wrapper + HuggingFaceEmbeddings so the entire
retrieval pipeline is a proper LangChain Retriever.
"""

import os
import pickle
from typing import Optional

from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_core.runnables import RunnablePassthrough, RunnableLambda

INDEX_DIR      = os.getenv("FAISS_INDEX_DIR", ".")
INDEX_PATH     = os.path.join(INDEX_DIR, os.getenv("FAISS_INDEX_NAME", "kb_langchain"))
LEGACY_INDEX   = os.getenv("FAISS_INDEX_PATH", "kb.faiss")
LEGACY_META    = os.getenv("FAISS_META_PATH", "kb_metadata.pkl")
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


class RetrievalChain:
    """
    LangChain-based retrieval chain wrapping FAISS vector store.

    The knowledge base stores resolved ticket resolutions as Documents.
    Each document's page_content is the rich embedding text:
        [ISSUE] ...  [CAUSE] ...  [CATEGORY] ...  [RESOLUTION] ...

    Metadata per document:
        issue, resolution, category, priority, success_rate, ticket_count, source
    """

    def __init__(self):
        print("[RetrievalChain] Loading HuggingFace embeddings...")
        self.embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        self.vectorstore: Optional[FAISS] = None
        self.retriever = None
        print("[RetrievalChain] Embeddings ready.")

    # ── Load ──────────────────────────────────────────────────────────────────

    def load(self):
        """
        Load the FAISS index. Tries LangChain format first,
        then falls back to legacy raw FAISS + metadata pickle.
        """
        # Try LangChain-native FAISS index
        if os.path.exists(f"{INDEX_PATH}.faiss") or os.path.exists(os.path.join(INDEX_PATH, "index.faiss")):
            print(f"[RetrievalChain] Loading LangChain FAISS from {INDEX_PATH}")
            self.vectorstore = FAISS.load_local(
                INDEX_PATH, self.embeddings,
                allow_dangerous_deserialization=True,
            )
        # Fall back to legacy raw FAISS index
        elif os.path.exists(LEGACY_INDEX) and os.path.exists(LEGACY_META):
            print("[RetrievalChain] Migrating legacy FAISS index to LangChain format...")
            self._migrate_legacy_index()
        else:
            print("[RetrievalChain] No existing KB found. Creating empty vector store.")
            self.vectorstore = FAISS.from_documents(
                [Document(page_content="IT Support Knowledge Base initialized.", metadata={"type": "system"})],
                self.embeddings,
            )

        self.retriever = self.vectorstore.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 3},
        )

        total = self.vectorstore.index.ntotal
        print(f"[RetrievalChain] KB loaded: {total} vectors")

        # Build the retrieval chain as a LangChain Runnable
        self.chain = (
            RunnablePassthrough()
            | RunnableLambda(self._retrieve)
        )

    def _migrate_legacy_index(self):
        """Convert legacy raw FAISS + pickle metadata to LangChain FAISS format."""
        import faiss as faiss_lib

        index = faiss_lib.read_index(LEGACY_INDEX)
        with open(LEGACY_META, "rb") as f:
            metadata_list = pickle.load(f)

        documents = []
        for meta in metadata_list:
            # Build rich text like build_kb.py does
            issue = meta.get("issue", "")
            resolution = meta.get("resolution", "")
            root_cause = meta.get("root_cause", "")
            category = meta.get("category", "General")
            sub_category = meta.get("sub_category", "")

            page_content = f"[ISSUE] {issue}"
            if root_cause:
                page_content += f"\n[CAUSE] {root_cause}"
            page_content += f"\n[CATEGORY] {category}"
            if sub_category:
                page_content += f" > {sub_category}"
            page_content += f"\n[RESOLUTION] {resolution}"

            doc_meta = {
                "issue": issue,
                "resolution": resolution,
                "category": category,
                "priority": meta.get("priority", "Medium"),
                "success_rate": meta.get("success_rate", 0.75),
                "ticket_count": meta.get("ticket_count", 1),
                "source": "legacy_migration",
            }
            documents.append(Document(page_content=page_content, metadata=doc_meta))

        if documents:
            self.vectorstore = FAISS.from_documents(documents, self.embeddings)
            self.save()
            print(f"[RetrievalChain] Migrated {len(documents)} legacy vectors to LangChain FAISS.")
        else:
            self.vectorstore = FAISS.from_documents(
                [Document(page_content="IT Support KB initialized.", metadata={"type": "system"})],
                self.embeddings,
            )

    # ── Save ──────────────────────────────────────────────────────────────────

    def save(self):
        """Persist the LangChain FAISS index to disk."""
        if self.vectorstore:
            self.vectorstore.save_local(INDEX_PATH)
            print(f"[RetrievalChain] KB saved to {INDEX_PATH}")

    # ── Retrieve ──────────────────────────────────────────────────────────────

    def _retrieve(self, inputs: dict) -> dict:
        """
        Retrieve top-k similar documents for a query.
        Returns enriched results with similarity scores.
        """
        query = inputs.get("query", "")
        top_k = inputs.get("top_k", 3)

        if not self.vectorstore or not query:
            return {"results": [], "context": ""}

        # Use similarity_search_with_score for cosine similarity scores
        docs_with_scores = self.vectorstore.similarity_search_with_score(query, k=top_k)

        results = []
        context_parts = []
        for doc, score in docs_with_scores:
            # Skip system/init documents
            if doc.metadata.get("type") == "system":
                continue

            # FAISS returns L2 distance; convert to similarity (0-1)
            # For normalized vectors, similarity = 1 - (distance / 2)
            similarity = max(0.0, min(1.0, 1.0 - (score / 2.0)))

            result = {
                "issue": str(doc.metadata.get("issue", "N/A")),
                "category": str(doc.metadata.get("category", "General")),
                "priority": str(doc.metadata.get("priority", "Medium")),
                "resolution": str(doc.metadata.get("resolution", "No resolution available")),
                "success_rate": float(doc.metadata.get("success_rate", 0.75)),
                "ticket_count": int(doc.metadata.get("ticket_count", 1)),
                "similarity": float(round(similarity, 3)),
            }
            results.append(result)

            # Build context string for LLM
            context_parts.append(
                f"Issue: {result['issue']}\n"
                f"Category: {result['category']} | Priority: {result['priority']}\n"
                f"Resolution: {result['resolution']}\n"
                f"Historical Success Rate: {result['success_rate']*100:.0f}%"
            )

        context = "\n\n---\n\n".join(context_parts)
        return {"results": results, "context": context}

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        """Convenience method: search and return list of result dicts."""
        output = self.chain.invoke({"query": query, "top_k": top_k})
        return output.get("results", [])

    def get_context(self, query: str, top_k: int = 3) -> str:
        """Get formatted context string for the generation chain."""
        output = self.chain.invoke({"query": query, "top_k": top_k})
        return output.get("context", "")

    def get_retriever(self):
        """Return the LangChain retriever for use in other chains."""
        return self.retriever

    # ── KB Management ─────────────────────────────────────────────────────────

    def add_to_kb(
        self,
        issue: str,
        resolution: str,
        category: str = "General",
        priority: str = "Medium",
        root_cause: str = "",
        source: str = "dynamic",
        ticket_id: str = "",
    ) -> bool:
        """
        Add a resolved ticket to the knowledge base.
        Called when a ticket is resolved (agent/admin solution confirmed).
        The KB grows dynamically so future queries benefit from past solutions.
        """
        if not issue or not resolution:
            return False

        page_content = f"[ISSUE] {issue}"
        if root_cause:
            page_content += f"\n[CAUSE] {root_cause}"
        page_content += f"\n[CATEGORY] {category}"
        page_content += f"\n[RESOLUTION] {resolution}"

        metadata = {
            "issue": issue,
            "resolution": resolution,
            "category": category,
            "priority": priority,
            "success_rate": 0.85,
            "ticket_count": 1,
            "source": source,
            "ticket_id": ticket_id,
        }

        doc = Document(page_content=page_content, metadata=metadata)
        self.vectorstore.add_documents([doc])
        self.save()

        print(f"[RetrievalChain] Added to KB: {ticket_id or issue[:50]}")
        return True

    def rebuild_kb(self, tickets: list[dict]) -> int:
        """
        Rebuild the entire KB from a list of ticket dicts.
        Each ticket dict should have: issue, resolution, category (optional), priority (optional)
        Used by admin sync endpoint.
        """
        documents = []
        for t in tickets:
            issue = t.get("issue", "")
            resolution = t.get("resolution", "")
            if not issue or not resolution:
                continue

            category = t.get("category", "General")
            priority = t.get("priority", "Medium")
            root_cause = t.get("root_cause", "")

            page_content = f"[ISSUE] {issue}"
            if root_cause:
                page_content += f"\n[CAUSE] {root_cause}"
            page_content += f"\n[CATEGORY] {category}"
            page_content += f"\n[RESOLUTION] {resolution}"

            metadata = {
                "issue": issue,
                "resolution": resolution,
                "category": category,
                "priority": priority,
                "success_rate": t.get("success_rate", 0.75),
                "ticket_count": 1,
                "source": "admin_sync",
            }
            documents.append(Document(page_content=page_content, metadata=metadata))

        if not documents:
            return 0

        # Rebuild from scratch
        self.vectorstore = FAISS.from_documents(documents, self.embeddings)
        self.retriever = self.vectorstore.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 3},
        )
        self.save()

        print(f"[RetrievalChain] KB rebuilt with {len(documents)} documents")
        return len(documents)

    @property
    def vector_count(self) -> int:
        """Number of vectors in the FAISS index."""
        if self.vectorstore and self.vectorstore.index:
            return self.vectorstore.index.ntotal
        return 0
