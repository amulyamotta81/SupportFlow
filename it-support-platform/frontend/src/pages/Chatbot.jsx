import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Send, Ticket, CheckCircle, ArrowLeft } from 'lucide-react';

export default function Chatbot() {
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hi! I\'m your IT Assistant. Describe your issue and I\'ll try to help.' }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestedCategory, setSuggestedCategory] = useState('');
  const [suggestedPriority, setSuggestedPriority] = useState('');
  const [confidence, setConfidence] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    if (!user) { navigate('/login'); return; }
    const msg = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const { data } = await api.post('/chat/message', { message: msg });
      setMessages(m => [...m, { role: 'assistant', text: data.response }]);
      setSuggestedCategory(data.suggestedCategory || '');
      setSuggestedPriority(data.suggestedPriority || '');
      setConfidence((data.confidence || 0) * 100);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: 'Sorry, I couldn\'t process that. Please try again or create a ticket.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
        <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-2 text-slate-400 hover:text-white">
          <ArrowLeft size={20} /> Back
        </Link>
        <h1 className="text-xl font-bold">IT Assistant</h1>
        <div className="w-20" />
      </header>
      {!user && (
        <div className="bg-amber-900/30 border-b border-amber-700 px-6 py-2 text-center text-amber-200 text-sm">
          Login to chat with the IT Assistant. <Link to="/login" className="underline">Login</Link>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
        {messages.map((m, i) => (
          <div key={i} className={`mb-4 ${m.role === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block max-w-[85%] p-4 rounded-xl ${m.role === 'user' ? 'bg-blue-600' : 'bg-slate-700'}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          </div>
        ))}
        {loading && <div className="text-slate-400">Thinking...</div>}
        <div ref={bottomRef} />
      </div>
      {(suggestedCategory || suggestedPriority) && (
        <div className="px-6 py-2 bg-slate-800 border-t border-slate-700 text-sm text-slate-300">
          Suggested: {suggestedCategory} | {suggestedPriority} | Confidence: {confidence}%
        </div>
      )}
      <div className="p-4 bg-slate-800 border-t border-slate-700">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Describe your issue..." className="flex-1 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg"
            disabled={!user} />
          <button onClick={send} disabled={loading || !user} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg disabled:opacity-50">
            <Send size={20} />
          </button>
        </div>
        <div className="max-w-2xl mx-auto mt-4 flex gap-4">
          <button onClick={() => navigate(user ? '/dashboard' : '/')}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm">
            <CheckCircle size={16} /> Issue Solved
          </button>
          <Link to="/tickets/new" state={{ issue: input || [...messages].reverse().find(m => m.role === 'user')?.text || '', category: suggestedCategory, priority: suggestedPriority }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm">
            <Ticket size={16} /> Create Ticket
          </Link>
        </div>
      </div>
    </div>
  );
}
