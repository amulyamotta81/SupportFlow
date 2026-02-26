import express from 'express';
import User from '../models/User.js';
import Ticket from '../models/Ticket.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents', authenticate, async (req, res) => {
  try {
    const agents = await User.find({ role: 'agent' }).select('-password');
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(await User.findById(user._id).select('-password'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/overview', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [ticketCount, resolvedCount, agentCount, byCategory, byPriority] = await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: 'Resolved' }),
      User.countDocuments({ role: 'agent' }),
      Ticket.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
      Ticket.aggregate([{ $group: { _id: '$priority', count: { $sum: 1 } } }])
    ]);
    res.json({
      totalTickets: ticketCount,
      resolvedTickets: resolvedCount,
      agentCount,
      byCategory,
      byPriority,
      resolutionRate: ticketCount ? ((resolvedCount / ticketCount) * 100).toFixed(1) : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
