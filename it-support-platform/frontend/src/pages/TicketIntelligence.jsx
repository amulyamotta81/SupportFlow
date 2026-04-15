import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { ArrowLeft, User, Brain, FileText, LogOut } from 'lucide-react';

export default function TicketIntelligence() {
  const { id } = useParams();
  const { user, logout } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [showResolve, setShowResolve] = useState(false);

  useEffect(() => {
    api.get(`/tickets/${id}`).then(res => setTicket(res.data));
  }, [id]);

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      const { data } = await api.post(`/tickets/${id}/notes`, { text: note });
      setTicket(data);
      setNote('');
    } catch (e) {
      alert('Failed to add note');
    }
  };

  const markResolved = async () => {
    if (!resolution.trim()) return;
    try {
      const { data } = await api.patch(`/tickets/${id}`, { status: 'Resolved', resolution });
      setTicket(data);
      setShowResolve(false);
    } catch (e) {
      alert('Failed to resolve');
    }
  };

  const backUrl = user?.role === 'admin' ? '/admin' : user?.role === 'agent' ? '/agent' : '/tickets';

  if (!ticket) return <div className="min-h-screen bg-slate-900 flex items-center justify-center">Loading...</div>;

  const ai = ticket.aiAnalysis || {};
  const similar = ai.similarTickets || [];

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
        <Link to={backUrl} className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={20} /> Back
        </Link>
        <h1 className="text-xl font-bold">Ticket Intelligence View</h1>
        <Link to="/" onClick={logout} className="flex items-center gap-1 text-slate-400 hover:text-white">
          <LogOut size={18} /> Logout
        </Link>
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-xl font-bold mb-4">{ticket.ticketId} – {ticket.issue}</h2>
          <p className="text-slate-300">User Issue: &quot;{ticket.issue}&quot;</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h3 className="flex items-center gap-2 font-semibold mb-4"><Brain size={20} className="text-blue-500" /> AI Analysis Panel</h3>
            <ul className="space-y-2 text-slate-300">
              <li><strong>Category:</strong> {ticket.category}</li>
              <li><strong>Priority:</strong> {ticket.priority}</li>
              <li><strong>Confidence:</strong> {ai.confidence ? (ai.confidence > 1 ? ai.confidence.toFixed(2) : (ai.confidence * 100).toFixed(2)) : '-'}%</li>
              <li><strong>Suggested Root Cause:</strong> {ai.rootCause || 'N/A'}</li>
            </ul>
          </div>

          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h3 className="flex items-center gap-2 font-semibold mb-4"><FileText size={20} className="text-amber-500" /> Similar Past Tickets (RAG)</h3>
            <ul className="space-y-2">
              {similar.map((s, i) => (
                <li key={i} className="p-2 bg-slate-700 rounded text-sm">
                  <span className="text-blue-400">{s.ticketId}</span> – {s.issue}<br />
                  <span className="text-slate-400">Solution: {s.solution}</span>
                </li>
              ))}
              {similar.length === 0 && <p className="text-slate-400">No similar tickets</p>}
            </ul>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="flex items-center gap-2 font-semibold mb-4"><User size={20} className="text-green-500" /> Assigned Agent</h3>
          {ticket.assignedAgentId ? (
            <div className="flex justify-between items-center">
              <div>
                <p>{ticket.assignedAgentId.name}</p>
                <p className="text-slate-400 text-sm">
                  Skill Match: ~{((agent, cat) => {
                    const skills = (agent?.skills || []).map(s => (s || '').toLowerCase());
                    const catLower = (cat || '').toLowerCase();
                    return skills.includes(catLower) || skills.some(s => catLower.includes(s)) ? 100 : 75;
                  })(ticket.assignedAgentId, ticket.category)}% | Workload: {ticket.assignedAgentId.workload ?? 'N/A'}
                </p>
              </div>
              {user?.role === 'admin' && <button className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded">Reassign</button>}
            </div>
          ) : <p className="text-slate-400">Not yet assigned</p>}
        </div>

        {(user?.role === 'agent' || user?.role === 'admin') && (
          <>
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h3 className="font-semibold mb-4">Internal Notes</h3>
              <div className="space-y-2 mb-4">
                {(ticket.internalNotes || []).map((n, i) => (
                  <div key={i} className="p-2 bg-slate-700 rounded text-sm">{n.text}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add note..."
                  className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded" />
                <button onClick={addNote} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded">Add Note</button>
              </div>
            </div>

            {ticket.status !== 'Resolved' && (
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                {!showResolve ? (
                  <button onClick={() => setShowResolve(true)} className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold">
                    Mark Resolved
                  </button>
                ) : (
                  <div>
                    <textarea value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Resolution notes..."
                      className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded mb-4" rows={3} />
                    <button onClick={markResolved} className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold">Confirm Resolve</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
