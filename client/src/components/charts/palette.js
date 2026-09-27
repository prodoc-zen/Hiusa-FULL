export const SERIES_COLORS = ['#0F2F62', '#0B8ED0', '#16C7F3', '#16A34A', '#F59E0B'];

export const TEXT_STRONG = '#0F172A';
export const TEXT_MUTED = '#64748B';
export const GRID_LINE = '#E5EDF3';
export const GRID_LINE_SOFT = '#DDE7EF';

export const TONE = {
  neutral: { fill: '#0B8ED0', text: '#0F172A' },
  brand: { fill: '#0B8ED0', text: '#0F172A' },
  warning: { fill: '#F59E0B', text: '#B45309' },
  danger: { fill: '#DC2626', text: '#B91C1C' },
  success: { fill: '#16A34A', text: '#15803D' },
};

export function seriesColor(index) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export function toneForRatio(ratio) {
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'neutral';
}
