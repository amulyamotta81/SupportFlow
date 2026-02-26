import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Home, List, Brain, Settings, Bell, LogOut } from 'lucide-react';

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [activeSection, setActiveSection] = useState('dashboard');
  const [notifications, setNotifications] = useState([]);

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

  const TicketRow = ({ t }) => (
    <Link to={`/tickets/${t._id}`} className="block p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-blue-500 mb-2">
      <div className="flex justify-between">
        <span className="font-mono text-blue-400">{t.ticketId}</span>
        <span className={`px-2 py-0.5 rounded text-xs ${t.priority === 'Critical' ? 'bg-red-900' : t.priority === 'High' ? 'bg-orange-900' : 'bg-slate-700'}`}>{t.priority}</span>
      </div>
      <p className="text-slate-300 mt-1 truncate">{t.issue}</p>
      <p className="text-slate-500 text-sm mt-1">AI: {(t.aiAnalysis?.confidence || 0) * 100}% | {t.category}</p>
    </Link>
  );

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
            <button className="p-2 rounded-lg hover:bg-slate-700">
              <Bell size={24} />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">{notifications.length}</span>
              )}
            </button>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'dashboard' && (
            <div className="space-y-6">
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
          {activeSection === 'tickets' && (
            <div>
              <h3 className="font-semibold mb-4">All My Tickets ({tickets.length})</h3>
              <div className="space-y-2">
                {tickets.map(t => <TicketRow key={t._id} t={t} />)}
              </div>
            </div>
          )}
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
