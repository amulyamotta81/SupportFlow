import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import {
  Home, Users, Ticket, BarChart3, Brain, Bell, LogOut,
  RefreshCw, AlertTriangle, CheckCircle2, ThumbsDown, Database, Search
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import NotificationPanel, { buildNotifications } from '../components/NotificationPanel';

const STATUS_STYLE = {
  'Open':        'bg-blue-500/15 text-blue-300',
  'In Progress': 'bg-amber-500/15 text-amber-300',
  'Resolved':    'bg-emerald-500/15 text-emerald-300',
  'Escalated':   'bg-red-500/15 text-red-300',
};

const CATEGORY_COLORS = ['#3b82f6','#8b5cf6','#06b6d4','#f59e0b','#10b981','#ef4444','#ec4899','#6b7280'];
const STATUS_COLORS   = { Open: '#3b82f6', 'In Progress': '#f59e0b', Resolved: '#10b981', Escalated: '#ef4444' };
const PRIORITY_COLORS = { Low: '#94a3b8', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444' };

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-white font-medium">{d.name || d.payload?._id || d.payload?.name}</p>
      <p className="text-slate-300">{d.value} ticket{d.value !== 1 ? 's' : ''}</p>
    </div>
  );
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
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [statusFilter, setStatusFilter]     = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');

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

  // Filter tickets by search query, status, and priority
  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (t.ticketId || '').toLowerCase().includes(q) ||
        (t.issue || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.userId?.name || '').toLowerCase().includes(q) ||
        (t.userId?.email || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

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
      <span className="text-xs text-slate-500 hidden md:block w-20 flex-shrink-0">{t.category}</span>
      <span className="text-xs text-slate-500 hidden md:block flex-shrink-0">{t.userId?.name}</span>
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
            <div className="relative">
              <button onClick={() => setShowNotifs(v => !v)} className="p-2 rounded-lg hover:bg-slate-700 relative">
                <Bell size={20} />
                {alertCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-xs flex items-center justify-center">
                    {alertCount}
                  </span>
                )}
              </button>
              {showNotifs && (
                <NotificationPanel
                  notifications={buildNotifications(tickets, 'admin')}
                  onClose={() => setShowNotifs(false)}
                />
              )}
            </div>
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
                  {/* Status Distribution Pie */}
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <h3 className="font-semibold mb-3 text-sm">Status Distribution</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={(analytics.byStatus || []).map(s => ({ name: s._id, value: s.count }))}
                          cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                          dataKey="value" paddingAngle={3}
                        >
                          {(analytics.byStatus || []).map((s, i) => (
                            <Cell key={i} fill={STATUS_COLORS[s._id] || '#6b7280'} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                        <Legend formatter={v => <span className="text-slate-300 text-xs">{v}</span>} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Priority Bar Chart */}
                  <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                    <h3 className="font-semibold mb-3 text-sm">By Priority</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={(analytics.byPriority || []).map(p => ({ name: p._id, count: p.count }))} barSize={36}>
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                          {(analytics.byPriority || []).map((p, i) => (
                            <Cell key={i} fill={PRIORITY_COLORS[p._id] || '#6b7280'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
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

          {/* ALL TICKETS — with search + filters */}
          {activeSection === 'tickets' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-semibold flex-shrink-0">All Tickets ({filteredTickets.length})</h3>
                <div className="relative flex-1 max-w-md">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by Ticket ID (TKT-00001), issue, category, or user..."
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Status + Priority filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 mr-1">Status:</span>
                {['All', 'Open', 'In Progress', 'Resolved', 'Escalated'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      statusFilter === s
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <span className="text-slate-700 mx-1">|</span>
                <span className="text-xs text-slate-500 mr-1">Priority:</span>
                {['All', 'Critical', 'High', 'Medium', 'Low'].map(p => (
                  <button
                    key={p}
                    onClick={() => setPriorityFilter(p)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      priorityFilter === p
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {filteredTickets.length === 0 && searchQuery ? (
                <div className="p-8 text-center text-slate-500">
                  <Search size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No tickets found matching "{searchQuery}"</p>
                </div>
              ) : (
                <>
                  {filteredTickets.slice(0, 50).map(t => <TicketRow key={t._id} t={t} />)}
                  {filteredTickets.length > 50 && (
                    <p className="text-slate-500 text-sm text-center">Showing 50 of {filteredTickets.length}</p>
                  )}
                </>
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
              {/* Row 1: Category Pie + Priority Bar */}
              <div className="grid md:grid-cols-2 gap-5">
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <h3 className="font-semibold mb-4 text-sm">Tickets by Category</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={(analytics.byCategory || []).map(c => ({ name: c._id, value: c.count }))}
                        cx="50%" cy="50%" outerRadius={90}
                        dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {(analytics.byCategory || []).map((_, i) => (
                          <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <h3 className="font-semibold mb-4 text-sm">Tickets by Priority</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={(analytics.byPriority || []).map(p => ({ name: p._id, count: p.count }))} barSize={44}>
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {(analytics.byPriority || []).map((p, i) => (
                          <Cell key={i} fill={PRIORITY_COLORS[p._id] || '#6b7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Row 2: Status Distribution */}
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <h3 className="font-semibold mb-4 text-sm">Status Distribution</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={(analytics.byStatus || []).map(s => ({ name: s._id, count: s.count }))} barSize={52}>
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {(analytics.byStatus || []).map((s, i) => (
                        <Cell key={i} fill={STATUS_COLORS[s._id] || '#6b7280'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* AI / KB */}
          {activeSection === 'ai' && (() => {
            // Tickets where the user confirmed the fix worked → solution went into FAISS
            const kbTickets = tickets.filter(t =>
              t.status === 'Resolved' && t.resolution && t.userFeedback?.satisfied === true
            ).sort((a, b) => new Date(b.resolvedAt || b.updatedAt || 0) - new Date(a.resolvedAt || a.updatedAt || 0));

            return (
              <div className="space-y-5">
                {/* KB status + refresh */}
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Database size={18} className="text-blue-400" /> Knowledge Base
                    </h3>
                    <SyncAIButton />
                  </div>
                  <p className="text-slate-400 text-sm">
                    The KB auto-updates when tickets are resolved. {kbTickets.length} resolved ticket{kbTickets.length !== 1 ? 's' : ''} have contributed solutions to the FAISS knowledge base.
                  </p>
                </div>

                {/* Tickets that fed into KB */}
                <div className="bg-slate-800 rounded-xl border border-slate-700">
                  <div className="px-5 py-4 border-b border-slate-700">
                    <h3 className="font-semibold text-sm">Tickets That Updated the KB ({kbTickets.length})</h3>
                    <p className="text-slate-500 text-xs mt-0.5">Solutions from these tickets are now in the FAISS vector store and used for future AI responses.</p>
                  </div>
                  {kbTickets.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">No resolved tickets yet. KB entries will appear here once tickets are resolved.</div>
                  ) : (
                    <div className="divide-y divide-slate-700/50 max-h-[32rem] overflow-y-auto">
                      {kbTickets.map(t => (
                        <Link
                          key={t._id}
                          to={`/tickets/${t._id}`}
                          className="flex items-start gap-4 px-5 py-4 hover:bg-slate-700/30 transition-colors"
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 size={10} /> User Confirmed
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-blue-400 text-xs">{t.ticketId}</span>
                              <span className="text-xs text-slate-500">{t.category}</span>
                              <span className="text-xs text-slate-600">
                                {t.resolvedAt ? new Date(t.resolvedAt).toLocaleDateString() : ''}
                              </span>
                            </div>
                            <p className="text-sm text-slate-300 truncate">{t.issue}</p>
                            <p className="text-xs text-slate-500 mt-1 truncate">
                              Solution: {t.resolution}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </main>
      </div>
    </div>
  );
}
