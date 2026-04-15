import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../services/api';
import { ArrowLeft, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';

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
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // AI-analyzed category/priority from chatbot (read-only)
  const fromChatbot = !!(state.category && state.priority);
  const category = state.category || null;
  const priority = state.priority || null;

  // AI analysis passed from chatbot
  const aiAnalysis = state.aiAnalysis || null;
  const hasAI = aiAnalysis && (aiAnalysis.confidence > 0 || aiAnalysis.suggestedFix?.length > 0);

  const handleSubmit = async () => {
    if (!issue.trim()) { setError('Please describe your issue.'); return; }
    setLoading(true);
    setError('');
    try {
      const payload = {
        issue: issue.trim(),
        // Only send category/priority if pre-analyzed by chatbot AI;
        // otherwise backend will auto-classify via AI service
        ...(fromChatbot && { category, priority }),
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
          <p className="text-slate-400 text-sm mt-1">Category, priority, and agent will be assigned automatically by AI.</p>
        </div>

        {/* AI pre-fill notice */}
        {hasAI && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-sm text-blue-200">
            <Zap size={16} className="mt-0.5 flex-shrink-0 text-blue-400" />
            <div>
              <p className="font-medium text-blue-300 mb-1">Pre-filled from IT Assistant</p>
              <p className="text-blue-200/80">
                Category, priority, and issue description have been filled in from your chat session.
                {aiAnalysis.confidence > 0 && ` AI confidence: ${aiAnalysis.confidence > 1 ? aiAnalysis.confidence.toFixed(2) : (aiAnalysis.confidence * 100).toFixed(2)}%.`}
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

        {/* Category & Priority — AI-determined */}
        {fromChatbot ? (
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Category</label>
              <div className="px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-sm text-slate-200">
                {category}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Priority</label>
              <div className={`px-4 py-3 bg-slate-800 border rounded-xl text-sm font-medium ${PRIORITY_COLOR[priority]}`}>
                {priority}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-300">
            <Zap size={16} className="mt-0.5 flex-shrink-0 text-amber-400" />
            <p>Category and priority will be <span className="text-white font-medium">automatically determined by AI</span> when you submit.</p>
          </div>
        )}

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
