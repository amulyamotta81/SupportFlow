import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../services/api';
import { ArrowLeft, Zap, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';

const CATEGORIES = [
  'Network', 'Hardware', 'Software', 'Security',
  'Email', 'VPN', 'Account', 'General'
];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const PRIORITY_COLOR = {
  Low:      'text-slate-300 border-slate-500',
  Medium:   'text-amber-300 border-amber-500',
  High:     'text-orange-300 border-orange-500',
  Critical: 'text-red-300 border-red-500',
};

export default function TicketCreate() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const state     = location.state || {};

  // Pre-fill from chatbot if available
  const [issue,    setIssue]    = useState(state.issue    || '');
  const [category, setCategory] = useState(state.category || 'General');
  const [priority, setPriority] = useState(state.priority || 'Medium');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // AI analysis passed from chatbot
  const aiAnalysis = state.aiAnalysis || null;
  const hasAI = aiAnalysis && (aiAnalysis.confidence > 0 || aiAnalysis.suggestedFix?.length > 0);

  const handleSubmit = async () => {
    if (!issue.trim()) { setError('Please describe your issue.'); return; }
    setLoading(true);
    setError('');
    try {
      const payload = {
        issue:    issue.trim(),
        category,
        priority,
        // Pass AI analysis so backend can store it on the ticket
        ...(hasAI && { aiAnalysis })
      };
      const res = await api.post('/tickets', payload);
      navigate(`/tickets/${res.data._id}`, {
        state: { created: true }
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create ticket. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <Link to="/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white w-fit text-sm transition-colors">
          <ArrowLeft size={18} /> Back to Dashboard
        </Link>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Raise New Ticket</h1>
          <p className="text-slate-400 text-sm mt-1">A support agent will be assigned automatically.</p>
        </div>

        {/* AI pre-fill notice */}
        {hasAI && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-sm text-blue-200">
            <Zap size={16} className="mt-0.5 flex-shrink-0 text-blue-400" />
            <div>
              <p className="font-medium text-blue-300 mb-1">Pre-filled from IT Assistant</p>
              <p className="text-blue-200/80">
                Category, priority, and issue description have been filled in from your chat session.
                {aiAnalysis.confidence > 0 && ` AI confidence: ${Math.round(aiAnalysis.confidence * 100)}%.`}
              </p>
              {aiAnalysis.suggestedFix?.length > 0 && (
                <p className="mt-1 text-blue-200/70 text-xs">
                  {aiAnalysis.suggestedFix.length} suggested fix steps will be attached to this ticket.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Issue */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Issue Description *</label>
          <textarea
            value={issue}
            onChange={e => setIssue(e.target.value)}
            rows={4}
            placeholder="e.g., Cannot connect to VPN from home network since this morning..."
            className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Category</label>
          <div className="relative">
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-sm appearance-none focus:outline-none focus:border-blue-500 transition-colors"
            >
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Priority</label>
          <div className="grid grid-cols-4 gap-2">
            {PRIORITIES.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  priority === p
                    ? `${PRIORITY_COLOR[p]} bg-slate-700`
                    : 'text-slate-500 border-slate-700 hover:border-slate-500'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* AI suggested fix preview */}
        {hasAI && aiAnalysis.suggestedFix?.length > 0 && (
          <div className="p-4 rounded-xl bg-slate-800 border border-slate-700">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              AI Suggested Fix (will be attached)
            </p>
            <ol className="space-y-1.5">
              {aiAnalysis.suggestedFix.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-slate-300">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !issue.trim()}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <CheckCircle2 size={18} />
              Submit Ticket
            </>
          )}
        </button>
      </main>
    </div>
  );
}
