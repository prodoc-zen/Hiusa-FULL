import { seriesColor } from './palette';

export default function Donut({ segments = [], centerValue, centerLabel, title, description, valueFormat }) {
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
    return { ...segment, percentage, offset: -priorPercentage };
  });

  return (
    <section aria-label={title}>
      {title && <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-[#64748B]">{description}</p>}

      {total === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-[#64748B]">No data for this period yet</p>
      ) : (
        <div className={`grid items-center gap-5 sm:grid-cols-[180px_minmax(0,1fr)] ${title || description ? 'mt-4' : ''}`}>
          <div
            className="relative mx-auto h-40 w-40"
            role="img"
            aria-label={`${title ? `${title}: ` : ''}${safeSegments.map((segment) => `${segment.label} ${format(segment.value)}`).join(', ')}`}
          >
            <svg viewBox="0 0 160 160" className="h-full w-full" aria-hidden="true">
              <circle cx="80" cy="80" r="56" fill="none" stroke="#EEF6FB" strokeWidth="24" />
              {ring.map((segment) => (
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
                />
              ))}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center">
              <p className="text-2xl font-black tabular-nums text-[#0F172A]">{format(centerValue ?? total)}</p>
              {centerLabel && <p className="max-w-20 text-[10px] font-bold uppercase leading-4 tracking-wide text-[#64748B]">{centerLabel}</p>}
            </div>
          </div>
          <dl className="space-y-2.5">
            {ring.map((segment) => (
              <div key={segment.label} className="flex items-center gap-2.5">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                <dt className="min-w-0 flex-1 truncate text-xs font-semibold text-[#64748B]" title={segment.label}>{segment.label}</dt>
                <dd className="shrink-0 text-right text-sm font-black tabular-nums text-[#0F172A]">
                  {format(segment.value)}
                  <span className="ml-1.5 text-xs font-semibold text-[#64748B]">{Math.round(segment.percentage)}%</span>
                </dd>
              </div>
            ))}
          </dl>
          <table className="sr-only">
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
