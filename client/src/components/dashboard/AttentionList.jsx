import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../ui/EmptyState';
import StatusBadge from '../ui/StatusBadge';
import { relativeTime } from '../../lib/format';
import { getItemHref, getStoredRole, getWaitingOnLabel } from '../../utils/notificationLinks';

function Row({ item, role }) {
  const href = getItemHref(item, role);
  const waitingOn = getWaitingOnLabel(item);

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-ink">{item.title}</p>
          {/* A badge marks the exception only; normal and low items carry none. */}
          {item.severity === 'high' && <StatusBadge tone="danger" label="Urgent" className="shrink-0" />}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-ink-muted">{item.detail}</p>
        {waitingOn && <p className="mt-1 text-xs font-medium text-ink-muted">{waitingOn}</p>}
        {item.due_at && <p className="mt-1 text-xs font-medium text-ink-muted">{relativeTime(item.due_at)}</p>}
      </div>
      {href && (
        <span className="flex shrink-0 items-center gap-0.5 self-center text-xs font-semibold text-brand-700">
          Open
          <ChevronRight size={16} aria-hidden="true" />
        </span>
      )}
    </>
  );

  const className = 'flex min-h-11 items-start gap-3 px-1 py-3';

  if (href) {
    return (
      <li>
        <Link to={href} className={`${className} -mx-1 rounded-control transition-colors duration-150 hover:bg-subtle`}>
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
 * then due date by the server. Each row is one link: the server's href, or the deep link built from
 * its entity_type and entity_id when it gave none.
 */
export default function AttentionList({ items = [], role = getStoredRole() }) {
  if (items.length === 0) {
    return <EmptyState kind="first-run" title="Nothing needs you right now" description="New approvals and deadlines show here first." />;
  }

  return <ul className="divide-y divide-line-soft">{items.map((item) => <Row key={item.id} item={item} role={role} />)}</ul>;
}
