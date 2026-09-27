import { TONE, seriesColor } from './palette';

export default function BarList({ items = [], max, valueFormat, title, description }) {
  const safeItems = items.map((item) => ({ ...item, value: Number(item.value) || 0 }));
  const format = valueFormat || ((amount) => String(amount));
  const hasSecondary = safeItems.some((item) => item.secondaryValue !== undefined);
  const computedMax = Number.isFinite(max) && max > 0
    ? max
    : Math.max(1, ...safeItems.map((item) => Math.abs(item.value)));

  return (
    <section aria-label={title}>
      {title && <h3 className="text-sm font-bold text-ink">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}

      {safeItems.length === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-ink-muted">No data for this period yet</p>
      ) : (
        <>
          <ul className={title || description ? 'mt-3 space-y-3' : 'space-y-3'}>
            {safeItems.map((item, index) => {
              const widthPct = computedMax > 0 ? Math.min(100, (Math.abs(item.value) / computedMax) * 100) : 0;
              const color = (item.tone && TONE[item.tone]?.fill) || item.color || seriesColor(index);
              return (
                <li key={item.label}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-ink">
                    <span className="min-w-0 truncate" title={item.label}>{item.label}</span>
                    <span className="shrink-0 tabular-nums">
                      {format(item.value)}
                      {item.secondaryValue !== undefined && (
                        <span className="ml-1.5 font-medium text-ink-muted">{format(item.secondaryValue)}</span>
                      )}
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-line-soft">
                    <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: color }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <table className="sr-only table-fixed">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th>Label</th>
                <th>Value</th>
                {hasSecondary && <th>Secondary value</th>}
              </tr>
            </thead>
            <tbody>
              {safeItems.map((item) => (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td>{format(item.value)}</td>
                  {hasSecondary && <td>{item.secondaryValue !== undefined ? format(item.secondaryValue) : ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
