import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { formatEvidenceValue, isZeroEvidence } from './objectivesFormat';

export default function ObjectiveEvidenceList({ items }) {
  if (!items || items.length === 0) {
    return <p className="mt-3 text-sm font-medium text-ink-muted">No evidence has been counted for this objective yet.</p>;
  }

  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const formatted = formatEvidenceValue(item);
        const zero = isZeroEvidence(item);
        const body = (
          <span className="min-w-0">
            <span className="block text-lg font-extrabold tabular-nums text-ink">{formatted}</span>
            <span className="block text-xs font-semibold text-ink-muted">{item.label}</span>
            {zero && <span className="block text-[11px] font-medium text-ink-soft">No activity yet</span>}
          </span>
        );

        return (
          <li key={item.label}>
            {item.href ? (
              <Link
                to={item.href}
                className="flex items-center justify-between gap-3 rounded-control border border-line bg-subtle px-3 py-2.5 transition-colors duration-150 hover:border-brand-600 hover:bg-brand-50 focus-visible:border-brand-600"
              >
                {body}
                <ArrowRight size={16} className="shrink-0 text-brand-600" aria-hidden="true" />
              </Link>
            ) : (
              <div className="rounded-control border border-line bg-subtle px-3 py-2.5">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
