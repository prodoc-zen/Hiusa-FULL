export default function ProgressMeter({ label, value, max = 100, valueLabel, className = '' }) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const percent = Math.round(ratio * 100);
  const tone = percent >= 100 ? 'bg-danger' : percent >= 80 ? 'bg-warning' : 'bg-brand-600';

  return (
    <div className={className}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-ink-muted">
          {label && <span>{label}</span>}
          {valueLabel && <span className="tabular-nums text-ink">{valueLabel}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-line-soft"
      >
        <div
          className={`h-full w-full origin-left rounded-full transition-transform duration-300 ease-[var(--ease-out)] ${tone}`}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </div>
  );
}
