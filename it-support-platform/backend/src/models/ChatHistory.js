import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  meta: {
    category: String,
    priority: String,
    final_confidence: Number,
    similarity_score: Number,
    llm_confidence: Number,
    decision: String,
    sources: [mongoose.Schema.Types.Mixed],
    suggestedFix: [String],
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const chatHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  sessionId: {
    type: String,
    required: true,
    index: true,
  },
  title: {
    type: String,
    default: 'New Chat',
  },
  messages: [messageSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

chatHistorySchema.index({ userId: 1, isActive: 1 });
chatHistorySchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model('ChatHistory', chatHistorySchema);
