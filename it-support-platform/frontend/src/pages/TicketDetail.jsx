import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  ArrowLeft, Brain, User, Clock, CheckCircle2, AlertTriangle,
  Send, RefreshCw, ChevronDown, ChevronUp, Zap, MessageSquare,
  ThumbsUp, ThumbsDown, Shield, Star, Loader2, Plus, Minus
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  'Open':        'bg-blue-500/15 text-blue-300 border-blue-500/40',
  'In Progress': 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  'Resolved':    'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  'Escalated':   'bg-red-500/15 text-red-300 border-red-500/40',
};
const PRIORITY_STYLE = {
  'Critical': 'text-red-400 border-red-500/40 bg-red-500/10',
  'High':     'text-orange-400 border-orange-500/40 bg-orange-500/10',
  'Medium':   'text-amber-400 border-amber-500/40 bg-amber-500/10',
  'Low':      'text-slate-400 border-slate-500/40 bg-slate-500/10',
};
const CONF_COLOR = c => c >= 0.85 ? 'text-emerald-400' : c >= 0.6 ? 'text-amber-400' : 'text-red-400';
const CONF_BG    = c => c >= 0.85 ? 'bg-emerald-500' : c >= 0.6 ? 'bg-amber-500' : 'bg-red-500';
const fmt = d => d ? new Date(d).toLocaleString() : '—';

function Badge({ label, style }) {
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>{label}</span>;
}

function Section({ title, icon: Icon, children, defaultOpen = true, accent }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/40 transition-colors ${accent || ''}`}
      >
        <div className="flex items-center gap-2.5 font-semibold text-sm">
          {Icon && <Icon size={16} className="text-slate-400" />}
          {title}
        </div>
        {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  );
}

// ── Agent/Admin: Solution Submission Panel ────────────────────────────────────
function SolutionSubmitPanel({ ticket, onUpdated }) {
  const [text, setText]     = useState(ticket.agentSolution?.text || '');
  const [steps, setSteps]   = useState(ticket.agentSolution?.steps?.length ? ticket.agentSolution.steps : ['']);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [editing, setEditing] = useState(false);

  const addStep    = () => setSteps(s => [...s, '']);
  const removeStep = i => setSteps(s => s.filter((_, idx) => idx !== i));
  const updateStep = (i, v) => setSteps(s => s.map((x, idx) => idx === i ? v : x));

  const submit = async () => {
    if (!text.trim()) { setError('Please write a resolution note.'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post(`/tickets/${ticket._id}/solution`, {
        text: text.trim(),
        steps: steps.filter(s => s.trim()),
      });
      setEditing(false);
      onUpdated(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to submit. Try again.');
    }
    setSaving(false);
  };

  if (ticket.agentSolution?.text && !editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
          <CheckCircle2 size={16} /> Solution submitted — visible to user now
        </div>

        {/* Show conversation history from internal notes */}
        {ticket.internalNotes?.filter(n => n.text?.includes('🔄')).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Conversation History</p>
            {ticket.internalNotes.filter(n => n.text?.includes('🔄')).map((n, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
                {n.text}
                <p className="text-xs text-slate-500 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        {ticket.userFeedback?.satisfied === false && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            <span className="font-semibold">User replied:</span>{' '}
            {ticket.userFeedback.replyNote || 'Solution not working. No additional notes.'}
          </div>
        )}
        {ticket.userFeedback?.satisfied === true && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
            <ThumbsUp size={14} className="inline mr-1.5" />
            User confirmed this solution worked. KB has been updated.
          </div>
        )}
        {/* Allow re-submitting if user said not working */}
        {ticket.userFeedback?.satisfied === false && (
          <button
            onClick={() => { setEditing(true); setText(''); setSteps(['']); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors"
          >
            <RefreshCw size={14} /> Submit revised solution
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
          Resolution Notes *
        </label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="Describe what the user should do to resolve this issue..."
          className="w-full px-4 py-3 bg-slate-700/60 border border-slate-600 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none transition-colors"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Step-by-step (optional)
          </label>
          <button onClick={addStep} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            <Plus size={12} /> Add step
          </button>
        </div>
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-300 text-xs flex items-center justify-center flex-shrink-0 font-bold">
                {i + 1}
              </span>
              <input
                value={step}
                onChange={e => updateStep(i, e.target.value)}
                placeholder={`Step ${i + 1}...`}
                className="flex-1 px-3 py-2 bg-slate-700/60 border border-slate-600 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              {steps.length > 1 && (
                <button onClick={() => removeStep(i)} className="text-slate-500 hover:text-red-400 transition-colors">
                  <Minus size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm flex items-center gap-1.5">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <button
        onClick={submit}
        disabled={saving || !text.trim()}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {saving ? 'Submitting...' : 'Send Solution to User'}
      </button>
    </div>
  );
}

// ── Employee: Solution Display + Feedback Panel ───────────────────────────────
function SolutionFeedbackPanel({ ticket, onUpdated }) {
  const sol = ticket.agentSolution;
  const fb  = ticket.userFeedback;

  const [showReply, setShowReply]   = useState(false);
  const [replyNote, setReplyNote]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  // Already gave feedback
  if (fb?.satisfied === true) {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
          <ThumbsUp size={16} /> You marked this as resolved
        </div>
        <p className="text-slate-400 text-sm">Thank you. The solution has been saved to our knowledge base.</p>
      </div>
    );
  }

  if (fb?.satisfied === false && !showReply) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <p className="text-amber-400 font-semibold text-sm mb-1">You reported this didn't work</p>
          {fb.replyNote && <p className="text-slate-400 text-sm">Your note: "{fb.replyNote}"</p>}
          <p className="text-slate-400 text-sm mt-1">The agent has been notified and will follow up.</p>
        </div>
      </div>
    );
  }

  const sendFeedback = async (satisfied) => {
    setSubmitting(true); setError('');
    try {
      const res = await api.post(`/tickets/${ticket._id}/feedback`, {
        satisfied,
        replyNote: satisfied ? '' : replyNote,
      });
      onUpdated(res.data);
      setShowReply(false);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to submit feedback.');
    }
    setSubmitting(false);
  };

  if (!sol?.text) return null;

  return (
    <div className="space-y-4">
      {/* Solution display */}
      <div className="p-4 rounded-xl bg-slate-700/40 border border-slate-600">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center">
            <User size={14} className="text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {sol.submittedBy?.name || 'Support Agent'}
            </p>
            <p className="text-xs text-slate-500">{fmt(sol.submittedAt)}</p>
          </div>
        </div>
        <p className="text-slate-200 text-sm leading-relaxed">{sol.text}</p>
        {sol.steps?.length > 0 && (
          <ol className="mt-3 space-y-2">
            {sol.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-300">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs flex items-center justify-center flex-shrink-0 font-bold mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Feedback prompt */}
      {ticket.status !== 'Resolved' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Did this solution fix your issue?</p>

          {!showReply ? (
            <div className="flex gap-3">
              <button
                onClick={() => sendFeedback(true)}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-sm font-semibold transition-colors"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <ThumbsUp size={15} />}
                Yes, this fixed it!
              </button>
              <button
                onClick={() => setShowReply(true)}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-sm font-semibold transition-colors border border-slate-600"
              >
                <ThumbsDown size={15} />
                Still not working
              </button>
            </div>
          ) : (
            <div className="space-y-3 p-4 bg-slate-700/40 rounded-xl border border-slate-600">
              <p className="text-sm font-medium text-slate-300">Tell the agent what's still not working:</p>
              <textarea
                value={replyNote}
                onChange={e => setReplyNote(e.target.value)}
                rows={3}
                placeholder="Describe what happened when you tried the solution..."
                className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none transition-colors"
              />
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => sendFeedback(false)}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-lg text-sm font-semibold transition-colors"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Send Reply
                </button>
                <button
                  onClick={() => { setShowReply(false); setReplyNote(''); }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TicketDetail() {
  const { id }   = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ticket,     setTicket]     = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [noteText,   setNoteText]   = useState('');
  const [noteLoading,setNoteLoading]= useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const pollRef = useRef(null);

  const fetchTicket = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get(`/tickets/${id}`);
      setTicket(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load ticket.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTicket();
    // Poll every 15s so employee sees agent solution without refreshing
    pollRef.current = setInterval(() => fetchTicket(true), 15000);
    return () => clearInterval(pollRef.current);
  }, [fetchTicket]);

  const addNote = async () => {
    if (!noteText.trim()) return;
    setNoteLoading(true);
    try {
      const res = await api.post(`/tickets/${id}/notes`, { text: noteText });
      setTicket(res.data);
      setNoteText('');
    } catch (e) {
      console.error(e);
    }
    setNoteLoading(false);
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-blue-400" />
    </div>
  );

  if (error || !ticket) return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
      <div className="text-center">
        <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-slate-400">{error || 'Ticket not found'}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-400 hover:text-blue-300 text-sm">← Go back</button>
      </div>
    </div>
  );

  const ai   = ticket.aiAnalysis || {};
  const conf = ai.confidence || 0;
  const isOwner  = (ticket.userId?._id ?? ticket.userId)?.toString() === user?._id?.toString();
  const isAgent  = user?.role === 'agent';
  const isAdmin  = user?.role === 'admin';
  const canAct   = isAgent || isAdmin;
  const hasSolution = !!ticket.agentSolution?.text;

  const backPath = isAdmin ? '/admin' : isAgent ? '/agent' : '/dashboard';

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(backPath)} className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-blue-400 font-bold">{ticket.ticketId}</span>
                <Badge label={ticket.status}   style={STATUS_STYLE[ticket.status]} />
                <Badge label={ticket.priority} style={PRIORITY_STYLE[ticket.priority]} />
              </div>
              <p className="text-slate-400 text-xs mt-0.5">Created {fmt(ticket.createdAt)}</p>
            </div>
          </div>
          <button
            onClick={() => fetchTicket(true)}
            disabled={refreshing}
            className="p-2 text-slate-400 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 grid md:grid-cols-3 gap-5">

        {/* Left column — main content */}
        <div className="md:col-span-2 space-y-5">

          {/* Issue */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Issue</p>
            <p className="text-white text-base leading-relaxed">{ticket.issue}</p>
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span>Category: <span className="text-slate-300">{ticket.category}</span></span>
              <span>Raised by: <span className="text-slate-300">{ticket.userId?.name || '—'}</span></span>
            </div>
          </div>

          {/* ── EMPLOYEE: Solution from agent ── */}
          {user?.role === 'employee' && isOwner && (
            hasSolution ? (
              <Section title="Solution from your agent" icon={MessageSquare} accent="border-b border-blue-500/20">
                <SolutionFeedbackPanel ticket={ticket} onUpdated={setTicket} />
              </Section>
            ) : ticket.status !== 'Resolved' ? (
              <div className="bg-slate-800 rounded-xl border border-slate-700 border-dashed p-5 text-center">
                <Clock size={28} className="text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm font-medium">Waiting for agent response</p>
                <p className="text-slate-600 text-xs mt-1">This page refreshes automatically every 15 seconds</p>
              </div>
            ) : (
              <div className="bg-emerald-500/5 rounded-xl border border-emerald-500/20 p-5 text-center">
                <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-emerald-400 font-semibold">Ticket Resolved</p>
                {ticket.resolution && <p className="text-slate-400 text-sm mt-1">{ticket.resolution}</p>}
              </div>
            )
          )}

          {/* ── AGENT / ADMIN: Submit Solution ── */}
          {canAct && (
            <Section
              title={hasSolution ? 'Solution Submitted' : 'Submit Solution to User'}
              icon={Send}
              accent={hasSolution ? 'border-b border-emerald-500/20' : 'border-b border-blue-500/20'}
            >
              <SolutionSubmitPanel ticket={ticket} onUpdated={setTicket} />
            </Section>
          )}

          {/* AI Analysis */}
          {(ai.confidence > 0 || ai.rootCause || ai.suggestedFix?.length > 0) && (
            <Section title="AI Analysis" icon={Brain}>
              <div className="space-y-4">
                {/* Confidence bar */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">AI Confidence</span>
                    <span className={`font-bold ${CONF_COLOR(conf)}`}>{Math.round(conf * 100)}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${CONF_BG(conf)}`}
                      style={{ width: `${conf * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {conf >= 0.85 ? 'High confidence — AI solution likely applies directly'
                      : conf >= 0.6  ? 'Medium confidence — review suggested steps'
                      : 'Low confidence — manual investigation needed'}
                  </p>
                </div>

                {ai.rootCause && (
                  <div className="p-3 rounded-lg bg-slate-700/40 border border-slate-600">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Root Cause</p>
                    <p className="text-slate-200 text-sm">{ai.rootCause}</p>
                  </div>
                )}

                {ai.suggestedFix?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      AI Suggested Fix
                    </p>
                    <ol className="space-y-2">
                      {ai.suggestedFix.map((step, i) => (
                        <li key={i} className="flex gap-3 text-sm text-slate-300">
                          <span className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs flex items-center justify-center flex-shrink-0 font-bold mt-0.5">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Similar past tickets */}
          {ai.similarTickets?.length > 0 && (
            <Section title="Similar Past Tickets (RAG)" icon={Zap} defaultOpen={false}>
              <div className="space-y-3">
                {ai.similarTickets.map((t, i) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-700/40 border border-slate-600">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-blue-400 text-xs">{t.ticketId}</span>
                      <span className="text-xs text-slate-500">
                        {Math.round((t.similarity || 0) * 100)}% match
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm truncate">{t.issue}</p>
                    {t.solution && t.solution !== 'N/A' && (
                      <p className="text-slate-500 text-xs mt-1 truncate">↳ {t.solution}</p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Internal notes */}
          <Section title="Internal Notes" icon={MessageSquare} defaultOpen={false}>
            <div className="space-y-3 mb-4">
              {ticket.internalNotes?.length ? ticket.internalNotes.map((n, i) => (
                <div key={i} className="p-3 rounded-lg bg-slate-700/30 border border-slate-700 text-sm">
                  <p className="text-slate-200">{n.text}</p>
                  <p className="text-xs text-slate-500 mt-1">{fmt(n.createdAt)}</p>
                </div>
              )) : (
                <p className="text-slate-600 text-sm">No internal notes yet.</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addNote()}
                placeholder="Add a note..."
                className="flex-1 px-3 py-2 bg-slate-700/60 border border-slate-600 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                onClick={addNote}
                disabled={noteLoading || !noteText.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors"
              >
                {noteLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </Section>
        </div>

        {/* Right column — metadata */}
        <div className="space-y-4">

          {/* Assigned Agent */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Assigned Agent</p>
            {ticket.assignedAgentId ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <User size={16} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{ticket.assignedAgentId.name}</p>
                    <p className="text-xs text-slate-500">{ticket.assignedAgentId.email}</p>
                  </div>
                </div>
                {ticket.assignedAgentId.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {ticket.assignedAgentId.skills.map(s => (
                      <span key={s} className="px-2 py-0.5 bg-slate-700 text-slate-300 text-xs rounded-full">{s}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-1">
                  <Star size={11} className="text-amber-400" />
                  {ticket.assignedAgentId.successRate ?? 100}% success rate
                </div>
              </div>
            ) : (
              <p className="text-slate-600 text-sm">Not yet assigned</p>
            )}
          </div>

          {/* SLA */}
          {ticket.slaDeadline && (
            <div className={`rounded-xl border p-4 ${
              new Date(ticket.slaDeadline) < new Date()
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-slate-800 border-slate-700'
            }`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                <Clock size={11} className="inline mr-1" />SLA Deadline
              </p>
              <p className={`text-sm font-semibold ${
                new Date(ticket.slaDeadline) < new Date() ? 'text-red-400' : 'text-slate-200'
              }`}>
                {fmt(ticket.slaDeadline)}
              </p>
              {new Date(ticket.slaDeadline) < new Date() && ticket.status !== 'Resolved' && (
                <p className="text-red-400 text-xs mt-1 font-medium">⚠️ SLA breached</p>
              )}
            </div>
          )}

          {/* User feedback status (visible to agent/admin) */}
          {canAct && ticket.userFeedback?.satisfied !== undefined && (
            <div className={`rounded-xl border p-4 ${
              ticket.userFeedback.satisfied
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            }`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">User Feedback</p>
              {ticket.userFeedback.satisfied ? (
                <p className="text-emerald-400 text-sm font-semibold flex items-center gap-1.5">
                  <ThumbsUp size={14} /> Confirmed solved
                </p>
              ) : (
                <>
                  <p className="text-amber-400 text-sm font-semibold flex items-center gap-1.5">
                    <ThumbsDown size={14} /> Reported not working
                  </p>
                  {ticket.userFeedback.replyNote && (
                    <p className="text-slate-400 text-xs mt-1.5 italic">
                      "{ticket.userFeedback.replyNote}"
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Quick actions for agent/admin */}
          {canAct && ticket.status !== 'Resolved' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Quick Actions</p>
              <div className="space-y-2">
                {ticket.status !== 'Escalated' && (
                  <button
                    onClick={async () => {
                      await api.patch(`/tickets/${id}`, { status: 'Escalated' });
                      fetchTicket(true);
                    }}
                    className="w-full py-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded-lg text-sm transition-colors"
                  >
                    Escalate Ticket
                  </button>
                )}
                <button
                  onClick={async () => {
                    await api.patch(`/tickets/${id}`, { status: 'In Progress' });
                    fetchTicket(true);
                  }}
                  className="w-full py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 rounded-lg text-sm transition-colors"
                >
                  Mark In Progress
                </button>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-xs text-slate-500 space-y-1.5">
            <p>Created: <span className="text-slate-400">{fmt(ticket.createdAt)}</span></p>
            <p>Updated: <span className="text-slate-400">{fmt(ticket.updatedAt)}</span></p>
            {ticket.resolvedAt && <p>Resolved: <span className="text-emerald-400">{fmt(ticket.resolvedAt)}</span></p>}
          </div>
        </div>
      </main>
    </div>
  );





}
