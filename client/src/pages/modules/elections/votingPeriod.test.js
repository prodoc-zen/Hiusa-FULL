import { describe, expect, it } from 'vitest';
import { formatSchedule } from './votingPeriod';

describe('formatSchedule', () => {
  it('shares the closing year and the time when voting opens and closes at the same time of day', () => {
    expect(formatSchedule('2026-11-13T11:38:00Z', '2026-11-21T11:38:00Z')).toBe('Nov 13 to Nov 21, 2026, 7:38 PM');
  });

  it('gives each end its own time when they differ', () => {
    expect(formatSchedule('2026-11-13T00:00:00Z', '2026-11-21T09:00:00Z')).toBe('Nov 13, 8:00 AM to Nov 21, 2026, 5:00 PM');
  });

  it('says so when a date is missing', () => {
    expect(formatSchedule(null, '2026-11-21T09:00:00Z')).toBe('Schedule not set');
  });
});
