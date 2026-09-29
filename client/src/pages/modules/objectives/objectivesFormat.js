import { number, peso } from '../../../lib/format';

export const STATUS_PRESENTATION = {
  live: { tone: 'success', label: 'Live' },
  partial: { tone: 'warning', label: 'Partial' },
  no_data: { tone: 'neutral', label: 'No data yet' },
};

export function presentStatus(status) {
  return STATUS_PRESENTATION[status] || STATUS_PRESENTATION.no_data;
}

// Percent evidence follows this app's existing convention for domain
// percentages (see turnout_percent in ManageVotersPage): already a 0-100
// number, not a 0-1 fraction, so it renders directly instead of through
// lib/format's fraction-based percent().
export function formatEvidenceValue(item) {
  const { value, unit } = item || {};
  if (value === null || value === undefined) return 'Not tracked';
  if (unit === 'php') return peso(value);
  if (unit === 'percent') return `${number(value)}%`;
  if (typeof value === 'number') return number(value);
  return String(value);
}

export function isZeroEvidence(item) {
  return typeof item?.value === 'number' && item.value === 0;
}
