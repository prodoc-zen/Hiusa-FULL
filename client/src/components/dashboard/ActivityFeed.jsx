import { History } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../ui/EmptyState';
import { relativeTime } from '../../lib/format';

function Row({ item }) {
  const content = (
    <div className="min-w-0 flex-1">
      <p className="text-sm text-ink">
        <span className="font-bold">{item.actor}</span> <span className="text-ink-muted">{item.action.toLowerCase()}</span>
      </p>
      <p className="mt-0.5 truncate text-xs font-medium text-ink-muted">{item.subject}</p>
      <p className="mt-1 text-xs font-semibold text-ink-soft">{relativeTime(item.at)}</p>
    </div>
  );

  return (
    <li>
      {item.href ? (
        <Link to={item.href} className="-mx-1 flex items-start gap-3 rounded-control px-1 py-3 transition-colors duration-150 hover:bg-subtle">
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
export default function ActivityFeed({ items = [] }) {
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

  return <ul className="divide-y divide-line-soft">{items.map((item) => <Row key={item.id} item={item} />)}</ul>;
}
