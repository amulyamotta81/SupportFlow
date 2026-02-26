import express from 'express';
import { authenticate } from '../middleware/auth.js';
import axios from 'axios';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

router.post('/message', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    const response = await axios.post(`${AI_URL}/api/chat`, {
      message,
      userId: req.user._id.toString()
    }, { timeout: 120000 }); // 120s — Ollama local LLM needs time
    res.json(response.data);
  } catch (err) {
    console.error('Chat AI error:', err.message);
    res.status(500).json({
      response: 'The IT Assistant is temporarily unavailable. Please try again or create a ticket for support.',
      confidence: 0,
      suggestedCategory: 'General',
      suggestedPriority: 'Medium'
    });
  }
});

export default router;