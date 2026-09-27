import { TONE, toneForRatio } from './palette';

export default function Meter({ value, limit, label, format, tone }) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 0;
  const ratio = safeLimit > 0 ? safeValue / safeLimit : 0;
  const fillWidth = Math.max(0, Math.min(ratio, 1)) * 100;
  const resolvedTone = tone || toneForRatio(ratio);
  const colors = TONE[resolvedTone] || TONE.neutral;
  const formatValue = format || ((amount) => String(amount));
  const percentLabel = safeLimit > 0 ? `${Math.round(ratio * 100)}%` : 'No limit set';

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-ink-muted">
        <span className="min-w-0 truncate" title={label}>{label}</span>
        <span className="tabular-nums" style={{ color: colors.text }}>{percentLabel}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={safeValue}
        aria-valuemin={0}
        aria-valuemax={safeLimit || safeValue}
        className="h-2 w-full overflow-hidden rounded-full bg-line-soft"
      >
        <div className="h-full rounded-full" style={{ width: `${fillWidth}%`, backgroundColor: colors.fill }} />
      </div>
      <p className="mt-1.5 text-xs font-medium tabular-nums text-ink-muted">
        {formatValue(safeValue)} of {formatValue(safeLimit)}
      </p>
    </div>
  );
}
