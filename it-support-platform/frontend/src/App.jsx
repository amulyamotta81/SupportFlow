import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import Landing from './pages/Landing';
import Login from './pages/Login';
import EmployeeDashboard from './pages/EmployeeDashboard';
import Chatbot from './pages/Chatbot';
import TicketCreate from './pages/TicketCreate';
import TicketList from './pages/TicketList';
import TicketIntelligence from './pages/TicketIntelligence';
import AgentDashboard from './pages/AgentDashboard';
import AdminDashboard from './pages/AdminDashboard';
import TicketDetail from './pages/TicketDetail';

function PrivateRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/tickets/:id" element={<TicketDetail />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<PrivateRoute roles={['employee']}><EmployeeDashboard /></PrivateRoute>} />
      <Route path="/chat" element={<PrivateRoute roles={['employee']}><Chatbot /></PrivateRoute>} />
      <Route path="/tickets/new" element={<PrivateRoute roles={['employee']}><TicketCreate /></PrivateRoute>} />
      <Route path="/tickets" element={<PrivateRoute><TicketList /></PrivateRoute>} />
      <Route path="/tickets/:id" element={<PrivateRoute><TicketIntelligence /></PrivateRoute>} />
      <Route path="/agent" element={<PrivateRoute roles={['agent', 'admin']}><AgentDashboard /></PrivateRoute>} />
      <Route path="/admin" element={<PrivateRoute roles={['admin']}><AdminDashboard /></PrivateRoute>} />
      <Route path="/support" element={<Chatbot />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
