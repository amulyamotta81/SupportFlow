import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  Send, Ticket, CheckCircle, ArrowLeft,
  ChevronDown, ChevronUp, AlertTriangle,
  Shield, Zap, BookOpen, ExternalLink
} from 'lucide-react';

export default function Chatbot() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: "Hi! I'm your IT Assistant. Describe your issue and I'll search our knowledge base for the best solution.",
      meta: null
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const parseAnswer = (answer) => {
    // If the AI returns numbered steps embedded in the answer text,
    // extract them so we can render them as a step list.
    // Pattern: lines starting with "1." "2." etc.
    const lines = answer.split('\n').map(l => l.trim()).filter(Boolean);
    const stepLines = lines.filter(l => /^\d+[\.\)]/.test(l));
    if (stepLines.length >= 2) {
      const steps = stepLines.map(l => l.replace(/^\d+[\.\)]\s*/, ''));
      const prose = lines.filter(l => !/^\d+[\.\)]/.test(l)).join(' ');
      return { prose, steps };
    }
    return { prose: answer, steps: [] };
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    if (!user) { navigate('/login'); return; }
    const msg = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', text: msg, meta: null }]);
    setLoading(true);

    await updateConversationHistory(userMessage);

    try {
      const { data } = await api.post('/chat/message', { message: msg });

      const answer = data.answer || data.response || 'No response received.';
      const { prose, steps } = parseAnswer(answer);

      // Merge suggestedFix from API or extracted steps
      const suggestedFix =
        data.suggestedFix?.length > 0 ? data.suggestedFix :
        steps.length > 0 ? steps : [];

      const meta = {
        category: data.category || data.suggestedCategory || '',
        priority: data.priority || data.suggestedPriority || '',
        final_confidence: data.final_confidence ?? (data.confidence || 0),
        similarity_score: data.similarity_score ?? 0,
        llm_confidence: data.llm_confidence ?? 0,
        decision: data.decision || (
          (data.final_confidence ?? data.confidence ?? 0) >= 0.85 ? 'auto_resolve' :
          (data.final_confidence ?? data.confidence ?? 0) >= 0.60 ? 'suggest' : 'escalate'
        ),
        sources: data.sources || [],
        suggestedFix,
        rawIssue: msg
      };

      setMessages(m => [...m, { role: 'assistant', text: prose, meta }]);
    } catch (e) {
      setMessages(m => [...m, {
        role: 'assistant',
        text: "Sorry, the IT Assistant is temporarily unavailable. Please create a ticket for support.",
        meta: null
      }]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center flex-shrink-0">
        <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm">
          <ArrowLeft size={18} /> Back
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold">IT Assistant</h1>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Online
        </div>
      </header>

      {/* Login warning */}
      {!user && (
        <div className="bg-amber-900/30 border-b border-amber-700 px-6 py-2 text-center text-amber-200 text-sm flex-shrink-0">
          <Link to="/login" className="underline">Login</Link> to chat with the IT Assistant.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto">
          {messages.map((m, i) => (
            <MessageBubble key={i} m={m} onCreateTicket={handleCreateTicket} />
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-4">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
                <Zap size={12} className="text-white" />
              </div>
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 bg-slate-800 border-t border-slate-700 p-4">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder={user ? "Describe your IT issue..." : "Login to use the assistant"}
              className="flex-1 px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
              disabled={!user || loading}
            />
            <button
              onClick={send}
              disabled={loading || !user || !input.trim()}
              className="px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
            >
              <Send size={18} />
            </button>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleIssueSolved}
              disabled={resolving}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-600/40 rounded-lg text-emerald-300 text-xs transition-colors disabled:opacity-50"
            >
              {resolving
                ? <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                : <CheckCircle size={14} />}
              Issue Solved
            </button>
            <button
              onClick={() => handleCreateTicket(lastMeta)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/40 rounded-lg text-amber-300 text-xs transition-colors"
            >
              <Ticket size={14} /> Create Ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}