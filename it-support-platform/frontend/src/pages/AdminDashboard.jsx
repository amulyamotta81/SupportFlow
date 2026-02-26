import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Home, Users, Ticket, BarChart3, Brain, Settings, Bell, LogOut, RefreshCw } from 'lucide-react';

function SyncAIButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const sync = async () => {
    setLoading(true);
    setMsg('');
    try {
      const { data } = await api.post('/admin/sync-ai');
      setMsg(data.message || `Synced ${data.count} tickets`);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Sync failed');
    }
    setLoading(false);
  };
  return (
    <div>
      <button onClick={sync} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50">
        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> {loading ? 'Syncing...' : 'Sync Knowledge Base'}
      </button>
      {msg && <p className="mt-2 text-sm text-slate-400">{msg}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [activeSection, setActiveSection] = useState('dashboard');
  const [analytics, setAnalytics] = useState(null);
  const [agents, setAgents] = useState([]);
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    api.get('/users/analytics/overview').then(res => setAnalytics(res.data));
    api.get('/users').then(res => setAgents(res.data.filter(u => u.role === 'agent')));
    api.get('/tickets/all').then(res => setTickets(res.data));
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h2 className="font-bold">Admin Panel</h2>
          <p className="text-slate-400 text-sm">{user?.name}</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button onClick={() => setActiveSection('dashboard')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'dashboard' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <Home size={18} /> Dashboard
          </button>
          <button onClick={() => setActiveSection('users')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'users' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <Users size={18} /> Users
          </button>
          <button onClick={() => setActiveSection('tickets')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'tickets' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <Ticket size={18} /> Tickets
          </button>
          <button onClick={() => setActiveSection('analytics')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'analytics' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <BarChart3 size={18} /> Analytics
          </button>
          <button onClick={() => setActiveSection('ai')} className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg ${activeSection === 'ai' ? 'bg-blue-600' : 'hover:bg-slate-700'}`}>
            <Brain size={18} /> AI / RAG
          </button>
          <button className="w-full flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-slate-700">
            <Settings size={18} /> Settings
          </button>
        </nav>
        <div className="p-4 border-t border-slate-700">
          <Link to="/" onClick={logout} className="flex items-center gap-2 text-slate-400 hover:text-white">
            <LogOut size={18} /> Logout
          </Link>
        </div>
      </aside>
      <div className="flex-1 flex flex-col">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Admin Dashboard</h1>
          <button className="p-2 rounded-lg hover:bg-slate-700">
            <Bell size={24} />
          </button>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'dashboard' && analytics && (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <p className="text-slate-400 text-sm">Total Tickets</p>
                <p className="text-3xl font-bold">{analytics.totalTickets}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <p className="text-slate-400 text-sm">Resolved</p>
                <p className="text-3xl font-bold text-green-500">{analytics.resolvedTickets}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <p className="text-slate-400 text-sm">Agents</p>
                <p className="text-3xl font-bold">{analytics.agentCount}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <p className="text-slate-400 text-sm">Resolution Rate</p>
                <p className="text-3xl font-bold">{analytics.resolutionRate}%</p>
              </div>
            </div>
          )}
          {activeSection === 'dashboard' && analytics && (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h3 className="font-semibold mb-4">Tickets by Category</h3>
                <ul className="space-y-2">
                  {(analytics.byCategory || []).map((c, i) => (
                    <li key={i} className="flex justify-between"><span>{c._id}</span><span>{c.count}</span></li>
                  ))}
                </ul>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h3 className="font-semibold mb-4">Tickets by Priority</h3>
                <ul className="space-y-2">
                  {(analytics.byPriority || []).map((p, i) => (
                    <li key={i} className="flex justify-between"><span>{p._id}</span><span>{p.count}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {activeSection === 'users' && (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-semibold mb-4">Agent Management</h3>
              <table className="w-full">
                <thead><tr className="text-left text-slate-400"><th className="pb-2">Name</th><th className="pb-2">Skills</th><th className="pb-2">Workload</th></tr></thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a._id} className="border-t border-slate-700">
                      <td className="py-3">{a.name}</td>
                      <td className="py-3">{(a.skills || []).join(', ')}</td>
                      <td className="py-3">{a.workload || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeSection === 'tickets' && (
            <div className="space-y-2">
              {tickets.slice(0, 20).map(t => (
                <Link key={t._id} to={`/tickets/${t._id}`} className="block p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-blue-500">
                  <span className="font-mono text-blue-400">{t.ticketId}</span> {t.issue} – {t.status}
                </Link>
              ))}
              <Link to="/tickets" className="block text-blue-400 text-sm mt-4">View all tickets →</Link>
            </div>
          )}
          {activeSection === 'analytics' && analytics && (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-semibold mb-4">Analytics Overview</h3>
              <p className="text-slate-400">Filter by time range, category, agent. Drill down into tickets from charts.</p>
              <div className="mt-6 grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm text-slate-400 mb-2">By Category</h4>
                  <ul className="space-y-1">{(analytics.byCategory || []).map((c, i) => <li key={i}>{c._id}: {c.count}</li>)}</ul>
                </div>
                <div>
                  <h4 className="text-sm text-slate-400 mb-2">By Priority</h4>
                  <ul className="space-y-1">{(analytics.byPriority || []).map((p, i) => <li key={i}>{p._id}: {p.count}</li>)}</ul>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'ai' && (
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-semibold mb-4">AI / RAG Knowledge Base Management</h3>
              <p className="text-slate-400 mb-4">Sync resolved tickets to the AI for dynamic suggestions. Run after new tickets are resolved.</p>
              <div className="space-y-4">
                <SyncAIButton />
                <div className="p-4 bg-slate-700 rounded-lg">
                  <p className="text-sm">Resolved tickets from MongoDB are used to build the FAISS index. Chat suggestions and ticket analysis use real past resolutions.</p>
                </div>
                <p className="text-slate-400 text-sm">AI Service: FastAPI + FAISS + Sentence Transformers for RAG-based ticket classification.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
