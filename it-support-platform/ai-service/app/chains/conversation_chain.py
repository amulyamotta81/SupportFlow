"""
conversation_chain.py
---------------------
LangChain Conversation Memory Manager.

Maintains per-user conversation history using LangChain's
ChatMessageHistory. This allows the LLM to reference prior
messages in the same chat session for contextual follow-ups.

Memory is stored in-memory (dict keyed by userId). The backend
(Node.js) persists full history to MongoDB — this module handles
the active session memory for the AI service.
"""

from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.chat_history import BaseChatMessageHistory


class ConversationManager:
    """
    Manages per-user conversation histories using LangChain.

    Each user gets their own ChatMessageHistory instance.
    The conversation context is passed to the GenerationChain
    so the LLM can reference prior exchanges.

    Usage:
        conv = ConversationManager()
        conv.add_user_message("user123", "My VPN is not working")
        conv.add_ai_message("user123", "Try resetting your VPN adapter...")
        history = conv.get_langchain_history("user123")
        # Pass history to GenerationChain as chat_history
    """

    def __init__(self, max_history_per_user: int = 20):
        """
        Args:
            max_history_per_user: Max messages to keep per user session.
                Older messages are dropped to keep context window manageable.
        """
        self._histories: dict[str, ChatMessageHistory] = {}
        self._max_history = max_history_per_user
        print(f"[ConversationManager] Initialized (max {max_history_per_user} messages/user)")

    def _get_or_create(self, user_id: str) -> ChatMessageHistory:
        """Get or create a ChatMessageHistory for a user."""
        if user_id not in self._histories:
            self._histories[user_id] = ChatMessageHistory()
        return self._histories[user_id]

    def add_user_message(self, user_id: str, content: str):
        """Add a user message to the conversation history."""
        history = self._get_or_create(user_id)
        history.add_user_message(content)
        self._trim(user_id)

    def add_ai_message(self, user_id: str, content: str):
        """Add an AI response to the conversation history."""
        history = self._get_or_create(user_id)
        history.add_ai_message(content)
        self._trim(user_id)

    def get_langchain_history(self, user_id: str) -> list:
        """
        Get the LangChain message objects for a user.
        Returns list of HumanMessage / AIMessage objects
        ready to pass into the GenerationChain's chat_history.
        """
        history = self._get_or_create(user_id)
        return history.messages

    def get_history_dicts(self, user_id: str) -> list[dict]:
        """
        Get conversation history as plain dicts.
        Returns: [{"role": "user"|"assistant", "content": str}, ...]
        """
        messages = self.get_langchain_history(user_id)
        result = []
        for msg in messages:
            if isinstance(msg, HumanMessage):
                result.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                result.append({"role": "assistant", "content": msg.content})
        return result

    def load_history_from_dicts(self, user_id: str, messages: list[dict]):
        """
        Load conversation history from a list of dicts (from MongoDB).
        Used to restore session state from the backend.

        Args:
            messages: [{"role": "user"|"assistant", "content": str}, ...]
        """
        history = ChatMessageHistory()
        for msg in (messages or []):
            if msg.get("role") == "user":
                history.add_user_message(msg.get("content", ""))
            elif msg.get("role") == "assistant":
                history.add_ai_message(msg.get("content", ""))

        self._histories[user_id] = history
        self._trim(user_id)

    def clear_history(self, user_id: str):
        """Clear conversation history for a user (new chat session)."""
        if user_id in self._histories:
            self._histories[user_id].clear()
            print(f"[ConversationManager] Cleared history for user {user_id}")

    def clear_all(self):
        """Clear all conversation histories."""
        self._histories.clear()
        print("[ConversationManager] All histories cleared")

    def _trim(self, user_id: str):
        """Trim history to max_history_per_user messages."""
        history = self._histories.get(user_id)
        if history and len(history.messages) > self._max_history:
            # Keep the most recent messages
            history.messages = history.messages[-self._max_history:]

    def get_session_info(self, user_id: str) -> dict:
        """Get info about a user's session."""
        history = self._histories.get(user_id)
        if not history:
            return {"user_id": user_id, "message_count": 0, "active": False}
        return {
            "user_id": user_id,
            "message_count": len(history.messages),
            "active": True,
        }

    @property
    def active_sessions(self) -> int:
        """Number of active user sessions."""
        return len(self._histories)
