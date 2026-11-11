export function announcementImageError(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'The poster must be a JPEG, PNG or WebP image.';
  if (file.size > 5 * 1024 * 1024) return 'The poster must be 5 MB or smaller.';
  return '';
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function Badge({ color, children }) {
  const map = {
    blue: 'bg-brand/10 text-brand-700',
    green: 'bg-green-50 text-green-800',
    red: 'bg-red-50 text-red-800',
    yellow: 'bg-amber-50 text-amber-800',
    gray: 'bg-slate-100 text-slate-700',
  };

  return (
    <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded px-2 text-xs font-medium', map[color] || map.gray)}>
      {children}
    </span>
  );
}

// The server keeps two fields: approval_status (draft, pending, approved, rejected) and is_published.
// An officer's announcement waits as pending until the Admin approves it, an Admin unpublishing
// puts it back to draft, and there is no archived state, so the stage is read from both fields.
export function announcementStage(announcement) {
  if (announcement?.approval_status === 'pending') return { key: 'pending', label: 'Waiting for Admin approval', color: 'yellow' };
  if (announcement?.approval_status === 'rejected') return { key: 'returned', label: 'Returned', color: 'red' };
  if (announcement?.is_published) return { key: 'published', label: 'Published', color: 'green' };
  return { key: 'draft', label: 'Draft', color: 'gray' };
}

// A published post is still hidden from students before its scheduled time and after its expiry.
export function announcementVisibility(announcement, now = Date.now()) {
  if (announcementStage(announcement).key !== 'published') return null;
  const day = (value) => new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' });
  if (announcement.expires_at && new Date(announcement.expires_at).getTime() <= now) return { label: `Expired ${day(announcement.expires_at)}`, color: 'gray' };
  if (announcement.scheduled_at && new Date(announcement.scheduled_at).getTime() > now) return { label: `Scheduled for ${day(announcement.scheduled_at)}`, color: 'blue' };
  return null;
}

export function AnnouncementStageChip({ announcement }) {
  const stage = announcementVisibility(announcement) || announcementStage(announcement);
  return <Badge color={stage.color}>{stage.label}</Badge>;
}
