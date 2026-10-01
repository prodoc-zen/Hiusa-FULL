import { describe, expect, it } from 'vitest';
import { canViewElectionResults, isVotingOpen } from './electionAccess';

describe('election access states', () => {
  it('opens voting only while an active election is within its scheduled period', () => {
    const now = Date.now();
    const open = { status: 'active', approved_at: new Date(now - 120_000).toISOString(), finalized_at: new Date(now - 90_000).toISOString(), start_time: new Date(now - 60_000).toISOString(), end_time: new Date(now + 60_000).toISOString() };
    expect(isVotingOpen(open)).toBe(true);
    expect(isVotingOpen({ ...open, status: 'upcoming' })).toBe(false);
    expect(isVotingOpen({ ...open, start_time: new Date(now + 60_000).toISOString() })).toBe(false);
    expect(isVotingOpen({ ...open, end_time: new Date(now - 60_000).toISOString() })).toBe(false);
    expect(isVotingOpen({ ...open, finalized_at: null })).toBe(false);
  });

  it('shows live totals after finalization and respects result visibility', () => {
    const finalized_at = '2026-09-01T08:00:00Z';
    expect(canViewElectionResults({ status: 'closed', finalized_at, results_visible: false }, 'STUDENT')).toBe(false);
    expect(canViewElectionResults({ status: 'closed', finalized_at, results_visible: false }, 'ADMIN')).toBe(true);
    expect(canViewElectionResults({ status: 'closed', finalized_at, results_visible: true }, 'STUDENT')).toBe(true);
    expect(canViewElectionResults({ status: 'active', finalized_at, results_visible: true }, 'STUDENT')).toBe(true);
    expect(canViewElectionResults({ status: 'active', results_visible: true }, 'STUDENT')).toBe(false);
  });
});
