import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../services/api';
import { ArrowLeft } from 'lucide-react';

export default function TicketCreate() {
  const location = useLocation();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(location.state?.issue || '');
  const [category, setCategory] = useState(location.state?.category || 'General');
  const [priority, setPriority] = useState(location.state?.priority || 'Medium');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/tickets', { issue, category, priority });
      navigate('/tickets');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create ticket');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <Link to="/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white w-fit">
          <ArrowLeft size={20} /> Back to Dashboard
        </Link>
      </header>
      <main className="max-w-xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Raise New Ticket</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Issue Description</label>
            <textarea value={issue} onChange={e => setIssue(e.target.value)} required rows={4}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg" placeholder="e.g., VPN not connecting" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg">
              <option>Network</option>
              <option>Hardware</option>
              <option>Software</option>
              <option>Security</option>
              <option>Email</option>
              <option>VPN</option>
              <option>Account</option>
              <option>General</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg">
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Critical</option>
            </select>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold disabled:opacity-50">Submit Ticket</button>
        </form>
      </main>
    </div>
  );
}
