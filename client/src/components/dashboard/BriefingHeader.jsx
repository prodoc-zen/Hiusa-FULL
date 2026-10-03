import Button from '../ui/Button';
import { greetingFor, manilaDate } from '../../lib/format';

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SBO_OFFICER: 'Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

export default function BriefingHeader({ user, summary, actions }) {
  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const scopeLabel = user.organization?.name || 'University-wide';

  return (
    <section className="border-b border-line pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-muted">
            {manilaDate(new Date(), 'weekday')} &middot; {roleLabel} &middot; {scopeLabel}
          </p>
          <h2 className="mt-1.5 text-xl font-bold leading-tight text-ink sm:text-2xl">
            Good {greetingFor()}, {user.first_name}
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-muted">{summary.headline}</p>
        </div>

        {actions && actions.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions.map((action, index) => (
              <Button
                key={action.label}
                to={action.to}
                onClick={action.onClick}
                leftIcon={action.icon}
                variant={index === 0 ? 'primary' : 'secondary'}
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
