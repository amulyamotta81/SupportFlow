import { Link } from 'react-router-dom';
import { AlertTriangle, ThumbsDown, Clock, MessageCircle, ArrowUpRight, CheckCircle2 } from 'lucide-react';

/**
 * Shared notification dropdown panel.
 * Accepts a list of notification objects and renders them as clickable items.
 *
 * Each notification: { id, type, icon, color, title, subtitle, link, time }
 */
export function buildNotifications(tickets, role) {
  const notifs = [];

  if (role === 'admin') {
    // Escalated tickets
    tickets
      .filter(t => t.status === 'Escalated')
      .forEach(t => notifs.push({
        id: `esc-${t._id}`, type: 'escalation',
        icon: AlertTriangle, color: 'text-red-400 bg-red-500/15',
        title: `Escalated: ${t.ticketId}`,
        subtitle: t.issue,
        link: `/tickets/${t._id}`,
        time: t.updatedAt || t.createdAt,
      }));
    // User replied — solution didn't work
    tickets
      .filter(t => t.userFeedback?.satisfied === false)
      .forEach(t => notifs.push({
        id: `reply-${t._id}`, type: 'user_reply',
        icon: ThumbsDown, color: 'text-amber-400 bg-amber-500/15',
        title: `User rejected solution: ${t.ticketId}`,
        subtitle: t.userFeedback?.replyNote || t.issue,
        link: `/tickets/${t._id}`,
        time: t.userFeedback?.submittedAt || t.updatedAt,
      }));
  }

  if (role === 'agent') {
    // SLA approaching (< 2 hours)
    tickets
      .filter(t => t.status !== 'Resolved' && t.slaDeadline && new Date(t.slaDeadline) < new Date(Date.now() + 2 * 60 * 60 * 1000))
      .forEach(t => notifs.push({
        id: `sla-${t._id}`, type: 'sla',
        icon: Clock, color: 'text-orange-400 bg-orange-500/15',
        title: `SLA expiring: ${t.ticketId}`,
        subtitle: t.issue,
        link: `/tickets/${t._id}`,
        time: t.slaDeadline,
      }));
    // User feedback received (both positive and negative)
    tickets
      .filter(t => t.userFeedback?.satisfied !== undefined)
      .forEach(t => notifs.push({
        id: `fb-${t._id}`, type: 'feedback',
        icon: t.userFeedback.satisfied ? CheckCircle2 : ThumbsDown,
        color: t.userFeedback.satisfied ? 'text-emerald-400 bg-emerald-500/15' : 'text-amber-400 bg-amber-500/15',
        title: t.userFeedback.satisfied ? `User confirmed fix: ${t.ticketId}` : `Solution rejected: ${t.ticketId}`,
        subtitle: t.userFeedback?.replyNote || (t.userFeedback.satisfied ? 'Marked as resolved' : t.issue),
        link: `/tickets/${t._id}`,
        time: t.userFeedback?.submittedAt || t.updatedAt,
      }));
  }

  if (role === 'employee') {
    // Agent submitted a solution — awaiting feedback
    tickets
      .filter(t => t.agentSolution?.text && t.userFeedback?.satisfied === undefined && t.status !== 'Resolved')
      .forEach(t => notifs.push({
        id: `sol-${t._id}`, type: 'solution_ready',
        icon: MessageCircle, color: 'text-blue-400 bg-blue-500/15',
        title: `Agent replied: ${t.ticketId}`,
        subtitle: t.agentSolution.text.slice(0, 80) + (t.agentSolution.text.length > 80 ? '...' : ''),
        link: `/tickets/${t._id}`,
        time: t.agentSolution?.submittedAt || t.updatedAt,
      }));
    // Ticket escalated
    tickets
      .filter(t => t.status === 'Escalated')
      .forEach(t => notifs.push({
        id: `esc-${t._id}`, type: 'escalation',
        icon: ArrowUpRight, color: 'text-red-400 bg-red-500/15',
        title: `Ticket escalated: ${t.ticketId}`,
        subtitle: t.issue,
        link: `/tickets/${t._id}`,
        time: t.updatedAt || t.createdAt,
      }));
    // Ticket resolved
    tickets
      .filter(t => t.status === 'Resolved')
      .forEach(t => notifs.push({
        id: `res-${t._id}`, type: 'resolved',
        icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/15',
        title: `Ticket resolved: ${t.ticketId}`,
        subtitle: t.issue,
        link: `/tickets/${t._id}`,
        time: t.resolvedAt || t.updatedAt,
      }));
  }

  // Sort by time descending
  notifs.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  return notifs;
}

function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationPanel({ notifications, onClose }) {
  return (
    <div className="absolute right-0 top-full mt-2 w-96 max-h-[28rem] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 flex justify-between items-center flex-shrink-0">
        <h3 className="font-semibold text-sm">Notifications</h3>
        <span className="text-xs text-slate-500">{notifications.length} item{notifications.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          notifications.slice(0, 20).map(n => {
            const Icon = n.icon;
            return (
              <Link
                key={n.id}
                to={n.link}
                onClick={onClose}
                className="flex items-start gap-3 px-4 py-3 hover:bg-slate-700/50 transition-colors border-b border-slate-700/50"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${n.color}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{n.title}</p>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{n.subtitle}</p>
                </div>
                <span className="text-xs text-slate-500 flex-shrink-0 mt-0.5">{timeAgo(n.time)}</span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
