import { describe, expect, it } from 'vitest';
import { canViewElectionResults, isVotingOpen } from './electionAccess';

describe('election access states', () => {
  it('opens voting only while an active election is within its scheduled period', () => {
    const now = Date.now();
    const open = { status: 'active', start_time: new Date(now - 60_000).toISOString(), end_time: new Date(now + 60_000).toISOString() };
    expect(isVotingOpen(open)).toBe(true);
    expect(isVotingOpen({ ...open, status: 'upcoming' })).toBe(false);
    expect(isVotingOpen({ ...open, start_time: new Date(now + 60_000).toISOString() })).toBe(false);
    expect(isVotingOpen({ ...open, end_time: new Date(now - 60_000).toISOString() })).toBe(false);
  });

  it('shows closed results to students only after release', () => {
    expect(canViewElectionResults({ status: 'closed', results_visible: false }, 'STUDENT')).toBe(false);
    expect(canViewElectionResults({ status: 'closed', results_visible: false }, 'ADMIN')).toBe(true);
    expect(canViewElectionResults({ status: 'closed', results_visible: true }, 'STUDENT')).toBe(true);
    expect(canViewElectionResults({ status: 'active', results_visible: true }, 'STUDENT')).toBe(false);
  });
});
