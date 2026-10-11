import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, monthStartOf, rangeLabel, rangeParams, shiftAnchor, viewDays, weekStartOf,
} from './calendarDates';

describe('calendarDates', () => {
  it('anchors weeks on Monday in Manila time', () => {
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02');
    expect(monthStartOf('2026-10-23')).toBe('2026-10-01');
  });

  it('moves a month at a time and clamps to the last day of a shorter month', () => {
    expect(addMonths('2026-10-15', 1)).toBe('2026-11-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-10');
  });

  it('lists the days a view paints, whole weeks for a month', () => {
    expect(viewDays('day', '2026-10-07')).toEqual(['2026-10-07']);
    expect(viewDays('week', '2026-10-07')).toHaveLength(7);
    const month = viewDays('month', '2026-10-15');
    expect(month[0]).toBe('2026-09-28');
    expect(month[month.length - 1]).toBe('2026-11-01');
    expect(month).toHaveLength(35);
    expect(viewDays('month', '2026-11-15')).toHaveLength(42);
    expect(viewDays('month', '2027-02-10')).toHaveLength(28);
  });

  it('asks the server for the whole visible window in Manila time', () => {
    expect(rangeParams('day', '2026-10-07')).toEqual({ from: '2026-10-07T00:00:00+08:00', to: '2026-10-07T23:59:59+08:00' });
    expect(rangeParams('week', '2026-10-07')).toEqual({ from: '2026-10-05T00:00:00+08:00', to: '2026-10-11T23:59:59+08:00' });
    expect(rangeParams('month', '2026-10-15')).toEqual({ from: '2026-09-28T00:00:00+08:00', to: '2026-11-01T23:59:59+08:00' });
  });

  it('shifts each view by its own unit and labels the range', () => {
    expect(shiftAnchor('day', '2026-10-07', 1)).toBe('2026-10-08');
    expect(shiftAnchor('week', '2026-10-07', -1)).toBe('2026-09-30');
    expect(shiftAnchor('month', '2026-10-07', 1)).toBe('2026-11-07');
    expect(rangeLabel('week', '2026-10-07')).toBe('Oct 5 - Oct 11, 2026');
    expect(rangeLabel('month', '2026-10-07')).toBe('October 2026');
    expect(rangeLabel('day', '2026-10-07')).toBe('Wednesday, October 7, 2026');
  });
});
