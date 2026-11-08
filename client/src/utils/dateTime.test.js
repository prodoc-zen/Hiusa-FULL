import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime, isoToLocalDateTimeInput, localDateTimeToIso, manilaDateStamp, replaceIsoDateTimes } from './dateTime';

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

describe('manilaDateStamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the Manila day when UTC is still the previous evening', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T17:30:00Z'));

    expect(manilaDateStamp()).toBe('2026-11-09');
  });

  it('returns the same day when Manila has not rolled over yet', () => {
    expect(manilaDateStamp(new Date('2026-11-09T15:59:00Z'))).toBe('2026-11-09');
    expect(manilaDateStamp(new Date('2026-11-09T16:00:00Z'))).toBe('2026-11-10');
  });
});
