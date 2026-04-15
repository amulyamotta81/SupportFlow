import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  MessageCircle, PlusCircle, LogOut, CheckCircle2,
  AlertCircle, Loader2, TrendingUp, RefreshCw, Bell
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import NotificationPanel, { buildNotifications } from '../components/NotificationPanel';

const STATUS_STYLE = {
  'Open':        'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'In Progress': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Resolved':    'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'Escalated':   'bg-red-500/15 text-red-300 border-red-500/30',
};
const PRIORITY_DOT = {
  Critical: 'bg-red-400', High: 'bg-orange-400', Medium: 'bg-amber-400', Low: 'bg-slate-400',
};

function Badge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${STATUS_STYLE[status] || STATUS_STYLE['Open']}`}>
      {status}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-slate-400 text-xs">{label}</p>
      </div>
    </div>
  );
}

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tickets,    setTickets]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get('/tickets');
      setTickets(res.data);
    } catch (e) { console.error('Failed to fetch tickets', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchTickets();
    // Auto-refresh every 15s — so user sees agent solution without manual refresh
    const interval = setInterval(() => fetchTickets(true), 15000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  const open       = tickets.filter(t => t.status === 'Open');
  const inProgress = tickets.filter(t => t.status === 'In Progress');
  const escalated  = tickets.filter(t => t.status === 'Escalated');
  const resolved   = tickets.filter(t => t.status === 'Resolved');
  const active     = tickets.filter(t => t.status !== 'Resolved');

  // Tickets with agent solution awaiting user feedback
  const awaitingFeedback = tickets.filter(
    t => t.agentSolution?.text && t.userFeedback?.satisfied === undefined && t.status !== 'Resolved'
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">Employee Dashboard</h1>
          <p className="text-slate-400 text-xs mt-0.5">Welcome back, {user?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTickets(true)}
            disabled={refreshing}
            className="p-2 text-slate-400 hover:text-white transition-colors"
            title="Refresh tickets"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <div className="relative">
            <button onClick={() => setShowNotifs(v => !v)} className="p-2 rounded-lg hover:bg-slate-700 relative">
              <Bell size={18} />
              {(() => { const c = buildNotifications(tickets, 'employee').length; return c > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-xs flex items-center justify-center">{c}</span>
              ) : null; })()}
            </button>
            {showNotifs && (
              <NotificationPanel
                notifications={buildNotifications(tickets, 'employee')}
                onClose={() => setShowNotifs(false)}
              />
            )}
          </div>
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">

        {/* Agent solution awaiting feedback — prominent alert */}
        {awaitingFeedback.length > 0 && (
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-center gap-2 mb-3">
              <Bell size={16} className="text-blue-400" />
              <p className="text-blue-400 font-semibold text-sm">
                {awaitingFeedback.length === 1
                  ? 'Your agent submitted a solution — please review it'
                  : `${awaitingFeedback.length} tickets have agent solutions waiting for your feedback`}
              </p>
            </div>
            <div className="space-y-2">
              {awaitingFeedback.map(t => (
                <Link
                  key={t._id}
                  to={`/tickets/${t._id}`}
                  className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg border border-blue-500/20 hover:border-blue-500/60 transition-colors"
                >
                  <span className="font-mono text-blue-400 text-xs">{t.ticketId}</span>
                  <span className="flex-1 text-sm text-slate-200 truncate">{t.issue}</span>
                  <span className="text-xs text-blue-400 flex-shrink-0">View solution →</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="grid md:grid-cols-2 gap-4">
          <Link
            to="/chat"
            className="flex items-center gap-4 p-5 bg-slate-800 rounded-xl border border-slate-700 hover:border-blue-500 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
              <MessageCircle size={24} className="text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold">Chat with IT Assistant</h3>
              <p className="text-slate-400 text-sm">AI-powered support before raising a ticket</p>
            </div>
          </Link>
          <Link
            to="/tickets/new"
            className="flex items-center gap-4 p-5 bg-slate-800 rounded-xl border border-slate-700 hover:border-emerald-500 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
              <PlusCircle size={24} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold">Raise New Ticket</h3>
              <p className="text-slate-400 text-sm">Create a support ticket directly</p>
            </div>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={AlertCircle}  label="Open"        value={open.length}       color="bg-blue-600" />
          <StatCard icon={Loader2}      label="In Progress" value={inProgress.length}  color="bg-amber-600" />
          <StatCard icon={TrendingUp}   label="Escalated"   value={escalated.length}   color="bg-red-600" />
          <StatCard icon={CheckCircle2} label="Resolved"    value={resolved.length}    color="bg-emerald-600" />
        </div>

        {/* Active tickets */}
        <div className="bg-slate-800 rounded-xl border border-slate-700">
          <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
            <h3 className="font-semibold">Active Tickets ({active.length})</h3>
            <Link to="/tickets" className="text-blue-400 text-sm hover:text-blue-300">View all →</Link>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-400">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              Loading tickets...
            </div>
          ) : active.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm">No active tickets right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {active.slice(0, 8).map(t => {
                const hasSolution = !!t.agentSolution?.text && t.userFeedback?.satisfied === undefined;
                return (
                  <Link
                    key={t._id}
                    to={`/tickets/${t._id}`}
                    className={`flex items-center gap-4 px-5 py-3.5 hover:bg-slate-700/40 transition-colors ${
                      hasSolution ? 'bg-blue-500/5' : ''
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-slate-400'}`} />
                    <span className="font-mono text-blue-400 text-xs w-24 flex-shrink-0">{t.ticketId}</span>
                    <span className="flex-1 text-sm text-slate-200 truncate">{t.issue}</span>
                    {hasSolution && (
                      <span className="text-xs text-blue-400 flex-shrink-0 hidden md:block">
                        Solution ready ✓
                      </span>
                    )}
                    <span className="text-xs text-slate-500 hidden md:block flex-shrink-0">{t.category}</span>
                    <Badge status={t.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Resolved */}
        {resolved.length > 0 && (
          <div className="bg-slate-800 rounded-xl border border-slate-700">
            <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-semibold text-emerald-400">Resolved ({resolved.length})</h3>
              <Link to="/tickets" className="text-blue-400 text-sm hover:text-blue-300">View all →</Link>
            </div>
            <div className="divide-y divide-slate-700/50">
              {resolved.slice(0, 4).map(t => (
                <Link
                  key={t._id}
                  to={`/tickets/${t._id}`}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-700/40 transition-colors opacity-75 hover:opacity-100"
                >
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <span className="font-mono text-emerald-400 text-xs w-24 flex-shrink-0">{t.ticketId}</span>
                  <span className="flex-1 text-sm text-slate-300 truncate">{t.issue}</span>
                  <span className="text-xs text-slate-500 flex-shrink-0">
                    {t.resolvedAt ? new Date(t.resolvedAt).toLocaleDateString() : ''}
                  </span>
                  <Badge status="Resolved" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}