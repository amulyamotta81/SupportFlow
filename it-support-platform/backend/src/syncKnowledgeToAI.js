/**
 * Sync resolved tickets from MongoDB to AI service's FAISS knowledge base.
 * Run after seed or periodically to make RAG responses dynamic.
 *
 * Usage: node src/syncKnowledgeToAI.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import Ticket from './models/Ticket.js';
import { connectDB } from './config/db.js';

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function sync() {
  await connectDB();

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
    console.log('No resolved tickets to sync. Run npm run seed first.');
    process.exit(0);
    return;
  }

  try {
    const { data } = await axios.post(`${AI_URL}/api/rebuild-knowledge`, { tickets }, { timeout: 120000 });
    if (data.ok) {
      console.log(`Synced ${data.count} tickets to AI knowledge base.`);
    } else {
      console.error(`Sync failed: ${data.error || 'Unknown error'}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('AI sync failed:', err.message);
    if (err.response?.data) console.error(err.response.data);
    process.exit(1);
  }

  process.exit(0);
}

sync().catch((e) => {
  console.error(e);
  process.exit(1);
});
