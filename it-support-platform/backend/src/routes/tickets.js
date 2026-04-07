import express from 'express';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import { authenticate, authorize } from '../middleware/auth.js';
import axios from 'axios';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

const callAI = async (endpoint, data, timeout = 10000) => {
  try {
    const res = await axios.post(`${AI_URL}${endpoint}`, data, { timeout });
    return res.data;
  } catch (err) {
    console.error('AI service error:', err.message);
    return null;
  }
};

const fetchSimilarTicketsFromDB = async (issue, category, limit = 5) => {
  const baseQuery = { status: 'Resolved', resolution: { $exists: true, $ne: '' } };
  const query = category && category !== 'General' ? { ...baseQuery, category } : baseQuery;
  let candidates = await Ticket.find(query)
    .select('ticketId issue resolution resolvedAt')
    .sort({ resolvedAt: -1 })
    .limit(limit * 2)
    .lean();
  if (!candidates.length)
    candidates = await Ticket.find(baseQuery)
      .select('ticketId issue resolution resolvedAt')
      .sort({ resolvedAt: -1 }).limit(limit).lean();
  return candidates.slice(0, limit).map((t, i) => ({
    ticketId: t.ticketId, issue: t.issue,
    solution: t.resolution || 'N/A',
    similarity: Math.max(0.7, 0.95 - i * 0.05)
  }));
};

// ── GET /api/tickets ──────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const query = {};
    if (req.user.role === 'employee') query.userId = req.user._id;
    if (req.user.role === 'agent')    query.assignedAgentId = req.user._id;
    const tickets = await Ticket.find(query)
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills')
      .populate('agentSolution.submittedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/tickets/all (admin) ──────────────────────────────────────────────
router.get('/all', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tickets = await Ticket.find()
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills workload')
      .populate('agentSolution.submittedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/tickets/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills workload successRate')
      .populate('agentSolution.submittedBy', 'name role');
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (req.user.role === 'employee' && ticket.userId._id.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'Access denied' });
    res.json(ticket);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/tickets — create ────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { issue, category, priority, attachmentUrl, aiAnalysis: clientAiAnalysis } = req.body;
    const agents = await User.find({ role: 'agent' }).select('_id skills workload').sort({ workload: 1 }).lean();
    const aiResult = await callAI('/api/analyze', {
      issue, agents: agents.map(a => ({ id: a._id.toString(), skills: a.skills || [] }))
    });
    const resolvedCategory = category || aiResult?.category || 'General';
    const resolvedPriority = priority || aiResult?.priority || 'Medium';
    const similarTickets   = await fetchSimilarTicketsFromDB(issue, resolvedCategory, 5);
    const aiAnalysis = clientAiAnalysis
      ? { ...clientAiAnalysis, similarTickets }
      : { ...(aiResult || {}), similarTickets };

    const count    = await Ticket.countDocuments();
    const ticketId = `TKT-${String(count + 1).padStart(5, '0')}`;
    const ticket   = await Ticket.create({
      ticketId, userId: req.user._id, issue,
      category: resolvedCategory, priority: resolvedPriority,
      attachmentUrl, aiAnalysis,
      slaDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    const agent = aiResult?.bestAgent
      ? await User.findOne({ _id: aiResult.bestAgent, role: 'agent' })
      : await User.findOne({ role: 'agent' }).sort({ workload: 1 });
    if (agent) {
      ticket.assignedAgentId = agent._id;
      await User.updateOne({ _id: agent._id }, { $inc: { workload: 1 } });
      await ticket.save();
    }

    const populated = await Ticket.findById(ticket._id)
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills');
    res.status(201).json(populated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/tickets/:id — status / notes / reassign ───────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (req.user.role === 'employee' && ticket.userId.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'Access denied' });

    const { status, resolution, internalNotes, assignedAgentId } = req.body;

    if (status) {
      const prev = ticket.status;
      ticket.status = status;
      if (status === 'Resolved') {
        ticket.resolvedAt = new Date();
        if (resolution) ticket.resolution = resolution;
        if (ticket.assignedAgentId)
          await User.updateOne({ _id: ticket.assignedAgentId }, { $inc: { workload: -1 } });
      } else if (prev === 'Resolved' && status !== 'Resolved') {
        if (ticket.assignedAgentId)
          await User.updateOne({ _id: ticket.assignedAgentId }, { $inc: { workload: 1 } });
        ticket.resolvedAt = undefined;
      }
    }

    if (resolution && !status) ticket.resolution = resolution;
    if (internalNotes) {
      ticket.internalNotes = ticket.internalNotes || [];
      ticket.internalNotes.push({ userId: req.user._id, text: internalNotes, createdAt: new Date() });
    }
    if (assignedAgentId && req.user.role === 'admin') {
      if (ticket.assignedAgentId)
        await User.updateOne({ _id: ticket.assignedAgentId }, { $inc: { workload: -1 } });
      ticket.assignedAgentId = assignedAgentId;
      await User.updateOne({ _id: assignedAgentId }, { $inc: { workload: 1 } });
    }

    ticket.updatedAt = new Date();
    await ticket.save();

    const updated = await Ticket.findById(ticket._id)
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills workload successRate')
      .populate('agentSolution.submittedBy', 'name role');

    // KB update when admin/agent resolves with resolution text
    if (status === 'Resolved' && resolution && ['admin', 'agent'].includes(req.user.role)) {
      callAI('/api/kb/add', {
        issue: ticket.issue, resolution,
        category: ticket.category || '', priority: ticket.priority || '',
        source: req.user.role === 'admin' ? 'admin_resolution' : 'agent_resolution',
        ticket_id: ticket.ticketId,
      }, 15000)
        .then(() => console.log(`✅ KB updated: ${ticket.ticketId}`))
        .catch(e  => console.error(`⚠️  KB failed: ${e.message}`));
    }

    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/tickets/:id/solution ───────────────────────────────────────────
// Agent or admin submits resolution notes → displayed to the user
router.post('/:id/solution', authenticate, async (req, res) => {
  try {
    if (!['agent', 'admin'].includes(req.user.role))
      return res.status(403).json({ error: 'Only agents and admins can submit solutions' });

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const { text, steps = [] } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Solution text is required' });

    ticket.agentSolution = {
      text:        text.trim(),
      steps:       Array.isArray(steps) ? steps.filter(s => s?.trim()) : [],
      submittedBy: req.user._id,
      submittedAt: new Date(),
      role:        req.user.role,
    };

    if (ticket.status === 'Open') ticket.status = 'In Progress';
    ticket.updatedAt = new Date();
    await ticket.save();

    const updated = await Ticket.findById(ticket._id)
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills')
      .populate('agentSolution.submittedBy', 'name role');
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/tickets/:id/feedback ───────────────────────────────────────────
// Employee responds to agent solution: satisfied=true → Resolved + KB update
//                                       satisfied=false → replyNote sent back
router.post('/:id/feedback', authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.userId.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'Access denied' });
    if (!ticket.agentSolution?.text)
      return res.status(400).json({ error: 'No solution submitted yet' });

    const { satisfied, replyNote } = req.body;

    ticket.userFeedback = {
      satisfied,
      replyNote:   replyNote?.trim() || '',
      submittedAt: new Date(),
    };

    if (satisfied) {
      ticket.status     = 'Resolved';
      ticket.resolvedAt = new Date();
      ticket.resolution = ticket.agentSolution.text;
      if (ticket.assignedAgentId)
        await User.updateOne({ _id: ticket.assignedAgentId }, { $inc: { workload: -1 } });

      callAI('/api/kb/add', {
        issue: ticket.issue, resolution: ticket.agentSolution.text,
        category: ticket.category || '', priority: ticket.priority || '',
        source: 'user_confirmed', ticket_id: ticket.ticketId,
      }, 15000)
        .then(() => console.log(`✅ KB updated (user confirmed): ${ticket.ticketId}`))
        .catch(e  => console.error(`⚠️  KB failed: ${e.message}`));
    } else {
      ticket.status = 'Open';
      ticket.internalNotes = ticket.internalNotes || [];
      ticket.internalNotes.push({
        userId:    req.user._id,
        text:      `🔄 User says solution didn't work.${replyNote ? ` Their note: "${replyNote}"` : ''}`,
        createdAt: new Date(),
      });
    }

    ticket.updatedAt = new Date();
    await ticket.save();

    const updated = await Ticket.findById(ticket._id)
      .populate('userId', 'name email')
      .populate('assignedAgentId', 'name email skills')
      .populate('agentSolution.submittedBy', 'name role');
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/tickets/:id/notes ───────────────────────────────────────────────
router.post('/:id/notes', authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    ticket.internalNotes = ticket.internalNotes || [];
    ticket.internalNotes.push({ userId: req.user._id, text: req.body.text, createdAt: new Date() });
    await ticket.save();
    res.json(ticket);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;