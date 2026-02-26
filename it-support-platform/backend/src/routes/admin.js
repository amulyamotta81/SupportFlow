import express from 'express';
import axios from 'axios';
import Ticket from '../models/Ticket.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

router.post('/sync-ai', authenticate, authorize('admin'), async (req, res) => {
  try {
    const resolved = await Ticket.find({ status: 'Resolved', resolution: { $exists: true, $ne: '' } })
      .select('issue category resolution')
      .sort({ resolvedAt: -1 })
      .limit(500)
      .lean();

    const tickets = resolved.map((t) => ({
      issue: t.issue,
      category: t.category || 'General',
      resolution: t.resolution || 'N/A',
    }));

    if (tickets.length === 0) {
      return res.json({ ok: false, message: 'No resolved tickets to sync' });
    }

    const { data } = await axios.post(`${AI_URL}/api/rebuild-knowledge`, { tickets }, { timeout: 60000 });
    res.json({ ok: data.ok, count: data.count, message: `Synced ${data.count} tickets to AI` });
  } catch (err) {
    console.error('AI sync error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
