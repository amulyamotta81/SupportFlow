"""
generation_chain.py
-------------------
LangChain Generation Chain using Ollama LLM.

Constructs a prompt combining:
  - System instructions (IT support expert role)
  - Retrieved FAISS context (similar past tickets)
  - User query
  - Conversation history (if available)

Sends to Ollama (llama 3.2) and parses:
  - Root Cause
  - Resolution Steps
  - Confidence score
"""

import os
import re
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableLambda, RunnableParallel
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from dotenv import load_dotenv

load_dotenv()

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_TEMPLATE = """You are an expert IT support assistant.
You will be given a user's IT problem and relevant knowledge base articles retrieved from past resolved tickets.

Your response must include:
1. Root Cause: one sentence explaining the likely cause.
2. Fix Steps: clear numbered steps the user can follow.
3. On the very last line, output ONLY this - nothing else after it:
   CONFIDENCE: <a decimal between 0 and 1>

Base your confidence on how well the KB context matches the query.
Be concise and do not invent steps not supported by the context."""

# ── Chat prompt with history support ─────────────────────────────────────────

CHAT_PROMPT = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_TEMPLATE),
    MessagesPlaceholder(variable_name="chat_history", optional=True),
    ("human", """User Query: {query}

Knowledge Base Context:
{context}

Provide your answer, then end with CONFIDENCE: <score>"""),
])


class GenerationChain:
    """
    LangChain Generation Chain wrapping Ollama (llama 3.2).

    Usage:
        gen = GenerationChain()
        answer, confidence = gen.generate(
            query="VPN keeps disconnecting",
            context="Issue: VPN drops... Resolution: Reset adapter...",
            chat_history=[]
        )
    """

    def __init__(self):
        print(f"[GenerationChain] Initializing Ollama LLM ({OLLAMA_MODEL})...")

        self.llm = ChatOllama(
            base_url=OLLAMA_URL,
            model=OLLAMA_MODEL,
            temperature=0.2,
            num_predict=600,
            timeout=12000,
        )

        # Build the LangChain chain: prompt -> LLM -> parse
        self.chain = (
            CHAT_PROMPT
            | self.llm
            | StrOutputParser()
            | RunnableLambda(self._parse_response)
        )

        print("[GenerationChain] Ready.")

    def _parse_response(self, text: str) -> dict:
        """Parse LLM output into answer text + confidence score."""
        conf = 0.7  # safe default
        match = re.search(r"CONFIDENCE:\s*([0-9.]+)", text, re.IGNORECASE)
        if match:
            try:
                conf = float(match.group(1))
                conf = max(0.0, min(1.0, conf))
            except ValueError:
                pass

        answer = re.sub(
            r"\n?CONFIDENCE:\s*[0-9.]+", "", text, flags=re.IGNORECASE
        ).strip()

        return {"answer": answer, "llm_confidence": conf}

    def generate(
        self,
        query: str,
        context: str,
        chat_history: list = None,
    ) -> tuple[str, float]:
        """
        Generate an LLM response with RAG context.

        Args:
            query: User's IT issue query
            context: Retrieved KB context from RetrievalChain
            chat_history: List of LangChain message objects for conversation memory

        Returns:
            (answer_text, llm_confidence)
        """
        try:
            result = self.chain.invoke({
                "query": query,
                "context": context or "No relevant knowledge base entries found.",
                "chat_history": chat_history or [],
            })
            return result["answer"], result["llm_confidence"]
        except Exception as e:
            print(f"[GenerationChain] LLM error: {e}")
            raise RuntimeError(f"Ollama error: {e}")

    def generate_with_history(
        self,
        query: str,
        context: str,
        history_messages: list[dict],
    ) -> tuple[str, float]:
        """
        Generate response with conversation history from stored messages.

        Args:
            history_messages: List of {"role": "user"|"assistant", "content": str}
        """
        chat_history = []
        for msg in (history_messages or []):
            if msg["role"] == "user":
                chat_history.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                chat_history.append(AIMessage(content=msg["content"]))

        return self.generate(query, context, chat_history)
