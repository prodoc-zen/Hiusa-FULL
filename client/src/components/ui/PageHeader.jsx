import { ChevronRight } from 'lucide-react';
import { Link, useInRouterContext, useLocation } from 'react-router-dom';
import { getBreadcrumbs, getPageMeta, getStoredRole } from '../../lib/pageMeta';
import { useRegisterPageHeader } from '../../lib/pageHeaderRegistry';

export function PageBreadcrumb({ crumbs }) {
  if (!crumbs || crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-muted">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
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
  );
}

// The markup alone, with no registration and no pageMeta lookup. DashboardLayout renders this for
// pages that bring no header of their own.
export function PageHeaderView({
  breadcrumbs,
  title,
  lead,
  actions,
  primary,
  meta,
  stepper,
  nextStep,
  className = '',
}) {
  return (
    <div className={`flex flex-col gap-3 border-b border-line pb-5 ${className}`}>
      <PageBreadcrumb crumbs={breadcrumbs} />
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

// `description` is the original prop and wins over `purpose` when a page passes both, so a page that
// still carries its own subtitle keeps it. `actions` holds secondary buttons; `primary` is the one
// filled button and always renders last. Breadcrumbs, title and purpose fall back to pageMeta for the
// current route, so a page only passes them to say something different.
export default function PageHeader(props) {
  return useInRouterContext() ? <RoutedPageHeader {...props} /> : <PageHeaderBare {...props} />;
}

function RoutedPageHeader({ breadcrumbs, title, description, purpose, ...rest }) {
  useRegisterPageHeader();
  const { pathname } = useLocation();
  const role = getStoredRole();
  const pageMeta = getPageMeta(pathname, role);

  return (
    <PageHeaderView
      {...rest}
      breadcrumbs={breadcrumbs ?? getBreadcrumbs(pathname, role)}
      title={title ?? pageMeta.title}
      lead={description ?? purpose ?? (pageMeta.isHome ? undefined : pageMeta.purpose) ?? undefined}
    />
  );
}

// A header rendered outside a router has no route to look up, so it shows only what the page passes.
function PageHeaderBare({ description, purpose, ...rest }) {
  return <PageHeaderView {...rest} lead={description ?? purpose} />;
}
