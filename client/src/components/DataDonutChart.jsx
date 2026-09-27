import Donut from './charts/Donut';

export default function DataDonutChart({ title, description, segments, centerValue, centerLabel }) {
  const headingId = `${title.replace(/\s+/g, '-').toLowerCase()}-title`;

  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="text-sm font-black text-ink">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>}
      </div>
      <div className="mt-4">
        <Donut segments={segments} centerValue={centerValue} centerLabel={centerLabel} />
      </div>
    </section>
  );
}
