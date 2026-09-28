import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PageHeader({ breadcrumbs, title, description, actions, meta, className = '' }) {
  return (
    <div className={`flex flex-col gap-3 border-b border-line pb-5 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-muted">
          {breadcrumbs.map((crumb, index) => (
            <Fragment key={crumb.label}>
              {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-ink">{crumb.label}</Link>
              ) : (
                <span className="text-ink">{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold leading-tight text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-[75ch] text-sm font-medium text-ink-muted-strong">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-3">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
