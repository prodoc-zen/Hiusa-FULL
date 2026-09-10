import { describe, expect, it } from 'vitest';
import { formatDateTime, isoToLocalDateTimeInput, localDateTimeToIso, replaceIsoDateTimes } from './dateTime';

describe('date and time formatting', () => {
  it('shows ISO timestamps as readable dates without machine suffixes', () => {
    const formatted = formatDateTime('2026-09-01T08:00:00.000000Z');

    expect(formatted).toContain('2026');
    expect(formatted).not.toContain('T08:00:00');
    expect(formatted).not.toContain('000000Z');
  });

  it('replaces timestamps inside AI-written planning text', () => {
    const result = replaceIsoDateTimes('Finish by 2026-09-01T08:00:00.000000Z before setup.');

    expect(result).toContain('Finish by');
    expect(result).toContain('2026');
    expect(result).not.toContain('000000Z');
  });

  it('round-trips API dates through a local date-time input', () => {
    const localValue = isoToLocalDateTimeInput('2026-09-01T08:00:00.000Z');

    expect(localDateTimeToIso(localValue)).toBe('2026-09-01T08:00:00.000Z');
  });
});
