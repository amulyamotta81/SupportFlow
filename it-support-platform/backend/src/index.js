import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Ticket from './models/Ticket.js';
import authRoutes from './routes/auth.js';
import ticketRoutes from './routes/tickets.js';
import chatRoutes from './routes/chat.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ── Startup: ensure agent skills cover all ticket categories ────────────────
const ensureAgentSkills = async () => {
  try {
    const AGENT_SKILLS = {
      'agent@test.com':  ['Network', 'VPN', 'Security', 'Storage & Backup'],
      'agent2@test.com': ['Hardware', 'Software'],
      'agent3@test.com': ['Email', 'Account', 'General'],
    };

    for (const [email, skills] of Object.entries(AGENT_SKILLS)) {
      const result = await User.updateOne(
        { email, role: 'agent' },
        { $set: { skills } }
      );
      if (result.modifiedCount > 0)
        console.log(`🔧 Updated skills for ${email}: [${skills.join(', ')}]`);
    }

    // Recalculate workloads from actual active tickets
    const agents = await User.find({ role: 'agent' }).select('_id name');
    for (const agent of agents) {
      const active = await Ticket.countDocuments({
        assignedAgentId: agent._id,
        status: { $nin: ['Resolved'] },
      });
      await User.updateOne({ _id: agent._id }, { $set: { workload: active } });
    }

    // Check coverage
    const categories = await Ticket.distinct('category');
    const allAgents = await User.find({ role: 'agent' }).select('skills').lean();
    const allSkills = new Set(allAgents.flatMap(a => a.skills || []));
    const uncovered = categories.filter(c => !allSkills.has(c));
    if (uncovered.length)
      console.log(`⚠️  Categories with no skilled agent: [${uncovered.join(', ')}]`);
    else
      console.log(`✅ All ${categories.length} categories covered by agent skills`);
  } catch (err) {
    console.error('Agent skill sync error:', err.message);
  }
};

connectDB().then(() => ensureAgentSkills());

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
