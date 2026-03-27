/**
 * langchainService.js
 * -------------------
 * Service to interact with Python AI service's LangChain endpoints.
 * Provides interfaces for different chain types and memory management.
 */

import axios from 'axios';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

class LangChainService {
  /**
   * Query using simple QA chain
   * @param {string} query - User's support question
   * @returns {Promise<{response: string, similarity: number}>}
   */
  static async askQA(query) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/api/langchain/ask`, {
        query,
        chain_type: 'qa'
      });
      return response.data;
    } catch (error) {
      console.error('LangChain QA error:', error.message);
      throw new Error(`QA query failed: ${error.message}`);
    }
  }

  /**
   * Query using conversational chain (with memory)
   * @param {string} query - User's question
   * @param {string} conversationId - Unique conversation ID
   * @returns {Promise<{response: string, conversationId: string}>}
   */
  static async askConversational(query, conversationId) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/api/langchain/ask`, {
        query,
        conversation_id: conversationId,
        chain_type: 'conversational'
      });
      return response.data;
    } catch (error) {
      console.error('LangChain conversational error:', error.message);
      throw new Error(`Conversational query failed: ${error.message}`);
    }
  }

  /**
   * Query using agentic chain (with reasoning and tools)
   * @param {string} query - User's question
   * @param {string} context - Additional context (ticket info, etc.)
   * @returns {Promise<{response: string, reasoning: boolean}>}
   */
  static async askAgent(query, context = '') {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/api/langchain/ask`, {
        query,
        context,
        chain_type: 'agent'
      });
      return response.data;
    } catch (error) {
      console.error('LangChain agent error:', error.message);
      throw new Error(`Agent query failed: ${error.message}`);
    }
  }

  /**
   * Get conversation memory summary
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<{memory: string}>}
   */
  static async getMemory(conversationId) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/api/langchain/memory`, {
        conversation_id: conversationId
      });
      return response.data;
    } catch (error) {
      console.error('LangChain memory error:', error.message);
      throw new Error(`Memory retrieval failed: ${error.message}`);
    }
  }

  /**
   * Clear conversation memory
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<{success: boolean}>}
   */
  static async clearMemory(conversationId) {
    try {
      const response = await axios.post(`${AI_SERVICE_URL}/api/langchain/memory/clear`, {
        conversation_id: conversationId
      });
      return response.data;
    } catch (error) {
      console.error('LangChain memory clear error:', error.message);
      throw new Error(`Memory clear failed: ${error.message}`);
    }
  }

  /**
   * Intelligent routing - choose the best chain based on query complexity
   * @param {string} query - User's question
   * @param {string} conversationId - Conversation ID
   * @param {Object} context - Ticket/customer context
   * @returns {Promise<{response: string, chainUsed: string}>}
   */
  static async askIntelligent(query, conversationId, context = {}) {
    // Simple heuristic to choose chain type
    const complexity = this._estimateComplexity(query);
    const hasContext = Object.keys(context).length > 0;

    let chainType = 'qa';
    if (complexity === 'high' && hasContext) {
      chainType = 'agent';
    } else if (conversationId && complexity === 'medium') {
      chainType = 'conversational';
    }

    try {
      const response = await axios.post(`${AI_SERVICE_URL}/api/langchain/ask`, {
        query,
        conversation_id: conversationId,
        context: JSON.stringify(context),
        chain_type: chainType
      });

      return {
        ...response.data,
        chainUsed: chainType
      };
    } catch (error) {
      console.error('LangChain intelligent error:', error.message);
      throw new Error(`Intelligent query failed: ${error.message}`);
    }
  }

  /**
   * Estimate query complexity
   * @private
   */
  static _estimateComplexity(query) {
    const lowComplexityKeywords = ['how', 'what', 'where', 'when', 'why'];
    const highComplexityKeywords = ['diagnose', 'debug', 'fix', 'troubleshoot', 'escalate', 'urgent'];

    const queryLower = query.toLowerCase();
    const hasHighComplexity = highComplexityKeywords.some(kw => queryLower.includes(kw));
    const hasLowComplexity = lowComplexityKeywords.some(kw => queryLower.includes(kw));

    if (hasHighComplexity) return 'high';
    if (hasLowComplexity) return 'low';
    return 'medium';
  }
}

export default LangChainService;