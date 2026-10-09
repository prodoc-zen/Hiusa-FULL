import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

// `description` is the original prop and wins over `purpose` when a page passes both, so a page that
// still carries its own subtitle keeps it. `actions` holds secondary buttons; `primary` is the one
// filled button and always renders last.
export default function PageHeader({
  breadcrumbs,
  title,
  description,
  purpose,
  actions,
  primary,
  meta,
  stepper,
  nextStep,
  className = '',
}) {
  const lead = description ?? purpose;

  return (
    <div className={`flex flex-col gap-3 border-b border-line pb-5 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-muted">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={`${index}-${crumb.label}`} className="flex items-center gap-1.5">
                  {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                  {crumb.to && !last ? (
                    <Link to={crumb.to} className="hover:text-ink">{crumb.label}</Link>
                  ) : (
                    <span className="text-ink" aria-current={last ? 'page' : undefined}>{crumb.label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold leading-tight text-ink">{title}</h1>
          {lead && <p className="mt-1 max-w-[75ch] text-sm font-medium text-ink-muted-strong">{lead}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-3">{meta}</div>}
        </div>
        {(actions || primary) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
            {primary}
          </div>
        )}
      </div>
      {stepper && <div>{stepper}</div>}
      {nextStep && <div>{nextStep}</div>}
    </div>
  );
}
