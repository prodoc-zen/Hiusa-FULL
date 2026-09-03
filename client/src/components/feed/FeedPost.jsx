import { useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, MapPin, Megaphone, Pin, ShieldCheck, Vote } from 'lucide-react';
import { Link } from 'react-router-dom';
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
    <div className="border-y border-[#DDE7EF] bg-[#F2F7FA]">
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

function typeMeta(type) {
  if (type === 'event') return { label: 'Event update', Icon: CalendarDays, color: 'text-violet-700 bg-violet-50' };
  if (type === 'election') return { label: 'Election update', Icon: Vote, color: 'text-[#0B8ED0] bg-[#EEF6FB]' };
  return { label: 'Announcement', Icon: Megaphone, color: 'text-[#0B8ED0] bg-[#EEF6FB]' };
}

export default function FeedPost({ item, organization }) {
  const post = item.data || {};
  const { Icon, label, color } = typeMeta(item.type);
  const orgName = organization?.name || organization?.acronym || 'HIUSA';
  const publishedAt = post.published_at || item.sort_at || post.created_at;
  const body = post.body || post.description;
  const electionClosed = item.type === 'election' && post.status === 'closed';

  return (
    <article className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
      <header className="flex items-start gap-3 p-4 sm:p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#DDE7EF] bg-white">
          <img src={logo} alt="" className="h-8 w-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-sm font-black text-[#0F172A] sm:text-[15px]">{orgName}</h2>
            {item.is_pinned && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700"><Pin size={10} /> Pinned</span>}
            {post.is_important && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Important</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-[#64748B]">
            <span>{formatRelativeTime(publishedAt)}</span><span aria-hidden="true">·</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${color}`}><Icon size={11} /> {label}</span>
          </div>
        </div>
      </header>

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <h3 className="text-lg font-black leading-7 text-[#0F172A] sm:text-xl">{post.title}</h3>
        {body && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#334155] sm:text-[15px]">{body}</p>}
        {item.type === 'event' && (
          <div className="mt-4 space-y-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-xs font-semibold text-[#475569]">
            <p className="flex items-start gap-2"><Clock3 size={15} className="mt-0.5 shrink-0 text-[#0B8ED0]" /> {formatDateTime(post.start_time)}</p>
            {post.location && <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-[#0B8ED0]" /> {post.location}</p>}
          </div>
        )}
        {item.type === 'election' && (
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-center">
            <div><p className="text-lg font-black text-[#0F172A]">{post.positions_count ?? 0}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Positions</p></div>
            <div><p className="text-lg font-black text-[#0F172A]">{post.candidates_count ?? 0}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Candidates</p></div>
          </div>
        )}
      </div>

      <PostMedia url={post.image_url} title={post.title} />

      <footer className="p-3 sm:px-5 sm:py-4">
        {item.type === 'announcement' && (
          <Link to="/dashboard/announcements/view-announcements" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] text-sm font-bold text-[#0B8ED0] hover:bg-[#F8FBFD] sm:w-auto sm:px-5">
            <Megaphone size={15} /> View announcements
          </Link>
        )}
        {item.type === 'event' && (
          <Link to="/dashboard/events/activity-calendar" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] text-sm font-bold text-[#0B8ED0] hover:bg-[#F8FBFD] sm:w-auto sm:px-5">
            <CalendarDays size={15} /> View activity calendar
          </Link>
        )}
        {item.type === 'election' && (post.has_voted ? (
          <span className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-5 text-sm font-bold text-emerald-700 sm:w-auto"><CheckCircle2 size={16} /> Vote submitted</span>
        ) : electionClosed ? (
          <Link to="/dashboard/elections/election-results" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-[#0B8ED0] hover:bg-[#F8FBFD] sm:w-auto"><Vote size={15} /> View results</Link>
        ) : (
          <Link to={`/elections/${post.id}/vote`} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] sm:w-auto"><ShieldCheck size={16} /> Enter secure voting</Link>
        ))}
      </footer>
    </article>
  );
}
