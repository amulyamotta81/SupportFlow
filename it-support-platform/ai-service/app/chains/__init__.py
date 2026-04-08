"""
LangChain Chains for IT Support Platform
-----------------------------------------
1. ClassificationChain  - DistilBERT-based ticket classification
2. RetrievalChain       - FAISS RAG retrieval + KB management
3. GenerationChain      - Ollama LLM response generation
4. ConversationChain    - Per-user conversation memory
"""

from chains.classification_chain import ClassificationChain
from chains.retrieval_chain import RetrievalChain
from chains.generation_chain import GenerationChain
from chains.conversation_chain import ConversationManager

__all__ = [
    "ClassificationChain",
    "RetrievalChain",
    "GenerationChain",
    "ConversationManager",
]
