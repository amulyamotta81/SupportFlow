import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  Home, Users, Ticket, BarChart3, Brain, Bell, LogOut,
  RefreshCw, AlertTriangle, CheckCircle2, ThumbsDown, Database
} from 'lucide-react';

const STATUS_STYLE = {
  'Open':        'bg-blue-500/15 text-blue-300',
  'In Progress': 'bg-amber-500/15 text-amber-300',
  'Resolved':    'bg-emerald-500/15 text-emerald-300',
  'Escalated':   'bg-red-500/15 text-red-300',
};

function SyncAIButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const sync = async () => {
    setLoading(true); setMsg('');
    try {
      const { data } = await api.get('/kb/stats', { baseURL: 'http://localhost:8000/api' })
        .catch(() => api.post('/admin/sync-ai'));
      setMsg(`KB ready — ${data.total_vectors || data.count || '?'} vectors`);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Check AI service is running');
    }
    setLoading(false);
  };
  return (
    <div>
      <button
        onClick={sync}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm disabled:opacity-50 transition-colors"
      >
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        {loading ? 'Checking...' : 'Check KB Status'}
      </button>
      {msg && <p className="mt-2 text-sm text-slate-400">{msg}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('dashboard');
  const [analytics, setAnalytics]   = useState(null);
  const [agents, setAgents]         = useState([]);
  const [tickets, setTickets]       = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const [ana, ags, tix] = await Promise.all([
        api.get('/users/analytics/overview'),
        api.get('/users'),
        api.get('/tickets/all'),
      ]);
      setAnalytics(ana.data);
      setAgents(ags.data.filter(u => u.role === 'agent'));
      setTickets(tix.data);
    } catch (e) { console.error(e); }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(true), 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const escalated  = tickets.filter(t => t.status === 'Escalated');
  const userReplied = tickets.filter(t => t.userFeedback?.satisfied === false);
  const alertCount = escalated.length + userReplied.length;

  const NavBtn = ({ section, icon: Icon, label, badge }) => (
    <button
      onClick={() => setActiveSection(section)}
      className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm transition-colors ${
        activeSection === section ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-white'
      }`}
    >
      <span className="flex items-center gap-2.5"><Icon size={17} />{label}</span>
      {badge > 0 && (
        <span className="bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );

  const TicketRow = ({ t }) => (
    <Link
      to={`/tickets/${t._id}`}
      className={`flex items-center gap-3 p-3.5 rounded-lg border transition-all hover:border-blue-500 ${
        t.userFeedback?.satisfied === false
          ? 'bg-amber-500/5 border-amber-500/30'
          : t.status === 'Escalated'
          ? 'bg-red-500/5 border-red-500/20'
          : 'bg-slate-800 border-slate-700'
      }`}
    >
      <span className="font-mono text-blue-400 text-xs w-24 flex-shrink-0">{t.ticketId}</span>
      <span className="flex-1 text-sm text-slate-200 truncate">{t.issue}</span>
      <span className="text-xs text-slate-500 hidden md:block">{t.userId?.name}</span>
      {t.userFeedback?.satisfied === false && (
        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30 flex-shrink-0">
          <ThumbsDown size={10} /> User replied
        </span>
      )}
      <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ${STATUS_STYLE[t.status] || ''}`}>
        {t.status}
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      <aside className="w-60 bg-slate-800 border-r border-slate-700 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-bold text-sm">Admin Panel</h2>
          <p className="text-slate-400 text-xs mt-0.5">{user?.name}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavBtn section="dashboard"   icon={Home}          label="Dashboard" />
          <NavBtn section="users"       icon={Users}         label="Users" />
          <NavBtn section="tickets"     icon={Ticket}        label="All Tickets" />
          <NavBtn section="escalations" icon={AlertTriangle} label="Escalations" badge={escalated.length} />
          <NavBtn section="analytics"   icon={BarChart3}     label="Analytics" />
          <NavBtn section="ai"          icon={Brain}         label="AI / KB" />
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

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center flex-shrink-0">
          <h1 className="font-bold">Admin Dashboard</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchAll(true)}
              disabled={refreshing}
              className="p-2 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button className="p-2 rounded-lg hover:bg-slate-700 relative">
              <Bell size={20} />
              {alertCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-xs flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">

          {/* DASHBOARD */}
          {activeSection === 'dashboard' && (
            <div className="space-y-6">
              {analytics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Tickets',   value: analytics.totalTickets,   color: 'text-white' },
                    { label: 'Resolved',         value: analytics.resolvedTickets, color: 'text-emerald-400' },
                    { label: 'Agents',           value: analytics.agentCount,      color: 'text-blue-400' },
                    { label: 'Resolution Rate',  value: `${analytics.resolutionRate}%`, color: 'text-amber-400' },
                  ].map((s, i) => (
                    <div key={i} className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                      <p className="text-slate-400 text-xs mb-1">{s.label}</p>
                      <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Alert banners */}
              {escalated.length > 0 && (
                <div
                  className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 cursor-pointer hover:bg-red-500/15 transition-colors"
                  onClick={() => setActiveSection('escalations')}
                >
                  <p className="text-red-400 font-semibold text-sm flex items-center gap-2">
                    <AlertTriangle size={16} />
                    {escalated.length} escalated ticket{escalated.length > 1 ? 's' : ''} need your resolution
                  </p>
                </div>
              )}
              {userReplied.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-amber-400 font-semibold text-sm flex items-center gap-2 mb-2">
                    <ThumbsDown size={16} />
                    {userReplied.length} user{userReplied.length > 1 ? 's' : ''} replied that solution didn't work
                  </p>
                  <div className="space-y-1">
                    {userReplied.slice(0, 3).map(t => (
                      <Link key={t._id} to={`/tickets/${t._id}`} className="flex items-center gap-2 text-sm hover:text-amber-300 transition-colors">
                        <span className="font-mono text-blue-400">{t.ticketId}</span>
                        <span className="text-slate-400 truncate">{t.issue}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {analytics && (
                <div className="grid md:grid-cols-2 gap-5">
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <h3 className="font-semibold mb-3 text-sm">By Category</h3>
                    <ul className="space-y-2">
                      {(analytics.byCategory || []).map((c, i) => (
                        <li key={i} className="flex justify-between text-sm">
                          <span className="text-slate-300">{c._id}</span>
                          <span className="text-slate-500">{c.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <h3 className="font-semibold mb-3 text-sm">By Priority</h3>
                    <ul className="space-y-2">
                      {(analytics.byPriority || []).map((p, i) => (
                        <li key={i} className="flex justify-between text-sm">
                          <span className="text-slate-300">{p._id}</span>
                          <span className="text-slate-500">{p.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* USERS */}
          {activeSection === 'users' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700">
                <h3 className="font-semibold">Agent Management</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-700/40">
                  <tr className="text-left text-slate-400">
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Skills</th>
                    <th className="px-5 py-3">Workload</th>
                    <th className="px-5 py-3">Success Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {agents.map(a => (
                    <tr key={a._id} className="hover:bg-slate-700/20">
                      <td className="px-5 py-3 font-medium">{a.name}</td>
                      <td className="px-5 py-3 text-slate-400">{a.email}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(a.skills || []).map(s => (
                            <span key={s} className="px-2 py-0.5 bg-slate-700 text-slate-300 text-xs rounded-full">{s}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-300">{a.workload || 0}</td>
                      <td className="px-5 py-3 text-slate-300">{a.successRate ?? 100}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ALL TICKETS */}
          {activeSection === 'tickets' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">All Tickets ({tickets.length})</h3>
              </div>
              {tickets.slice(0, 30).map(t => <TicketRow key={t._id} t={t} />)}
              {tickets.length > 30 && (
                <p className="text-slate-500 text-sm text-center">Showing 30 of {tickets.length}</p>
              )}
            </div>
          )}

          {/* ESCALATIONS */}
          {activeSection === 'escalations' && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-1 text-red-400">Escalated Tickets ({escalated.length})</h3>
                <p className="text-slate-500 text-sm mb-4">
                  Open the ticket to submit your resolution notes. The user will see them immediately.
                  On confirmation, the solution is auto-saved to the KB.
                </p>
                <div className="space-y-2">
                  {escalated.map(t => <TicketRow key={t._id} t={t} />)}
                  {escalated.length === 0 && <p className="text-slate-600 text-sm">No escalated tickets.</p>}
                </div>
              </div>

              {userReplied.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-1 text-amber-400 mt-6">User Replied: Solution Not Working ({userReplied.length})</h3>
                  <p className="text-slate-500 text-sm mb-3">
                    These users tried the agent's solution and said it didn't work. Submit a revised solution.
                  </p>
                  <div className="space-y-2">
                    {userReplied.map(t => <TicketRow key={t._id} t={t} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ANALYTICS */}
          {activeSection === 'analytics' && analytics && (
            <div className="space-y-5">
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <h3 className="font-semibold mb-4">Overview</h3>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-xs text-slate-400 uppercase tracking-wide mb-3">By Category</h4>
                    <ul className="space-y-2">
                      {(analytics.byCategory || []).map((c, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <div className="flex-1 text-sm text-slate-300">{c._id}</div>
                          <div className="w-32 bg-slate-700 rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(100, (c.count / analytics.totalTickets) * 100)}%` }}
                            />
                          </div>
                          <div className="text-xs text-slate-500 w-6 text-right">{c.count}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs text-slate-400 uppercase tracking-wide mb-3">By Priority</h4>
                    <ul className="space-y-2">
                      {(analytics.byPriority || []).map((p, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <div className="flex-1 text-sm text-slate-300">{p._id}</div>
                          <div className="w-32 bg-slate-700 rounded-full h-1.5">
                            <div
                              className="bg-amber-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(100, (p.count / analytics.totalTickets) * 100)}%` }}
                            />
                          </div>
                          <div className="text-xs text-slate-500 w-6 text-right">{p.count}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI / KB */}
          {activeSection === 'ai' && (
            <div className="space-y-5">
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <h3 className="font-semibold mb-1 flex items-center gap-2">
                  <Database size={18} className="text-blue-400" /> Knowledge Base
                </h3>
                <p className="text-slate-400 text-sm mb-4">
                  The KB auto-updates when agents or admins resolve tickets and when users confirm solutions.
                  Run <code className="text-blue-300 bg-slate-700 px-1.5 py-0.5 rounded text-xs">python build_kb.py --verify</code> to see all entries.
                </p>
                <SyncAIButton />
              </div>

              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <h3 className="font-semibold mb-3">How the KB Self-Evolves</h3>
                <div className="space-y-2 text-sm text-slate-400">
                  {[
                    ['Agent resolves ticket', 'Solution saved to KB automatically', 'agent_resolution'],
                    ['Admin resolves escalation', 'High-quality solution saved to KB', 'admin_resolution'],
                    ['User confirms fix worked', 'Solution saved with high confidence', 'user_confirmed'],
                  ].map(([trigger, effect, source], i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-700/40 rounded-lg">
                      <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                      <span className="flex-1"><span className="text-white font-medium">{trigger}</span> → {effect}</span>
                      <code className="text-xs text-blue-300 bg-slate-700 px-2 py-0.5 rounded">{source}</code>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
