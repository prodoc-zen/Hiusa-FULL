import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatusBadge from '../ui/StatusBadge';
import { relativeTime } from '../../lib/format';

const SEVERITY = {
  high: { tone: 'danger', label: 'High' },
  medium: { tone: 'warning', label: 'Medium' },
  low: { tone: 'info', label: 'Low' },
};

function Row({ item }) {
  const severity = SEVERITY[item.severity] || { tone: 'neutral', label: 'Notice' };

  const body = (
    <>
      <StatusBadge tone={severity.tone} label={severity.label} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{item.title}</p>
        <p className="mt-0.5 text-xs font-medium leading-5 text-ink-muted">{item.detail}</p>
        {item.due_at && <p className="mt-1 text-xs font-semibold text-ink-muted">{relativeTime(item.due_at)}</p>}
      </div>
      {item.href && <ChevronRight size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />}
    </>
  );

  const className = 'flex items-start gap-3 px-1 py-3.5';

  if (item.href) {
    return (
      <li>
        <Link to={item.href} className={`${className} -mx-1 rounded-control transition-colors duration-150 hover:bg-subtle`}>
          {body}
        </Link>
      </li>
    );
  }

  return <li className={className}>{body}</li>;
}

/**
 * ELEVATION_SPEC section 6, step 2: prioritized, actionable items from
 * GET /dashboard/briefing's `attention` array, already sorted by severity
 * then due date by the server.
 */
export default function AttentionList({ items = [] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-start gap-3 py-4">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success-strong" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-ink">Nothing is waiting on you</p>
          <p className="mt-0.5 text-xs font-medium leading-5 text-ink-muted">New approvals, deadlines, and alerts will show up here first.</p>
        </div>
      </div>
    );
  }

  return <ul className="divide-y divide-line-soft">{items.map((item) => <Row key={item.id} item={item} />)}</ul>;
}
