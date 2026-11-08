import { formatDisplayText } from '../../utils/displayText.js';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { visibleSchoolId } from '../../utils/schoolId';

export default function UserIdentityCard({ user, compact = false }) {
  if (!user) return null;
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const initials = `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'HI';
  return <div className={`flex items-center gap-4 rounded-card border border-line bg-subtle ${compact ? 'p-3' : 'p-5'}`}>
    {user.photo_url ? <img src={resolveAssetUrl(user.photo_url)} alt={`${formatDisplayText(name)} profile`} className={`${compact ? 'h-14 w-14' : 'h-20 w-20'} shrink-0 rounded-full object-cover`} /> : <span role="img" aria-label={`${formatDisplayText(name)} default avatar`} className={`grid ${compact ? 'h-14 w-14 text-lg' : 'h-20 w-20 text-2xl'} shrink-0 place-items-center rounded-full bg-brand-700 font-semibold text-white`}>{initials}</span>}
    <div className="min-w-0"><p className="break-words text-base font-semibold text-ink">{formatDisplayText(name)}</p><p className="mt-1 break-words text-xs text-ink-muted-strong">{visibleSchoolId(user.school_id) ? `School ID ${user.school_id} · ` : ''}{user.role?.replaceAll('_', ' ')}</p>{!compact && <p className="mt-1 break-words text-xs text-ink-muted">{formatDisplayText(user.organization?.name) || 'Organization'} · {user.account_status || 'active'}</p>}</div>
  </div>;
}
