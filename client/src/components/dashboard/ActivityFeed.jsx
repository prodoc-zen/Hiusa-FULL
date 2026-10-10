import { ChevronRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../ui/EmptyState';
import { relativeTime } from '../../lib/format';
import { getItemHref, getStoredRole, getWaitingOnLabel } from '../../utils/notificationLinks';

function Row({ item, role }) {
  const href = getItemHref(item, role);
  const waitingOn = getWaitingOnLabel(item);
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="font-bold">{item.actor}</span> <span className="text-ink-muted">{item.action.toLowerCase()}</span>
        </p>
        <p className="mt-0.5 truncate text-xs font-medium text-ink-muted">{item.subject}</p>
        {waitingOn && <p className="mt-1 text-xs font-semibold text-ink-muted">{waitingOn}</p>}
        <p className="mt-1 text-xs font-semibold text-ink-soft">{relativeTime(item.at)}</p>
      </div>
      {href && (
        <span className="flex shrink-0 items-center gap-0.5 self-center text-xs font-bold text-brand-600">
          Open
          <ChevronRight size={16} aria-hidden="true" />
        </span>
      )}
    </>
  );

  return (
    <li>
      {href ? (
        <Link to={href} className="-mx-1 flex items-start gap-3 rounded-control px-1 py-3 transition-colors duration-150 hover:bg-subtle">
          {content}
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-1 py-3">{content}</div>
      )}
    </li>
  );
}

/**
 * ELEVATION_SPEC section 6, step 5: recent accountable actions from the
 * briefing's `activity` array. The API already scopes this per role (own
 * actions plus safe public items, or the full org/university audit stream
 * for ADMIN/SUPER_ADMIN) - this component only renders what it is given.
 */
export default function ActivityFeed({ items = [], role = getStoredRole() }) {
  if (items.length === 0) {
    return (
      <EmptyState
        kind="first-run"
        icon={History}
        title="No recent activity"
        description="Accountable actions taken in your organization will show up here."
      />
    );
  }

  return <ul className="divide-y divide-line-soft">{items.map((item) => <Row key={item.id} item={item} role={role} />)}</ul>;
}
