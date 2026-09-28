import { useState } from 'react';
import { PAGE_TINT, seriesColor } from './palette';

export default function Donut({ segments = [], centerValue, centerLabel, title, description, valueFormat }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const format = valueFormat || ((amount) => amount.toLocaleString());
  const safeSegments = segments
    .map((segment, index) => ({
      ...segment,
      value: Math.max(0, Number(segment.value) || 0),
      color: segment.color || seriesColor(index),
    }))
    .filter((segment) => segment.value > 0);
  const total = safeSegments.reduce((sum, segment) => sum + segment.value, 0);

  const ring = safeSegments.map((segment, index) => {
    const percentage = total > 0 ? (segment.value / total) * 100 : 0;
    const priorPercentage = safeSegments
      .slice(0, index)
      .reduce((sum, prior) => sum + (total > 0 ? (prior.value / total) * 100 : 0), 0);
    const midAngleDeg = -90 + (priorPercentage + percentage / 2) * 3.6;
    const midAngleRad = (midAngleDeg * Math.PI) / 180;
    return {
      ...segment,
      percentage,
      offset: -priorPercentage,
      tooltipX: 80 + Math.cos(midAngleRad) * 56,
      tooltipY: 80 + Math.sin(midAngleRad) * 56,
    };
  });

  const activeSegment = activeIndex !== null ? ring[activeIndex] : null;

  return (
    <section aria-label={title}>
      {title && <h3 className="text-sm font-bold text-ink">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}

      {total === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-ink-muted">No data for this period yet</p>
      ) : (
        <div className={`grid items-center gap-5 sm:grid-cols-[180px_minmax(0,1fr)] ${title || description ? 'mt-4' : ''}`}>
          <div className="relative mx-auto h-40 w-40">
            <svg viewBox="0 0 160 160" className="h-full w-full">
              <circle cx="80" cy="80" r="56" fill="none" stroke={PAGE_TINT} strokeWidth="24" />
              {ring.map((segment, index) => (
                <circle
                  key={segment.label}
                  cx="80"
                  cy="80"
                  r="56"
                  pathLength="100"
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="24"
                  strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`}
                  strokeDashoffset={segment.offset}
                  transform="rotate(-90 80 80)"
                  tabIndex={0}
                  role="img"
                  aria-label={`${segment.label}, ${format(segment.value)}, ${Math.round(segment.percentage)}%`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                />
              ))}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center">
              <p className="text-2xl font-black tabular-nums text-ink">{format(centerValue ?? total)}</p>
              {centerLabel && <p className="max-w-20 text-[10px] font-bold uppercase leading-4 tracking-wide text-ink-muted">{centerLabel}</p>}
            </div>
            {activeSegment && (
              <div
                data-chart-tooltip
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-card"
                style={{ left: `${(activeSegment.tooltipX / 160) * 100}%`, top: `${(activeSegment.tooltipY / 160) * 100}%`, marginTop: '-10px' }}
              >
                <p className="font-bold">{activeSegment.label}</p>
                <p className="tabular-nums">
                  {format(activeSegment.value)}
                  <span className="ml-1 text-ink-muted">({Math.round(activeSegment.percentage)}%)</span>
                </p>
              </div>
            )}
          </div>
          <dl className="space-y-2.5">
            {ring.map((segment) => (
              <div key={segment.label} className="flex items-center gap-2.5">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                <dt className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-muted" title={segment.label}>{segment.label}</dt>
                <dd className="shrink-0 text-right text-sm font-black tabular-nums text-ink">
                  {format(segment.value)}
                  <span className="ml-1.5 text-xs font-semibold text-ink-muted">{Math.round(segment.percentage)}%</span>
                </dd>
              </div>
            ))}
          </dl>
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
              {ring.map((segment) => (
                <tr key={segment.label}>
                  <td>{segment.label}</td>
                  <td>{format(segment.value)}</td>
                  <td>{Math.round(segment.percentage)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
