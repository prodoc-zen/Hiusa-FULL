import { TONE, seriesColor } from './palette';

export default function StackedBar({ segments = [], valueFormat, title, description }) {
  const format = valueFormat || ((amount) => String(amount));
  const safeSegments = segments
    .map((segment, index) => ({
      ...segment,
      value: Math.max(0, Number(segment.value) || 0),
      color: (segment.tone && TONE[segment.tone]?.fill) || segment.color || seriesColor(index),
    }))
    .filter((segment) => segment.value > 0);
  const total = safeSegments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <section aria-label={title}>
      {title && <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-[#64748B]">{description}</p>}

      {total === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-[#64748B]">No data for this period yet</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`${title ? `${title}: ` : ''}${safeSegments.map((segment) => `${segment.label} ${format(segment.value)}`).join(', ')}`}
            className={`flex h-4 w-full overflow-hidden rounded-full bg-[#E5EDF3] ${title || description ? 'mt-3' : ''}`}
          >
            {safeSegments.map((segment) => (
              <span
                key={segment.label}
                title={`${segment.label}: ${format(segment.value)}`}
                style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {safeSegments.map((segment) => (
              <li key={segment.label} className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                <span className="max-w-32 truncate" title={segment.label}>{segment.label}</span>
                <span className="shrink-0 tabular-nums font-medium text-[#64748B]">
                  {format(segment.value)} ({Math.round((segment.value / total) * 100)}%)
                </span>
              </li>
            ))}
          </ul>
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
              {safeSegments.map((segment) => (
                <tr key={segment.label}>
                  <td>{segment.label}</td>
                  <td>{format(segment.value)}</td>
                  <td>{Math.round((segment.value / total) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
