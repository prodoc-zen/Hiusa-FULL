import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

function Row({ area }) {
  const body = (
    <>
      <span className="min-w-12 text-xl font-extrabold tabular-nums text-ink">{area.count}{area.truncated ? '+' : ''}</span>
      <span className="min-w-0 flex-1 text-sm font-bold text-ink">{area.label}</span>
      {area.href && <ChevronRight size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />}
    </>
  );
  const className = 'flex min-h-14 items-center gap-3 px-1 py-2.5';

  if (area.href) {
    return <li><Link to={area.href} className={`${className} -mx-1 rounded-control transition-colors duration-150 hover:bg-subtle`}>{body}</Link></li>;
  }
  return <li className={className}>{body}</li>;
}

/**
 * The SAO's inbox: one count per review area, each linking to the exact tab or filter that holds
 * the work. `areas` comes from buildReviewAreas.
 */
export default function ReviewInbox({ areas = [] }) {
  if (areas.length === 0) {
    return (
      <div className="flex items-start gap-3 py-4">
        <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success-strong" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-ink">No reviews are waiting</p>
          <p className="mt-0.5 text-xs font-medium leading-5 text-ink-muted">Registrations, compliance submissions, financial reports, grievances and clearances are counted here as they arrive.</p>
        </div>
      </div>
    );
  }

  return <ul className="divide-y divide-line-soft">{areas.map((area) => <Row key={area.key} area={area} />)}</ul>;
}
