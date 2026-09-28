import { describe, expect, it } from 'vitest';
import { compactPeso, greetingFor, manilaDate, manilaTime, number, peso, percent, relativeTime } from './format';

describe('peso', () => {
  it('formats a positive amount with two decimals', () => {
    expect(peso(1234.5)).toBe('₱1,234.50');
  });

  it('formats a negative amount with the sign before the currency symbol', () => {
    expect(peso(-500)).toBe('-₱500.00');
  });

  it('formats a numeric string, stripping commas', () => {
    expect(peso('1,234.50')).toBe('₱1,234.50');
  });

  it('treats null, undefined and empty string as zero', () => {
    expect(peso(null)).toBe('₱0.00');
    expect(peso(undefined)).toBe('₱0.00');
    expect(peso('')).toBe('₱0.00');
  });

  it('treats a non-numeric string as zero', () => {
    expect(peso('not a number')).toBe('₱0.00');
  });
});

describe('compactPeso', () => {
  it('compacts thousands to one decimal with a K suffix', () => {
    expect(compactPeso(38200)).toBe('₱38.2K');
  });

  it('compacts millions to one decimal with an M suffix', () => {
    expect(compactPeso(1200000)).toBe('₱1.2M');
  });

  it('drops a trailing .0', () => {
    expect(compactPeso(2000000)).toBe('₱2M');
  });

  it('falls back to full peso formatting below one thousand', () => {
    expect(compactPeso(500)).toBe('₱500.00');
  });

  it('keeps the sign for negative compacted amounts', () => {
    expect(compactPeso(-38200)).toBe('-₱38.2K');
  });
});

describe('number', () => {
  it('groups thousands', () => {
    expect(number(1234567)).toBe('1,234,567');
  });

  it('treats null and undefined as zero', () => {
    expect(number(null)).toBe('0');
    expect(number(undefined)).toBe('0');
  });
});

describe('percent', () => {
  it('formats a ratio as a whole percent by default', () => {
    expect(percent(0.834)).toBe('83%');
  });

  it('accepts a digits argument', () => {
    expect(percent(0.8345, 1)).toBe('83.5%');
  });

  it('handles negative ratios', () => {
    expect(percent(-0.25)).toBe('-25%');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('reports a moment within 45 seconds as just now', () => {
    expect(relativeTime(new Date('2026-06-15T12:00:20Z'), now)).toBe('just now');
    expect(relativeTime(new Date('2026-06-15T11:59:40Z'), now)).toBe('just now');
  });

  it('reports hours in the past', () => {
    expect(relativeTime(new Date('2026-06-15T09:00:00Z'), now)).toBe('3 hours ago');
  });

  it('reports days in the future', () => {
    expect(relativeTime(new Date('2026-06-17T12:00:00Z'), now)).toBe('in 2 days');
  });

  it('uses singular units for a value of one', () => {
    expect(relativeTime(new Date('2026-06-15T13:00:00Z'), now)).toBe('in 1 hour');
    expect(relativeTime(new Date('2026-06-14T12:00:00Z'), now)).toBe('1 day ago');
  });

  it('returns an empty string for an invalid date', () => {
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('manilaDate and manilaTime', () => {
  it('renders a UTC instant that has already rolled to the next day in Manila', () => {
    const utcEveningJan1 = new Date('2026-01-01T20:00:00Z');
    expect(manilaDate(utcEveningJan1)).toBe('Jan 2, 2026');
    expect(manilaTime(utcEveningJan1)).toBe('4:00 AM');
  });

  it('renders a UTC instant that is still the same day in Manila', () => {
    const utcMorning = new Date('2026-01-01T02:00:00Z');
    expect(manilaDate(utcMorning)).toBe('Jan 1, 2026');
  });

  it('supports a long date style', () => {
    const date = new Date('2026-03-05T00:00:00Z');
    expect(manilaDate(date, 'long')).toBe('March 5, 2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(manilaDate('nonsense')).toBe('');
    expect(manilaTime('nonsense')).toBe('');
  });
});

describe('greetingFor', () => {
  it('returns morning when it is 7am in Manila even though UTC is still the prior evening', () => {
    // 2026-06-14T23:00:00Z is 2026-06-15 07:00 in Asia/Manila (UTC+8)
    expect(greetingFor(new Date('2026-06-14T23:00:00Z'))).toBe('morning');
  });

  it('returns afternoon at 2pm Manila time', () => {
    // 06:00Z + 8h = 14:00 Manila
    expect(greetingFor(new Date('2026-06-15T06:00:00Z'))).toBe('afternoon');
  });

  it('returns evening at 8pm Manila time', () => {
    // 12:00Z + 8h = 20:00 Manila
    expect(greetingFor(new Date('2026-06-15T12:00:00Z'))).toBe('evening');
  });

  it('returns evening in the small hours of the morning', () => {
    // 20:00Z + 8h = 04:00 Manila (next day)
    expect(greetingFor(new Date('2026-06-14T20:00:00Z'))).toBe('evening');
  });
});
