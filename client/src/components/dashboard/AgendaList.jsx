import { formatDisplayText } from '../../utils/displayText.js';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../ui/EmptyState';
import { manilaDate, relativeTime } from '../../lib/format';
import { getItemHref, getStoredRole, getWaitingOnLabel } from '../../utils/notificationLinks';

function Row({ item, role }) {
  const href = getItemHref(item, role);
  const waitingOn = getWaitingOnLabel(item);
  const content = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
        <CalendarDays size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{formatDisplayText(item.title)}</p>
        <p className="mt-0.5 text-xs font-medium text-ink-muted">
          {manilaDate(item.starts_at)} &middot; {relativeTime(item.starts_at)}
          {item.location ? ` · ${item.location}` : ''}
        </p>
        {waitingOn && <p className="mt-0.5 text-xs font-semibold text-ink-muted">{waitingOn}</p>}
      </div>
      {href && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-brand-600">
          Open
          <ChevronRight size={16} aria-hidden="true" />
        </span>
      )}
    </>
  );

  return (
    <li>
      {href ? (
        <Link to={href} className="-mx-1 flex items-center gap-3 rounded-control px-1 py-3 transition-colors duration-150 hover:bg-subtle">
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-1 py-3">{content}</div>
      )}
    </li>
  );
}

/**
 * ELEVATION_SPEC section 6, step 5: the upcoming schedule from the
 * briefing's `agenda` array (events and closing elections, soonest first).
 */
export default function AgendaList({ items = [], role = getStoredRole() }) {
  if (items.length === 0) {
    return (
      <EmptyState
        kind="first-run"
        icon={CalendarDays}
        title="Nothing on the calendar yet"
        description="Upcoming events and elections closing soon will appear here."
      />
    );
  }

  return <ul className="divide-y divide-line-soft">{items.map((item) => <Row key={item.id} item={item} role={role} />)}</ul>;
}
