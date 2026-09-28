import { resolveAssetUrl } from '../../utils/assetUrl';

export default function UserIdentityCard({ user, compact = false }) {
  if (!user) return null;
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const initials = `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'HI';
  return <div className={`flex items-center gap-4 rounded-2xl border border-[#DDE7EF] bg-[#F8FBFD] ${compact ? 'p-3' : 'p-5'}`}>
    {user.photo_url ? <img src={resolveAssetUrl(user.photo_url)} alt={`${name} profile`} className={`${compact ? 'h-14 w-14' : 'h-20 w-20'} shrink-0 rounded-full border-2 border-white object-cover shadow-sm`} /> : <span role="img" aria-label={`${name} default avatar`} className={`grid ${compact ? 'h-14 w-14 text-lg' : 'h-20 w-20 text-2xl'} shrink-0 place-items-center rounded-full bg-[#0F2F62] font-black text-white`}>{initials}</span>}
    <div className="min-w-0"><p className="truncate text-base font-extrabold text-[#0F172A]">{name}</p><p className="mt-1 text-xs text-slate-600">School ID {user.school_id} · {user.role?.replaceAll('_', ' ')}</p>{!compact && <p className="mt-1 text-xs text-slate-500">{user.organization?.name || 'Organization'} · {user.account_status || 'active'}</p>}</div>
  </div>;
}
