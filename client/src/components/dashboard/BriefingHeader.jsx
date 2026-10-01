import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import { greetingFor, manilaDate } from '../../lib/format';
import { resolveAssetUrl } from '../../utils/assetUrl';

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SBO_OFFICER: 'Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

function cachedIdentity() {
  try {
    const stored = JSON.parse(localStorage.getItem('user') || 'null');
    if (!stored) return { fullName: '', photoUrl: null };
    return {
      fullName: `${stored.first_name || ''} ${stored.last_name || ''}`.trim(),
      photoUrl: stored.photo_url ? resolveAssetUrl(stored.photo_url) : null,
    };
  } catch {
    return { fullName: '', photoUrl: null };
  }
}

/**
 * The navy briefing band every role dashboard opens with (ELEVATION_SPEC
 * section 6, step 1). `user` and `summary` are the `user`/`summary` blocks
 * of GET /dashboard/briefing verbatim.
 */
export default function BriefingHeader({ user, summary, actions }) {
  const identity = cachedIdentity();
  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const scopeLabel = user.organization?.name || 'University-wide';

  return (
    <section className="relative overflow-hidden rounded-card border border-navy-950 bg-navy-950 p-5 text-white sm:p-6">
      <svg
        viewBox="0 0 200 160"
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-10 h-44 w-52 opacity-[0.16] sm:h-56 sm:w-64"
      >
        <polygon points="140,0 200,40 190,120 110,160 60,110" className="fill-brand-600" />
        <polygon points="140,0 200,40 150,70" className="fill-accent" />
      </svg>

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={identity.fullName || user.first_name} src={identity.photoUrl} size="lg" className="ring-2 ring-white/15" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-accent">
              <span>{roleLabel}</span>
              <span aria-hidden="true"> &middot; </span>
              <span>{scopeLabel}</span>
            </p>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight sm:text-[28px]">
              Good {greetingFor()}, {user.first_name}
            </h1>
            <p className="mt-1 text-xs font-semibold text-slate-300">{manilaDate(new Date(), 'weekday')}</p>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-200">{summary.headline}</p>
          </div>
        </div>

        {actions && actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/15 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            {actions.map((action, index) => (
              <Button
                key={action.label}
                to={action.to}
                onClick={action.onClick}
                leftIcon={action.icon}
                variant={index === 0 ? 'primary' : 'secondary'}
                className={index === 0 ? '' : 'border-white/25 bg-white/10 text-white hover:bg-white/20'}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
