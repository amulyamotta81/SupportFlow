import { Link } from 'react-router-dom';
import { LogIn, Headphones } from 'lucide-react';

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl font-bold mb-6">AI-Powered IT Infrastructure Support Platform</h1>
        <p className="text-xl text-blue-200 mb-12">Intelligent ticketing, faster resolution, smarter support.</p>
        <div className="flex gap-6 justify-center flex-wrap">
          <Link to="/login" className="flex items-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition">
            <LogIn size={20} /> Login
          </Link>
          <Link to="/support" className="flex items-center gap-2 px-8 py-4 bg-slate-600 hover:bg-slate-500 rounded-lg font-semibold transition">
            <Headphones size={20} /> Request Support
          </Link>
        </div>
      </div>
    </div>
  );
}
