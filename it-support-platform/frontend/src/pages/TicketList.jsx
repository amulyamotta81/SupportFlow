import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { LogOut, ArrowLeft } from 'lucide-react';

export default function TicketList() {
  const { user, logout } = useAuth();
  const [tickets, setTickets] = useState([]);

  useEffect(() => {
    const url = user?.role === 'admin' ? '/tickets/all' : '/tickets';
    api.get(url).then(res => setTickets(res.data));
  }, [user]);

  const backUrl = user?.role === 'admin' ? '/admin' : user?.role === 'agent' ? '/agent' : '/dashboard';

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
        <Link to={backUrl} className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={20} /> Back
        </Link>
        <h1 className="text-xl font-bold">My Tickets</h1>
        <Link to="/" onClick={logout} className="flex items-center gap-1 text-slate-400 hover:text-white">
          <LogOut size={18} /> Logout
        </Link>
      </header>
      <main className="max-w-5xl mx-auto p-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="pb-3 pr-4">Ticket ID</th>
              <th className="pb-3 pr-4">Issue</th>
              <th className="pb-3 pr-4">Category</th>
              <th className="pb-3 pr-4">Priority</th>
              <th className="pb-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t._id} className="border-b border-slate-700 hover:bg-slate-800">
                <td className="py-3 pr-4">
                  <Link to={`/tickets/${t._id}`} className="font-mono text-blue-400 hover:underline">{t.ticketId}</Link>
                </td>
                <td className="py-3 pr-4">{t.issue}</td>
                <td className="py-3 pr-4">{t.category}</td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-0.5 rounded text-sm ${
                    t.priority === 'Critical' ? 'bg-red-900' : t.priority === 'High' ? 'bg-orange-900' : t.priority === 'Medium' ? 'bg-yellow-900' : 'bg-slate-700'
                  }`}>{t.priority}</span>
                </td>
                <td className="py-3">{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
