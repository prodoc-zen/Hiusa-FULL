import { useState } from 'react';
import { TONE, seriesColor } from './palette';

export default function StackedBar({ segments = [], valueFormat, title, description }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const format = valueFormat || ((amount) => String(amount));
  const safeSegments = segments
    .map((segment, index) => ({
      ...segment,
      value: Math.max(0, Number(segment.value) || 0),
      color: (segment.tone && TONE[segment.tone]?.fill) || segment.color || seriesColor(index),
    }))
    .filter((segment) => segment.value > 0);
  const total = safeSegments.reduce((sum, segment) => sum + segment.value, 0);

  const layout = safeSegments.map((segment, index) => {
    const widthPct = (segment.value / total) * 100;
    const priorPct = safeSegments.slice(0, index).reduce((sum, prior) => sum + (prior.value / total) * 100, 0);
    return { ...segment, widthPct, centerPct: priorPct + widthPct / 2 };
  });

  const activeSegment = activeIndex !== null ? layout[activeIndex] : null;

  return (
    <section aria-label={title}>
      {title && <h3 className="text-sm font-bold text-ink">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}

      {total === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-ink-muted">No data for this period yet</p>
      ) : (
        <>
          <div className={`relative ${title || description ? 'mt-3' : ''}`}>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-line-soft">
              {layout.map((segment, index) => (
                <span
                  key={segment.label}
                  role="img"
                  tabIndex={0}
                  aria-label={`${segment.label}, ${format(segment.value)}, ${Math.round(segment.widthPct)}%`}
                  style={{ width: `${segment.widthPct}%`, backgroundColor: segment.color }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                />
              ))}
            </div>
            {activeSegment && (
              <div
                data-chart-tooltip
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-card"
                style={{ left: `${activeSegment.centerPct}%`, top: 0, marginTop: '-10px' }}
              >
                <p className="font-bold">{activeSegment.label}</p>
                <p className="tabular-nums">
                  {format(activeSegment.value)}
                  <span className="ml-1 text-ink-muted">({Math.round(activeSegment.widthPct)}%)</span>
                </p>
              </div>
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {layout.map((segment) => (
              <li key={segment.label} className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink">
                <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                <span className="max-w-32 truncate" title={segment.label}>{segment.label}</span>
                <span className="shrink-0 tabular-nums font-medium text-ink-muted">
                  {format(segment.value)} ({Math.round(segment.widthPct)}%)
                </span>
              </li>
            ))}
          </ul>
          <table className="sr-only table-fixed">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th>Label</th>
                <th>Value</th>
                <th>Percent</th>
              </tr>
            </thead>
            <tbody>
              {layout.map((segment) => (
                <tr key={segment.label}>
                  <td>{segment.label}</td>
                  <td>{format(segment.value)}</td>
                  <td>{Math.round(segment.widthPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
