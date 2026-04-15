import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Home, List, Brain, Settings, Bell, LogOut, CheckCircle2, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import NotificationPanel, { buildNotifications } from '../components/NotificationPanel';

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [activeSection, setActiveSection] = useState('dashboard');
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [statusFilter, setStatusFilter]     = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');

  useEffect(() => {
    api.get('/tickets').then(res => {
      setTickets(res.data);
      const slaAlerts = res.data.filter(t => t.status !== 'Resolved' && t.slaDeadline && new Date(t.slaDeadline) < new Date(Date.now() + 2 * 60 * 60 * 1000));
      setNotifications(slaAlerts.slice(0, 5).map(t => ({ type: 'SLA', ticket: t })));
    });
  }, []);

  const high = tickets.filter(t => t.priority === 'High' || t.priority === 'Critical');
  const medium = tickets.filter(t => t.priority === 'Medium');
  const low = tickets.filter(t => t.priority === 'Low');

  const openCount       = tickets.filter(t => t.status === 'Open').length;
  const inProgressCount = tickets.filter(t => t.status === 'In Progress').length;
  const resolvedCount   = tickets.filter(t => t.status === 'Resolved').length;
  const escalatedCount  = tickets.filter(t => t.status === 'Escalated').length;

  const STATUS_COLORS = { Open: '#3b82f6', 'In Progress': '#f59e0b', Resolved: '#10b981', Escalated: '#ef4444' };
  const statusData = [
    { name: 'Open', value: openCount },
    { name: 'In Progress', value: inProgressCount },
    { name: 'Resolved', value: resolvedCount },
    { name: 'Escalated', value: escalatedCount },
  ].filter(d => d.value > 0);

  const TicketRow = ({ t }) => {
    const rawConf = t.aiAnalysis?.confidence;
    const conf = rawConf != null ? (rawConf > 1 ? rawConf.toFixed(2) : (rawConf * 100).toFixed(2)) : null;
    return (
      <Link to={`/tickets/${t._id}`} className="block p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-blue-500 mb-2">
        <div className="flex justify-between">
          <span className="font-mono text-blue-400">{t.ticketId}</span>
          <span className={`px-2 py-0.5 rounded text-xs ${t.priority === 'Critical' ? 'bg-red-900' : t.priority === 'High' ? 'bg-orange-900' : 'bg-slate-700'}`}>
            {t.priority}
          </span>
        </div>
        <p className="text-slate-300 mt-1 truncate">{t.issue}</p>
        <p className="text-slate-500 text-sm mt-1">
          {conf != null ? `AI: ${conf}% | ` : ''}{t.category}
        </p>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-bold">Agent Dashboard</h2>
          <p className="text-slate-400 text-sm">{user?.name}</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button onClick={() => setActiveSection('dashboard')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'dashboard' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <Home size={18} /> Dashboard
          </button>
          <button onClick={() => setActiveSection('tickets')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'tickets' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <List size={18} /> My Tickets
          </button>
          <button onClick={() => setActiveSection('ai')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'ai' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <Brain size={18} /> AI Panel
          </button>
          {user?.role === 'admin' && (
            <Link to="/admin" className="w-full flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-700">
              <Settings size={18} /> Admin
            </Link>
          )}
        </nav>
        <div className="p-4 border-t border-slate-700">
          <Link to="/" onClick={logout} className="flex items-center gap-2 text-slate-400 hover:text-white">
            <LogOut size={18} /> Logout
          </Link>
        </div>
      </aside>
      <div className="flex-1 flex flex-col">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Welcome, {user?.name}</h1>
          <div className="relative">
            <button onClick={() => setShowNotifs(v => !v)} className="p-2 rounded-lg hover:bg-slate-700">
              <Bell size={24} />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">{notifications.length}</span>
              )}
            </button>
            {showNotifs && (
              <NotificationPanel
                notifications={buildNotifications(tickets, 'agent')}
                onClose={() => setShowNotifs(false)}
              />
            )}
          </div>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'dashboard' && (
            <div className="space-y-6">
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center"><Clock size={18} /></div>
                  <div><p className="text-xl font-bold">{openCount}</p><p className="text-slate-400 text-xs">Open</p></div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-600 flex items-center justify-center"><Loader2 size={18} /></div>
                  <div><p className="text-xl font-bold">{inProgressCount}</p><p className="text-slate-400 text-xs">In Progress</p></div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center"><CheckCircle2 size={18} /></div>
                  <div><p className="text-xl font-bold">{resolvedCount}</p><p className="text-slate-400 text-xs">Resolved</p></div>
                </div>
                <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center"><AlertTriangle size={18} /></div>
                  <div><p className="text-xl font-bold">{escalatedCount}</p><p className="text-slate-400 text-xs">Escalated</p></div>
                </div>
              </div>

              {/* Status chart */}
              {statusData.length > 0 && (
                <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                  <h3 className="font-semibold mb-3 text-sm">My Ticket Status</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                        {statusData.map((s, i) => (
                          <Cell key={i} fill={STATUS_COLORS[s.name] || '#6b7280'} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#334155', border: '1px solid #475569', borderRadius: 8, fontSize: 12 }} />
                      <Legend formatter={v => <span className="text-slate-300 text-xs">{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Priority ticket lists */}
              <div>
                <h3 className="font-semibold mb-4">High Priority Tickets</h3>
                <div className="space-y-2">
                  {high.slice(0, 5).map(t => <TicketRow key={t._id} t={t} />)}
                  {high.length === 0 && <p className="text-slate-400">No high priority tickets</p>}
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-4">Medium Priority Tickets</h3>
                <div className="space-y-2">
                  {medium.slice(0, 5).map(t => <TicketRow key={t._id} t={t} />)}
                  {medium.length === 0 && <p className="text-slate-400">No medium priority tickets</p>}
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-4">Low Priority Tickets</h3>
                <div className="space-y-2">
                  {low.slice(0, 5).map(t => <TicketRow key={t._id} t={t} />)}
                  {low.length === 0 && <p className="text-slate-400">No low priority tickets</p>}
                </div>
              </div>
            </div>
          )}
          {activeSection === 'tickets' && (() => {
            const filtered = tickets.filter(t => {
              if (statusFilter !== 'All' && t.status !== statusFilter) return false;
              if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;
              return true;
            });
            return (
              <div className="space-y-3">
                <h3 className="font-semibold">My Tickets ({filtered.length})</h3>

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

                <div className="space-y-2">
                  {filtered.length === 0 ? (
                    <p className="text-slate-500 text-sm p-4 text-center">No tickets match the selected filters.</p>
                  ) : (
                    filtered.map(t => <TicketRow key={t._id} t={t} />)
                  )}
                </div>
              </div>
            );
          })()}
          {activeSection === 'ai' && (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-semibold mb-4">AI Recommendations</h3>
              <p className="text-slate-400">Tickets suggested by AI for your attention. Click any ticket to view full AI analysis and similar past tickets.</p>
              <div className="mt-4 space-y-2">
                {tickets.filter(t => t.aiAnalysis?.confidence > 0.9).slice(0, 5).map(t => <TicketRow key={t._id} t={t} />)}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
