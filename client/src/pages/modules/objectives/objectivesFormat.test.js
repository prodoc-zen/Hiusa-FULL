import { describe, expect, it } from 'vitest';
import { formatEvidenceValue, isZeroEvidence, presentStatus } from './objectivesFormat';

describe('presentStatus', () => {
  it('maps every documented status to a tone and label', () => {
    expect(presentStatus('live')).toEqual({ tone: 'success', label: 'Live' });
    expect(presentStatus('partial')).toEqual({ tone: 'warning', label: 'Partial' });
    expect(presentStatus('no_data')).toEqual({ tone: 'neutral', label: 'No data yet' });
  });

  it('falls back to no_data for an unrecognized status', () => {
    expect(presentStatus('unknown')).toEqual({ tone: 'neutral', label: 'No data yet' });
    expect(presentStatus(undefined)).toEqual({ tone: 'neutral', label: 'No data yet' });
  });
});

describe('formatEvidenceValue', () => {
  it('formats php evidence with the peso helper', () => {
    expect(formatEvidenceValue({ value: 1234.5, unit: 'php' })).toBe('₱1,234.50');
  });

  it('formats percent evidence as an already-scaled percentage', () => {
    expect(formatEvidenceValue({ value: 42, unit: 'percent' })).toBe('42%');
  });

  it('formats an acceptability mean to two decimals like Table 3', () => {
    expect(formatEvidenceValue({ value: 4, unit: 'mean' })).toBe('4.00');
    expect(formatEvidenceValue({ value: 3.414, unit: 'mean' })).toBe('3.41');
  });

  it('formats count evidence with thousands separators', () => {
    expect(formatEvidenceValue({ value: 1200, unit: 'count' })).toBe('1,200');
  });

  it('reports zero honestly instead of padding it', () => {
    expect(formatEvidenceValue({ value: 0, unit: 'count' })).toBe('0');
  });

  it('never invents a number for a null value', () => {
    expect(formatEvidenceValue({ value: null, unit: null })).toBe('Not tracked');
  });

  it('falls back to the raw value for a non-numeric metric', () => {
    expect(formatEvidenceValue({ value: 'active', unit: null })).toBe('active');
  });
});

describe('isZeroEvidence', () => {
  it('is true only for a literal numeric zero', () => {
    expect(isZeroEvidence({ value: 0 })).toBe(true);
    expect(isZeroEvidence({ value: 5 })).toBe(false);
    expect(isZeroEvidence({ value: null })).toBe(false);
    expect(isZeroEvidence({ value: 'active' })).toBe(false);
  });
});
