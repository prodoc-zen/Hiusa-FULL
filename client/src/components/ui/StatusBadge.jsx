import { TONE_DOT, TONE_STYLES, resolveStatus } from './statusTones';

export default function StatusBadge({ status, label, tone, className = '' }) {
  const resolved = resolveStatus(status);
  const finalTone = tone || resolved.tone;
  const finalLabel = label || resolved.label;

  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-bold ${TONE_STYLES[finalTone] || TONE_STYLES.neutral} ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[finalTone] || TONE_DOT.neutral}`} aria-hidden="true" />
      {finalLabel}
    </span>
  );
}
