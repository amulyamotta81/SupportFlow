"""
langchain_orchestrator.py (Fixed & Simplified)
-----------------------------------------------
Working LangChain orchestrator with:
- Conversational memory
- FAISS retrieval
- Simple routing
- Tool support
"""

import os
from datetime import datetime
from typing import Dict, List, Optional

from langchain_community.llms import Ollama
from langchain_openai import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain.memory import ConversationBufferMemory
from langchain.prompts import PromptTemplate
from langchain.schema import Document
from langchain.agents import initialize_agent, Tool, AgentType


class FAISSLangChainRetriever:
    """Adapter: Wraps FAISSKBManager for LangChain compatibility"""
    
    def __init__(self, kb_manager):
        self.kb = kb_manager
    
    def get_relevant_documents(self, query: str) -> List[Document]:
        """Convert FAISS results to LangChain Documents"""
        
        try:
            results = self.kb.search(query, top_k=3)
        except Exception as e:
            print(f"❌ Retrieval error: {e}")
            return []
        
        docs = []
        for r in results:
            content = f"""Issue: {r['issue']}
Category: {r['category']}
Priority: {r['priority']}
Resolution: {r['resolution']}
Similarity: {r['similarity']:.3f}"""
            
            docs.append(Document(
                page_content=content,
                metadata={
                    "issue": r['issue'],
                    "category": r['category'],
                    "priority": r['priority'],
                    "similarity": r['similarity']
                }
            ))
        
        return docs


class LangChainOrchestrator:
    """
    Simplified LangChain orchestrator for IT Support
    
    Features:
    - Q&A over FAISS knowledge base
    - Conversational memory (in-memory)
    - Simple agent with tools
    """
    
    def __init__(self, kb_manager):
        print("\n" + "="*70)
        print("🔗 INITIALIZING LANGCHAIN ORCHESTRATOR")
        print("="*70)
        
        self.kb = kb_manager
        self.retriever = FAISSLangChainRetriever(kb_manager)
        
        # Initialize LLM
        self.llm = self._init_llm()
        print(f"✅ LLM initialized")
        
        # Memory store (simple dict for now)
        self.conversations = {}
        print(f"✅ Memory store ready")
        
        print("="*70 + "\n")
    
    def _init_llm(self):
        """Initialize language model (Ollama or OpenAI)"""
        
        # Try Ollama first (local, free)
        ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        
        try:
            llm = Ollama(
                base_url=ollama_url,
                model=os.getenv("OLLAMA_MODEL", "llama3.2"),
                temperature=0.3
            )
            # Test if Ollama is reachable
            llm.invoke("test")
            print(f"✅ Using Ollama: {os.getenv('OLLAMA_MODEL', 'llama3.2')}")
            return llm
        
        except Exception as e:
            print(f"⚠️ Ollama not available: {e}")
            print(f"🔄 Falling back to OpenAI...")
            
            # Fallback to OpenAI
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("No LLM available! Install Ollama or set OPENAI_API_KEY")
            
            llm = ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0.3,
                openai_api_key=api_key
            )
            print(f"✅ Using OpenAI: gpt-4o-mini")
            return llm
    
    def _get_memory(self, conversation_id: str) -> ConversationBufferMemory:
        """Get or create conversation memory"""
        
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = ConversationBufferMemory(
                memory_key="chat_history",
                return_messages=True,
                output_key="answer"
            )
        
        return self.conversations[conversation_id]
    
    def _qa_chain(self, conversation_id: str = "default"):
        """Simple Q&A chain over FAISS KB"""
        
        prompt_template = """You are an IT support assistant. Use the following context from our knowledge base to answer the user's question.

Context from Knowledge Base:
{context}

Question: {question}

Instructions:
1. Provide a clear, step-by-step solution based on the context
2. Reference which knowledge base entry you're using
3. If the context doesn't fully answer the question, say so
4. Be concise but thorough

Answer:"""
        
        PROMPT = PromptTemplate(
            template=prompt_template,
            input_variables=["context", "question"]
        )
        
        return RetrievalQA.from_chain_type(
            llm=self.llm,
            chain_type="stuff",
            retriever=self.retriever,
            return_source_documents=True,
            chain_type_kwargs={"prompt": PROMPT}
        )
    
    def _build_tools(self) -> List[Tool]:
        """Build tools for agent"""
        
        return [
            Tool(
                name="Search_Knowledge_Base",
                func=self._search_kb_tool,
                description="Search the IT support knowledge base for similar issues and solutions. Use this for technical problems."
            ),
            Tool(
                name="Escalate_To_Agent",
                func=self._escalate_tool,
                description="Escalate the issue to a human agent. Use when: 1) No solution found in KB, 2) User explicitly requests human help, 3) Issue is too complex"
            ),
            Tool(
                name="Get_Issue_Category",
                func=self._categorize_tool,
                description="Determine the category (Network, Hardware, Software, Email, Account) and priority (Low, Medium, High) of an IT issue"
            )
        ]
    
    def _search_kb_tool(self, query: str) -> str:
        """Tool: Search knowledge base"""
        
        results = self.kb.search(query, top_k=3)
        
        if not results:
            return "No similar issues found in knowledge base."
        
        output = "Found similar issues:\n\n"
        for i, r in enumerate(results, 1):
            output += f"{i}. {r['issue']}\n"
            output += f"   Category: {r['category']} | Priority: {r['priority']}\n"
            output += f"   Solution: {r['resolution'][:200]}...\n"
            output += f"   Similarity: {r['similarity']:.0%}\n\n"
        
        return output
    
    def _escalate_tool(self, reason: str) -> str:
        """Tool: Escalate to human agent"""
        
        return f"ESCALATION REQUESTED: {reason}\nTimestamp: {datetime.now().isoformat()}\nAction: Create support ticket for human agent review."
    
    def _categorize_tool(self, issue: str) -> str:
        """Tool: Categorize issue"""
        
        # Simple keyword-based categorization
        issue_lower = issue.lower()
        
        if any(word in issue_lower for word in ['vpn', 'network', 'wifi', 'connection']):
            return "Category: Network | Priority: High"
        elif any(word in issue_lower for word in ['email', 'outlook', 'smtp']):
            return "Category: Email | Priority: High"
        elif any(word in issue_lower for word in ['printer', 'mouse', 'keyboard', 'monitor']):
            return "Category: Hardware | Priority: Medium"
        elif any(word in issue_lower for word in ['password', 'login', 'account', 'access']):
            return "Category: Account | Priority: High"
        elif any(word in issue_lower for word in ['software', 'application', 'install']):
            return "Category: Software | Priority: Medium"
        else:
            return "Category: General | Priority: Medium"
    
    def _agent_chain(self, conversation_id: str = "default"):
        """Agent with tools and memory"""
        
        tools = self._build_tools()
        memory = self._get_memory(conversation_id)
        
        return initialize_agent(
            tools=tools,
            llm=self.llm,
            agent=AgentType.CONVERSATIONAL_REACT_DESCRIPTION,
            memory=memory,
            verbose=True,
            max_iterations=3,
            handle_parsing_errors=True
        )
    
    def run(
        self,
        query: str,
        conversation_id: Optional[str] = None,
        context: str = "",
        mode: str = "auto"
    ) -> Dict:
        """
        Main entry point for LangChain processing
        
        Args:
            query: User's question
            conversation_id: Conversation ID for memory
            context: Additional context
            mode: "qa" | "agent" | "auto"
        
        Returns:
            Dict with response, sources, metadata
        """
        
        print(f"\n{'─'*70}")
        print(f"🔗 LANGCHAIN PROCESSING")
        print(f"{'─'*70}")
        print(f"💬 Query: {query}")
        print(f"🆔 Conversation: {conversation_id or 'default'}")
        print(f"🎯 Mode: {mode}")
        
        conversation_id = conversation_id or "default"
        
        try:
            # Auto-detect mode
            if mode == "auto":
                # Use agent for complex queries, QA for simple ones
                if any(word in query.lower() for word in ['escalate', 'create ticket', 'help me', 'complex']):
                    mode = "agent"
                else:
                    mode = "qa"
                
                print(f"🤖 Auto-selected mode: {mode}")
            
            # Process based on mode
            if mode == "qa":
                print(f"📚 Using Q&A chain...")
                
                chain = self._qa_chain(conversation_id)
                result = chain.invoke({"query": query})
                
                response = result.get("result", "")
                sources = result.get("source_documents", [])
                
                return {
                    "success": True,
                    "response": response,
                    "mode": "qa",
                    "conversation_id": conversation_id,
                    "sources": [
                        {
                            "issue": doc.metadata.get("issue", ""),
                            "category": doc.metadata.get("category", ""),
                            "similarity": doc.metadata.get("similarity", 0)
                        }
                        for doc in sources
                    ]
                }
            
            elif mode == "agent":
                print(f"🤖 Using agent chain...")
                
                agent = self._agent_chain(conversation_id)
                
                # Add context if provided
                full_query = f"{context}\n\n{query}" if context else query
                
                result = agent.invoke({"input": full_query})
                
                return {
                    "success": True,
                    "response": result.get("output", ""),
                    "mode": "agent",
                    "conversation_id": conversation_id,
                    "intermediate_steps": len(result.get("intermediate_steps", []))
                }
            
            else:
                raise ValueError(f"Invalid mode: {mode}")
        
        except Exception as e:
            print(f"❌ Error in LangChain: {e}")
            import traceback
            traceback.print_exc()
            
            return {
                "success": False,
                "error": str(e),
                "mode": mode,
                "conversation_id": conversation_id
            }
    
    def get_memory(self, conversation_id: str = "default") -> List[Dict]:
        """Get conversation history"""
        
        if conversation_id not in self.conversations:
            return []
        
        memory = self.conversations[conversation_id]
        history = memory.load_memory_variables({})
        
        messages = history.get("chat_history", [])
        
        return [
            {
                "role": msg.type,
                "content": msg.content
            }
            for msg in messages
        ]
    
    def clear_memory(self, conversation_id: str = "default"):
        """Clear conversation history"""
        
        if conversation_id in self.conversations:
            del self.conversations[conversation_id]
            print(f"🗑️ Cleared memory for: {conversation_id}")