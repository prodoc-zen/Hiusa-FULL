import { TONE_STYLES, resolveStatus } from './statusTones';

// Text plus color, no dot, never interactive. Callers should not render a badge for
// the default state of a record.
export default function StatusBadge({ status, label, tone, className = '' }) {
  const resolved = resolveStatus(status);
  const finalTone = tone || resolved.tone;
  const finalLabel = label || resolved.label;

  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded px-2 text-xs font-medium ${TONE_STYLES[finalTone] || TONE_STYLES.neutral} ${className}`}
    >
      {finalLabel}
    </span>
  );
}
