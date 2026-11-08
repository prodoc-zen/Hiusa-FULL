import Button from '../ui/Button';

// The page title above is the welcome, so this row carries only the one-sentence summary and the
// role's actions. The first action is the page's one filled button unless it names its own variant.
export default function BriefingHeader({ user, summary, actions }) {
  const headline = user.role !== 'SUPER_ADMIN' ? summary?.headline : null;
  const hasActions = Boolean(actions && actions.length > 0);

  if (!headline && !hasActions) return null;

  return (
    <section aria-label="Today" className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
      {headline ? <p className="min-w-0 text-sm font-medium text-ink">{headline}</p> : <span />}

      {hasActions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions.map((action, index) => (
            <Button
              key={action.label}
              to={action.to}
              onClick={action.onClick}
              leftIcon={action.icon}
              variant={action.variant ?? (index === 0 ? 'primary' : 'secondary')}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
