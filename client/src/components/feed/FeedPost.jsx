import { formatDisplayText } from '../../utils/displayText.js';
import { useState } from 'react';
import { RichTextBody } from '../RichText';
import { CheckCircle2, Clock3, MapPin } from 'lucide-react';
import { Button, StatusBadge } from '../ui';
import logo from '../../assets/Hiusa Logo.png';
import { resolveAssetUrl } from '../../utils/assetUrl';

function formatRelativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function PostMedia({ url, title }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <div className="border-y border-line bg-page">
      <img
        src={resolveAssetUrl(url)}
        alt={title}
        loading="lazy"
        onError={() => setFailed(true)}
        className="mx-auto max-h-[720px] w-full object-contain"
      />
    </div>
  );
}

function typeLabel(type) {
  if (type === 'event') return 'Event update';
  if (type === 'election') return 'Election update';
  return 'Announcement';
}

export default function FeedPost({ item, organization }) {
  const post = item.data || {};
  const label = typeLabel(item.type);
  const orgName = organization?.name || organization?.acronym || 'HIUSA';
  const publishedAt = post.published_at || item.sort_at || post.created_at;
  const body = post.body || post.description;
  const electionClosed = item.type === 'election' && post.status === 'closed';

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-start gap-3 p-4 sm:p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-white">
          <img src={logo} alt="" className="h-8 w-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-sm font-semibold text-ink">{orgName}</h2>
            {item.is_pinned && <StatusBadge tone="warning" label="Pinned" />}
            {post.is_important && <StatusBadge tone="danger" label="Important" />}
          </div>
          <p className="mt-1 text-xs text-ink-muted">{formatRelativeTime(publishedAt)} · {label}</p>
        </div>
      </header>

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <h3 className="text-lg font-semibold leading-7 text-ink">{formatDisplayText(post.title)}</h3>
        {body && <RichTextBody value={body} className="mt-2 text-sm leading-6 text-ink" />}
        {item.type === 'event' && (
          <div className="mt-4 space-y-2 border-t border-line pt-3 text-sm text-ink-muted">
            <p className="flex items-start gap-2"><Clock3 size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formatDateTime(post.start_time)}</p>
            {post.location && <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {post.location}</p>}
          </div>
        )}
        {item.type === 'election' && (
          <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted tabular-nums">
            {post.positions_count ?? 0} positions, {post.candidates_count ?? 0} candidates
          </p>
        )}
      </div>

      <PostMedia url={post.image_url} title={formatDisplayText(post.title)} />

      <footer className="p-3 sm:px-5 sm:py-4">
        {item.type === 'announcement' && (
          <Button to="/dashboard/announcements/view-announcements" variant="secondary" className="w-full sm:w-auto">View announcements</Button>
        )}
        {item.type === 'event' && (
          <Button to="/dashboard/events/activity-calendar" variant="secondary" className="w-full sm:w-auto">View activity calendar</Button>
        )}
        {item.type === 'election' && (post.has_voted ? (
          <p className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-success-strong"><CheckCircle2 size={16} aria-hidden="true" /> Vote submitted</p>
        ) : electionClosed ? (
          <Button to="/dashboard/elections/election-results" variant="secondary" className="w-full sm:w-auto">View results</Button>
        ) : (
          <Button to={`/elections/${post.id}/vote`} variant="secondary" className="w-full sm:w-auto">Vote now</Button>
        ))}
      </footer>
    </article>
  );
}
