const DEFAULT_COLORS = ['#0F2F62', '#0B8ED0', '#16A34A', '#F59E0B', '#64748B'];

export default function DataDonutChart({ title, description, segments, centerValue, centerLabel }) {
  const normalized = segments
    .map((segment, index) => ({ ...segment, value: Math.max(0, Number(segment.value || 0)), color: segment.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length] }))
    .filter((segment) => segment.value > 0);
  const total = normalized.reduce((sum, segment) => sum + segment.value, 0);
  const chartSegments = normalized.map((segment, index) => {
    const percentage = total > 0 ? (segment.value / total) * 100 : 0;
    const previousPercentage = normalized
      .slice(0, index)
      .reduce((sum, previous) => sum + (previous.value / total) * 100, 0);
    return { ...segment, percentage, offset: -previousPercentage };
  });

  return (
    <section className="rounded-lg border border-[#DDE7EF] bg-white p-4 sm:p-5" aria-labelledby={`${title.replace(/\s+/g, '-').toLowerCase()}-title`}>
      <div>
        <h2 id={`${title.replace(/\s+/g, '-').toLowerCase()}-title`} className="text-sm font-black text-[#0F172A]">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm font-medium text-slate-500">No matching data to chart.</p>
      ) : (
        <div className="mt-4 grid items-center gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="relative mx-auto h-40 w-40" role="img" aria-label={`${title}: ${normalized.map((segment) => `${segment.label} ${segment.value}`).join(', ')}`}>
            <svg viewBox="0 0 160 160" className="h-full w-full" aria-hidden="true">
              <circle cx="80" cy="80" r="56" fill="none" stroke="#EEF6FB" strokeWidth="24" />
              {chartSegments.map((segment) => <circle key={segment.label} cx="80" cy="80" r="56" pathLength="100" fill="none" stroke={segment.color} strokeWidth="24" strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`} strokeDashoffset={segment.offset} transform="rotate(-90 80 80)" />)}
            </svg>
            <div className="absolute inset-0 grid place-content-center text-center">
              <p className="text-2xl font-black tabular-nums text-[#0F172A]">{Number(centerValue ?? total).toLocaleString()}</p>
              <p className="max-w-20 text-[10px] font-bold uppercase leading-4 tracking-wide text-slate-500">{centerLabel}</p>
            </div>
          </div>
          <dl className="space-y-2.5">
            {normalized.map((segment) => (
              <div key={segment.label} className="flex items-center gap-2.5">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} aria-hidden="true" />
                <dt className="min-w-0 flex-1 text-xs font-semibold text-slate-600">{segment.label}</dt>
                <dd className="text-sm font-black tabular-nums text-[#0F172A]">{segment.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <table className="sr-only"><caption>{title}</caption><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>{normalized.map((segment) => <tr key={segment.label}><td>{segment.label}</td><td>{segment.value}</td></tr>)}</tbody></table>
        </div>
      )}
    </section>
  );
}
