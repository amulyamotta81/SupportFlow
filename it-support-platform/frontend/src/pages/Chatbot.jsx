import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  Send, Ticket, CheckCircle, ArrowLeft,
  ChevronDown, ChevronUp, AlertTriangle,
  Shield, Zap, BookOpen, ExternalLink
} from 'lucide-react';

// ── Confidence badge ──────────────────────────────────────────────
function ConfidenceBadge({ score, decision }) {
  const pct = Math.round(score * 100);
  const config =
    decision === 'auto_resolve'
      ? { label: 'High Confidence', bar: 'bg-emerald-400', ring: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' }
      : decision === 'suggest'
      ? { label: 'Moderate Confidence', bar: 'bg-amber-400', ring: 'border-amber-500/40 bg-amber-500/10 text-amber-300' }
      : { label: 'Low Confidence', bar: 'bg-red-400', ring: 'border-red-500/40 bg-red-500/10 text-red-300' };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${config.ring}`}>
      <span>{config.label}</span>
      <span className="font-bold">{pct}%</span>
      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${config.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Step-by-step fix renderer ─────────────────────────────────────
function StepList({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="mt-3 space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 flex items-center justify-center text-xs font-bold">
            {i + 1}
          </span>
          <span className="text-slate-200 leading-relaxed">{step}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Sources panel ─────────────────────────────────────────────────
function SourcesPanel({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources?.length) return null;
  return (
    <div className="mt-3 border border-slate-600/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-700/50 text-xs text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <BookOpen size={12} /> {sources.length} KB source{sources.length > 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="divide-y divide-slate-700/50">
          {sources.map((s, i) => (
            <div key={i} className="px-3 py-2 bg-slate-800/40">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-300 truncate max-w-[70%]">{s.issue || s.ticketId || `Ticket #${i + 1}`}</span>
                <span className="text-xs text-slate-500">
                  {Math.round((s.similarity ?? s.similarity_score ?? 0) * 100)}% match
                </span>
              </div>
              {s.resolution && (
                <p className="text-xs text-slate-400 line-clamp-2">{s.resolution}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Escalation notice ─────────────────────────────────────────────
function EscalationNotice() {
  return (
    <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-300">
      <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
      <span>Low confidence — we recommend creating a support ticket so a human agent can assist you.</span>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────
function MessageBubble({ m, onCreateTicket }) {
  if (m.role === 'user') {
    return (
      <div className="mb-4 flex justify-end">
        <div className="max-w-[80%] bg-blue-600 px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed">
          {m.text}
        </div>
      </div>
    );
  }

  const hasRag = m.meta != null;

  return (
    <div className="mb-4 flex justify-start">
      <div className="max-w-[85%]">
        {/* Bot icon */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
            <Zap size={12} className="text-white" />
          </div>
          <span className="text-xs text-slate-400 font-medium">IT Assistant</span>
          {hasRag && m.meta.decision && (
            <ConfidenceBadge score={m.meta.final_confidence} decision={m.meta.decision} />
          )}
        </div>

        <div className="bg-slate-700/60 border border-slate-600/40 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed">
          {/* Main answer */}
          <p className="text-slate-100 whitespace-pre-wrap">{m.text}</p>

          {/* Step-by-step fix */}
          {hasRag && m.meta.suggestedFix?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-600/40">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Step-by-step fix</p>
              <StepList steps={m.meta.suggestedFix} />
            </div>
          )}

          {/* Category / Priority pills */}
          {hasRag && (m.meta.category || m.meta.priority) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.meta.category && (
                <span className="px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs">{m.meta.category}</span>
              )}
              {m.meta.priority && (
                <span className={`px-2 py-0.5 rounded-full text-xs border ${
                  m.meta.priority === 'Critical' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
                  m.meta.priority === 'High' ? 'bg-orange-500/15 border-orange-500/30 text-orange-300' :
                  m.meta.priority === 'Medium' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' :
                  'bg-slate-500/15 border-slate-500/30 text-slate-300'
                }`}>{m.meta.priority} Priority</span>
              )}
            </div>
          )}

          {/* Sources */}
          {hasRag && m.meta.sources?.length > 0 && (
            <SourcesPanel sources={m.meta.sources} />
          )}

          {/* Escalation notice */}
          {hasRag && m.meta.decision === 'escalate' && <EscalationNotice />}
        </div>

        {/* Create Ticket button (per message) */}
        {hasRag && (
          <button
            onClick={() => onCreateTicket(m.meta)}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/40 rounded-lg text-xs text-amber-300 transition-colors"
          >
            <Ticket size={12} /> Create Ticket from this answer
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Chatbot ──────────────────────────────────────────────────
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

    try {
      const { data } = await api.post('/chat/message', { message: msg });

      // The FastAPI response fields (proxied through Express /api/chat/message)
      // Fields: answer, category, priority, similarity_score, llm_confidence,
      //         success_rate, final_confidence, decision, sources, suggestedFix
      // Fallback: older Express-only shape uses `response`, `suggestedCategory`, etc.

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

  const handleCreateTicket = (meta) => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.text || '';
    navigate('/tickets/new', {
      state: {
        issue: meta?.rawIssue || lastUserMsg,
        category: meta?.category || '',
        priority: meta?.priority || '',
        aiAnalysis: meta ? {
          category: meta.category,
          priority: meta.priority,
          confidence: meta.final_confidence,
          suggestedFix: meta.suggestedFix,
          similarTickets: meta.sources?.map(s => ({
            issue: s.issue,
            solution: s.resolution,
            similarity: s.similarity ?? s.similarity_score ?? 0
          })) || []
        } : undefined
      }
    });
  };

  const lastUserText = [...messages].reverse().find(m => m.role === 'user')?.text || '';
  const lastMeta = [...messages].reverse().find(m => m.role === 'assistant' && m.meta)?.meta;
  const [resolving, setResolving] = useState(false);

  const handleIssueSolved = async () => {
    setResolving(true);
    try {
      // Find the most recent open ticket for this user and mark it Resolved
      const { data: tickets } = await api.get('/tickets');
      const latest = tickets.find(t => t.status !== 'Resolved');
      if (latest) {
        await api.patch(`/tickets/${latest._id}`, {
          status: 'Resolved',
          resolution: lastMeta
            ? `Self-resolved via IT Assistant. Confidence: ${Math.round(lastMeta.final_confidence * 100)}%`
            : 'Self-resolved via IT Assistant chat.'
        });
      }
    } catch (e) {
      console.error('Could not mark ticket resolved:', e);
    }
    setResolving(false);
    navigate(user ? '/dashboard' : '/');
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