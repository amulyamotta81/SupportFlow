import express from 'express';
import { authenticate } from '../middleware/auth.js';
import axios from 'axios';
import crypto from 'crypto';
import ChatHistory from '../models/ChatHistory.js';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// ── POST /api/chat/message — send message + persist to history ───────────────
router.post('/message', authenticate, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const userId = req.user._id.toString();

    // Find or create chat session using upsert to prevent race conditions
    // where two concurrent first-messages both try to create the same session
    const resolvedSessionId = sessionId || crypto.randomUUID();
    const session = await ChatHistory.findOneAndUpdate(
      { sessionId: resolvedSessionId, userId: req.user._id },
      {
        $setOnInsert: {
          userId: req.user._id,
          sessionId: resolvedSessionId,
          title: message.slice(0, 60) + (message.length > 60 ? '...' : ''),
          messages: [],
        },
      },
      { upsert: true, new: true }
    );

    // Build recent chat history for AI context (last 10 exchanges)
    const recentHistory = session.messages.slice(-20).map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Save user message to history
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Call AI service with conversation history
    const response = await axios.post(`${AI_URL}/api/chat`, {
      message,
      userId,
      chat_history: recentHistory,
    }, { timeout: 120000 });

    const aiData = response.data;

    // Save AI response to history
    session.messages.push({
      role: 'assistant',
      content: aiData.answer || aiData.response || '',
      meta: {
        category: aiData.category,
        priority: aiData.priority,
        final_confidence: aiData.final_confidence,
        similarity_score: aiData.similarity_score,
        llm_confidence: aiData.llm_confidence,
        decision: aiData.decision,
        sources: aiData.sources,
      },
      timestamp: new Date(),
    });

    session.updatedAt = new Date();
    await session.save();

    // Return AI response + sessionId so frontend can continue the session
    res.json({
      ...aiData,
      sessionId: session.sessionId,
    });
  } catch (err) {
    console.error('Chat AI error:', err.message);
    res.status(500).json({
      response: 'The IT Assistant is temporarily unavailable. Please try again or create a ticket for support.',
      confidence: 0,
      suggestedCategory: 'General',
      suggestedPriority: 'Medium',
    });
  }
});

// ── GET /api/chat/history — list all chat sessions for user ──────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
    const sessions = await ChatHistory.find({ userId: req.user._id })
      .select('sessionId title createdAt updatedAt messages')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    // Return sessions with message count and last message preview
    const result = sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title,
      messageCount: s.messages.length,
      lastMessage: s.messages.length > 0
        ? s.messages[s.messages.length - 1].content?.slice(0, 80)
        : '',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/chat/history/:sessionId — get full conversation ─────────────────
router.get('/history/:sessionId', authenticate, async (req, res) => {
  try {
    const session = await ChatHistory.findOne({
      sessionId: req.params.sessionId,
      userId: req.user._id,
    }).lean();

    if (!session) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/chat/history/:sessionId — delete a conversation ──────────────
router.delete('/history/:sessionId', authenticate, async (req, res) => {
  try {
    const result = await ChatHistory.deleteOne({
      sessionId: req.params.sessionId,
      userId: req.user._id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    res.json({ ok: true, message: 'Chat session deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/chat/history — clear all conversations for user ──────────────
router.delete('/history', authenticate, async (req, res) => {
  try {
    const result = await ChatHistory.deleteMany({ userId: req.user._id });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
