import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  Home, List, Brain, Bell, LogOut, RefreshCw,
  ThumbsDown, MessageSquare, AlertTriangle, CheckCircle2
} from 'lucide-react';

const STATUS_STYLE = {
  'Open':        'bg-blue-500/15 text-blue-300',
  'In Progress': 'bg-amber-500/15 text-amber-300',
  'Resolved':    'bg-emerald-500/15 text-emerald-300',
  'Escalated':   'bg-red-500/15 text-red-300',
};

const PRIORITY_DOT = {
  Critical: 'bg-red-400', High: 'bg-orange-400', Medium: 'bg-amber-400', Low: 'bg-slate-500'
};

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [activeSection, setActiveSection] = useState('dashboard');
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) return;
    setRefreshing(true);
    try {
      const res = await api.get('/tickets');
      setTickets(res.data);
    } catch (e) { console.error(e); }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    api.get('/tickets').then(res => {
      setTickets(res.data);
      // Notifications: SLA breaches + user replies needing attention
      const alerts = [];
      res.data.forEach(t => {
        if (t.slaDeadline && new Date(t.slaDeadline) < new Date(Date.now() + 2 * 60 * 60 * 1000) && t.status !== 'Resolved')
          alerts.push({ type: 'SLA', label: `SLA soon: ${t.ticketId}`, ticket: t });
        if (t.userFeedback?.satisfied === false)
          alerts.push({ type: 'REPLY', label: `User replied: ${t.ticketId}`, ticket: t });
      });
      setNotifications(alerts.slice(0, 8));
    });
    const interval = setInterval(() => fetchTickets(true), 30000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  const needsAttention = tickets.filter(t =>
    t.userFeedback?.satisfied === false ||
    (t.status === 'Open' && !t.agentSolution?.text)
  );

  const high   = tickets.filter(t => ['High','Critical'].includes(t.priority) && t.status !== 'Resolved');
  const medium = tickets.filter(t => t.priority === 'Medium' && t.status !== 'Resolved');
  const low    = tickets.filter(t => t.priority === 'Low' && t.status !== 'Resolved');

  const TicketRow = ({ t }) => {
    const userReplied   = t.userFeedback?.satisfied === false;
    const hasSolution   = !!t.agentSolution?.text;
    const userConfirmed = t.userFeedback?.satisfied === true;

    return (
      <Link
        to={`/tickets/${t._id}`}
        className={`flex items-center gap-3 p-3.5 rounded-lg border transition-all hover:border-blue-500 ${
          userReplied ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-800 border-slate-700'
        }`}
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-slate-500'}`} />
        <span className="font-mono text-blue-400 text-xs w-24 flex-shrink-0">{t.ticketId}</span>
        <span className="flex-1 text-sm text-slate-200 truncate">{t.issue}</span>

        {/* Status indicators */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {userReplied && (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
              <ThumbsDown size={10} /> User replied
            </span>
          )}
          {userConfirmed && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 size={11} /> Confirmed
            </span>
          )}
          {!hasSolution && t.status !== 'Resolved' && (
            <span className="text-xs text-slate-500">No solution yet</span>
          )}
          {hasSolution && !userReplied && !userConfirmed && t.status !== 'Resolved' && (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <MessageSquare size={10} /> Awaiting user
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[t.status] || ''}`}>
            {t.status}
          </span>
        </div>
      </Link>
    );
  };

  const NavBtn = ({ section, icon: Icon, label }) => (
    <button
      onClick={() => setActiveSection(section)}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm transition-colors ${
        activeSection === section ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
      }`}
    >
      <Icon size={17} /> {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-800 border-r border-slate-700 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-bold text-sm">Agent Dashboard</h2>
          <p className="text-slate-400 text-xs mt-0.5">{user?.name}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavBtn section="dashboard" icon={Home}  label="Dashboard" />
          <NavBtn section="tickets"   icon={List}  label="My Tickets" />
          <NavBtn section="ai"        icon={Brain} label="AI Panel" />
          {needsAttention.length > 0 && (
            <NavBtn section="attention" icon={AlertTriangle} label={`Needs Attention (${needsAttention.length})`} />
          )}
        </nav>
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 text-sm transition-colors"
          >
            <LogOut size={17} /> Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center flex-shrink-0">
          <h1 className="font-bold">Welcome, {user?.name}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTickets(true)}
              disabled={refreshing}
              className="p-2 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotifs(v => !v)}
                className="p-2 rounded-lg hover:bg-slate-700 relative"
              >
                <Bell size={20} />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-xs flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute right-0 top-11 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                  <p className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase border-b border-slate-700">
                    Notifications
                  </p>
                  {notifications.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-500">All clear!</p>
                  ) : notifications.map((n, i) => (
                    <Link
                      key={i}
                      to={`/tickets/${n.ticket._id}`}
                      onClick={() => setShowNotifs(false)}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-700 border-b border-slate-700/50 text-sm ${
                        n.type === 'REPLY' ? 'text-amber-300' : 'text-red-300'
                      }`}
                    >
                      {n.type === 'REPLY' ? <ThumbsDown size={14} /> : <AlertTriangle size={14} />}
                      {n.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">

          {/* Needs Attention banner */}
          {needsAttention.length > 0 && activeSection === 'dashboard' && (
            <div className="mb-5 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <p className="text-amber-400 font-semibold text-sm mb-2 flex items-center gap-2">
                <AlertTriangle size={16} /> {needsAttention.length} ticket{needsAttention.length > 1 ? 's' : ''} need your attention
              </p>
              <div className="space-y-1.5">
                {needsAttention.slice(0, 3).map(t => (
                  <Link
                    key={t._id}
                    to={`/tickets/${t._id}`}
                    className="flex items-center gap-3 text-sm hover:text-amber-300 transition-colors"
                  >
                    <span className="font-mono text-blue-400">{t.ticketId}</span>
                    <span className="text-slate-300 truncate">{t.issue}</span>
                    {t.userFeedback?.satisfied === false && (
                      <span className="text-amber-400 text-xs flex-shrink-0">← User replied</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'dashboard' && (
            <div className="space-y-6">
              <Section title={`High / Critical (${high.length})`} tickets={high} Row={TicketRow} />
              <Section title={`Medium (${medium.length})`} tickets={medium} Row={TicketRow} />
              <Section title={`Low (${low.length})`} tickets={low} Row={TicketRow} />
            </div>
          )}

          {activeSection === 'tickets' && (
            <div className="space-y-2">
              <h3 className="font-semibold mb-3">All My Tickets ({tickets.length})</h3>
              {tickets.map(t => <TicketRow key={t._id} t={t} />)}
              {tickets.length === 0 && <p className="text-slate-500">No tickets assigned.</p>}
            </div>
          )}

          {activeSection === 'attention' && (
            <div className="space-y-2">
              <h3 className="font-semibold mb-3 text-amber-400">Needs Attention ({needsAttention.length})</h3>
              {needsAttention.map(t => <TicketRow key={t._id} t={t} />)}
            </div>
          )}

          {activeSection === 'ai' && (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-semibold mb-2">AI Recommendations</h3>
              <p className="text-slate-400 text-sm mb-4">
                Tickets where AI confidence is high — review AI suggestions before submitting your solution.
              </p>
              <div className="space-y-2">
                {tickets.filter(t => (t.aiAnalysis?.confidence || 0) >= 0.8 && t.status !== 'Resolved')
                  .map(t => <TicketRow key={t._id} t={t} />)}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Section({ title, tickets, Row }) {
  return (
    <div>
      <h3 className="font-semibold mb-3 text-slate-300">{title}</h3>
      <div className="space-y-2">
        {tickets.slice(0, 6).map(t => <Row key={t._id} t={t} />)}
        {tickets.length === 0 && <p className="text-slate-600 text-sm">None</p>}
      </div>
    </div>
  );
}