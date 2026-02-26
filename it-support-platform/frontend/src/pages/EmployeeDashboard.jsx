import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MessageCircle, PlusCircle, List, LogOut } from 'lucide-react';
import { useState, useEffect } from 'react';
import api from '../services/api';

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    api.get('/tickets').then(res => setTickets(res.data));
  }, []);

  const open = tickets.filter(t => t.status !== 'Resolved');
  const resolved = tickets.filter(t => t.status === 'Resolved');

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Employee Dashboard</h1>
        <div className="flex items-center gap-4">
          <span>{user?.name}</span>
          <Link to="/" onClick={logout} className="flex items-center gap-1 text-slate-400 hover:text-white">
            <LogOut size={18} /> Logout
          </Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-6">
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Link to="/chat" className="flex items-center gap-4 p-6 bg-slate-800 rounded-xl border border-slate-700 hover:border-blue-500 transition">
            <MessageCircle size={40} className="text-blue-500" />
            <div>
              <h3 className="font-semibold text-lg">Chat with IT Assistant</h3>
              <p className="text-slate-400 text-sm">Get AI-powered support before raising a ticket</p>
            </div>
          </Link>
          <Link to="/tickets/new" className="flex items-center gap-4 p-6 bg-slate-800 rounded-xl border border-slate-700 hover:border-blue-500 transition">
            <PlusCircle size={40} className="text-blue-500" />
            <div>
              <h3 className="font-semibold text-lg">Raise New Ticket</h3>
              <p className="text-slate-400 text-sm">Create a support ticket directly</p>
            </div>
          </Link>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h3 className="font-semibold mb-4">My Open Tickets ({open.length})</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {open.slice(0, 5).map(t => (
                <Link key={t._id} to={`/tickets/${t._id}`} className="block p-3 bg-slate-700 rounded-lg hover:bg-slate-600">
                  <span className="font-mono text-blue-400">{t.ticketId}</span> {t.issue}
                </Link>
              ))}
              {open.length === 0 && <p className="text-slate-400">No open tickets</p>}
            </div>
            <Link to="/tickets" className="mt-4 inline-block text-blue-400 text-sm">View all →</Link>
          </div>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h3 className="font-semibold mb-4">My Resolved Tickets ({resolved.length})</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {resolved.slice(0, 5).map(t => (
                <Link key={t._id} to={`/tickets/${t._id}`} className="block p-3 bg-slate-700 rounded-lg hover:bg-slate-600 opacity-80">
                  <span className="font-mono text-green-400">{t.ticketId}</span> {t.issue}
                </Link>
              ))}
              {resolved.length === 0 && <p className="text-slate-400">No resolved tickets</p>}
            </div>
            <Link to="/tickets" className="mt-4 inline-block text-blue-400 text-sm">View all →</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
