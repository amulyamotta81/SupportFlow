import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedAgentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issue: { type: String, required: true },
  category: { type: String, default: 'General' },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
  status: { type: String, enum: ['Open', 'In Progress', 'Resolved', 'Escalated'], default: 'Open' },
  attachmentUrl: { type: String },
  aiAnalysis: {
    category: String,
    priority: String,
    confidence: Number,
    rootCause: String,
    suggestedFix: [String],
    similarTickets: [{
      ticketId: String,
      issue: String,
      solution: String,
      similarity: Number
    }]
  },
  slaDeadline: { type: Date },
  internalNotes: [{ userId: mongoose.Schema.Types.ObjectId, text: String, createdAt: Date }],
  resolution: { type: String },
  resolvedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Ticket', ticketSchema);
