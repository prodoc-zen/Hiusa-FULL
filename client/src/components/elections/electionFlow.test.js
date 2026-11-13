import { describe, expect, it } from 'vitest';
import { electionStatusChip, finalizeChecklist, isReturned, nextDeadline, resultsLink, roleBanner, studentVoteState, withApprovalState, workspaceSteps } from './electionFlow';

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

describe('workspaceSteps', () => {
  const election = { id: 12, status: 'upcoming', finalized_at: null };

  it('puts party lists before candidates, with voters and results last, for the Admin', () => {
    const steps = workspaceSteps('ADMIN', election);
    expect(steps.map((step) => step.label)).toEqual(['Overview', 'Party lists', 'Candidates', 'Voters', 'Results']);
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('adds Applications after Overview only for an election where students file their own candidacy', () => {
    const filing = { ...election, filing_starts_at: FUTURE };
    const steps = workspaceSteps('ADMIN', filing);
    expect(steps.map((step) => step.label)).toEqual(['Overview', 'Applications', 'Party lists', 'Candidates', 'Voters', 'Results']);
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.find((step) => step.key === 'applications').to).toBe('/dashboard/elections/applications?record=12');
    expect(workspaceSteps('SBO_OFFICER', filing).map((step) => step.label)).toEqual(['Applications', 'Candidates', 'Voters', 'Results']);
    expect(workspaceSteps('DEPARTMENT_HEAD', filing).map((step) => step.label)).toEqual(['Results']);
    expect(workspaceSteps('STUDENT', filing).map((step) => step.label)).toEqual(['Results']);
    expect(workspaceSteps('ADMIN', filing, '/dashboard/elections/applications').filter((step) => step.active).map((step) => step.key)).toEqual(['applications']);
  });

  it('keeps the election in the URL of every step', () => {
    const steps = workspaceSteps('ADMIN', election);
    expect(steps.find((step) => step.key === 'partylists').to).toBe('/dashboard/elections/manage-partylists?record=12');
    expect(steps.find((step) => step.key === 'candidates').to).toBe('/dashboard/elections/manage-candidates?record=12');
  });

  it('opens the Admin voters step on the overview route, because the voters route is Officer only', () => {
    const admin = workspaceSteps('ADMIN', election).find((step) => step.key === 'voters');
    expect(admin.to).toBe('/dashboard/elections/manage-elections?record=12&view=voters');
    const officer = workspaceSteps('SBO_OFFICER', election).find((step) => step.key === 'voters');
    expect(officer.to).toBe('/dashboard/elections/manage-voters?record=12');
  });

  it('shows each role only the steps it can open', () => {
    expect(workspaceSteps('SBO_OFFICER', election).map((step) => step.label)).toEqual(['Candidates', 'Voters', 'Results']);
    expect(workspaceSteps('DEPARTMENT_HEAD', election).map((step) => step.label)).toEqual(['Results']);
    expect(workspaceSteps('STUDENT', election).map((step) => step.label)).toEqual(['Results']);
  });

  it('marks the voters step and not the overview when the Admin is on the voters view', () => {
    const steps = workspaceSteps('ADMIN', election, '/dashboard/elections/manage-elections', 'voters');
    expect(steps.filter((step) => step.active).map((step) => step.key)).toEqual(['voters']);
    const overview = workspaceSteps('ADMIN', election, '/dashboard/elections/manage-elections', null);
    expect(overview.filter((step) => step.active).map((step) => step.key)).toEqual(['overview']);
  });

  it('keeps results unavailable until a finalized election is open and released', () => {
    expect(workspaceSteps('SBO_OFFICER', election).find((step) => step.key === 'results').available).toBe(false);
    const closed = { id: 12, status: 'closed', finalized_at: PAST, results_visible: true };
    expect(workspaceSteps('SBO_OFFICER', closed).find((step) => step.key === 'results').available).toBe(true);
  });
});

describe('finalizeChecklist', () => {
  const positions = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('counts positions without candidates and no longer asks for a party list', () => {
    const checklist = finalizeChecklist({ positions, candidates: [{ id: 9, position_id: 1, partylist_id: null }] });
    expect(checklist.ready).toBe(false);
    expect(checklist.items.map((item) => item.key)).toEqual(['positions', 'candidates']);
    expect(checklist.items.find((item) => item.key === 'candidates').label).toBe('Positions without candidates: 2');
    expect(checklist.disabledReason).toBe('Add a candidate to each of the 2 positions that has none first.');
  });

  it('is ready when every position has a candidate, even with every candidate independent', () => {
    const checklist = finalizeChecklist({ positions: [{ id: 1 }], candidates: [{ id: 9, position_id: 1, partylist_id: null }] });
    expect(checklist.ready).toBe(true);
    expect(checklist.disabledReason).toBeUndefined();
  });

  it('blocks an election with no positions', () => {
    const checklist = finalizeChecklist({ positions: [], candidates: [] });
    expect(checklist.ready).toBe(false);
    expect(checklist.disabledReason).toBe('Add a position to the ballot first.');
  });
});

describe('studentVoteState', () => {
  const open = { status: 'active', finalized_at: PAST, start_time: PAST, end_time: FUTURE, my_votes: [] };

  it('says Open while a finalized election accepts ballots', () => {
    expect(studentVoteState(open)).toEqual({ key: 'open', label: 'Open' });
  });

  it('reads has_voted from the payload, since a ballot no longer lists the voter choices', () => {
    expect(studentVoteState({ ...open, has_voted: true }).label).toBe('Voted');
    expect(studentVoteState({ ...open, status: 'closed', has_voted: true }).label).toBe('Voted');
    expect(studentVoteState({ ...open, has_voted: false, my_votes: [{ vote_hash: 'H' }] }).label).toBe('Open');
  });

  it('says Voted as soon as the viewer has a ballot, even after the election closes', () => {
    expect(studentVoteState({ ...open, my_votes: [{ vote_hash: 'H' }] }).label).toBe('Voted');
    expect(studentVoteState({ ...open, status: 'closed', my_votes: [{ vote_hash: 'H' }] }).label).toBe('Voted');
  });

  it('says Upcoming before the voting period and Closed after it', () => {
    expect(studentVoteState({ status: 'upcoming', finalized_at: PAST, start_time: FUTURE, end_time: FUTURE, my_votes: [] }).label).toBe('Upcoming');
    expect(studentVoteState({ status: 'closed', finalized_at: PAST, start_time: PAST, end_time: PAST, my_votes: [] }).label).toBe('Closed');
    expect(studentVoteState({ status: 'active', finalized_at: PAST, start_time: PAST, end_time: PAST, my_votes: [] }).label).toBe('Closed');
  });
});

describe('resultsLink', () => {
  it('reads Available when voting closes until results can be read', () => {
    const hidden = { id: 3, status: 'active', finalized_at: PAST, results_visible: false };
    expect(resultsLink(hidden, 'STUDENT')).toEqual({ available: false, text: 'Available when voting closes' });
    expect(resultsLink({ id: 3, status: 'upcoming' }, 'STUDENT').text).toBe('Available when voting closes');
  });

  it('names the Admin as the one who releases a closed election', () => {
    const closed = { id: 3, status: 'closed', finalized_at: PAST, results_visible: false };
    expect(resultsLink(closed, 'STUDENT').text).toBe('Available when the Admin releases the results');
  });

  it('links to the results of the election once released', () => {
    const released = { id: 3, status: 'closed', finalized_at: PAST, results_visible: true };
    expect(resultsLink(released, 'STUDENT')).toEqual({ available: true, label: 'View results', to: '/dashboard/elections/election-results?record=3' });
  });

  it('offers turnout, not totals, while voting is still open', () => {
    const open = { id: 3, status: 'active', finalized_at: PAST, results_visible: true };
    expect(resultsLink(open, 'STUDENT').label).toBe('View turnout');
  });
});

describe('role banners and status', () => {
  it('words the banner for what each role does', () => {
    expect(roleBanner('ADMIN')).toMatch(/You run this election/);
    expect(roleBanner('SBO_OFFICER')).toBe('You can follow the candidates, the voters and the results. The Admin runs the election.');
    expect(roleBanner('DEPARTMENT_HEAD')).toMatch(/approve elections/);
    expect(roleBanner('STUDENT')).toMatch(/Vote while the election is open/);
  });

  it('treats a returned flag as a rejected approval and tolerates payloads without either', () => {
    expect(withApprovalState({ status: 'pending_approval', returned: true }).approval_status).toBe('rejected');
    expect(isReturned({ status: 'pending_approval', approval_status: 'rejected' })).toBe(true);
    expect(isReturned({ status: 'pending_approval' })).toBe(false);
    expect(isReturned({ status: 'upcoming', approval_status: 'rejected' })).toBe(false);
    expect(electionStatusChip({ status: 'pending_approval', returned: true })).toEqual({ label: 'Returned', tone: 'danger' });
    expect(electionStatusChip({ status: 'pending_approval' }).label).toBe('Pending approval');
  });
});

describe('electionStatusChip by phase', () => {
  const withPhase = (phase, extra = {}) => ({ status: 'upcoming', filing_starts_at: FUTURE, submitted_at: PAST, phase, ...extra });

  it.each([
    ['scheduled', 'Scheduled'],
    ['filing', 'Filing open'],
    ['screening', 'Screening'],
    ['campaign', 'Campaign'],
    ['voting', 'Voting open'],
    ['canvassing', 'Canvassing'],
    ['runoff', 'Runoff voting'],
    ['tie_resolution', 'Pending tie resolution'],
    ['completed', 'Completed'],
  ])('labels the %s phase %s', (phase, label) => {
    expect(electionStatusChip(withPhase(phase)).label).toBe(label);
  });

  it('reads a draft, a final rejection, a suspension and a cancellation before the phase', () => {
    expect(electionStatusChip({ status: 'pending_approval', filing_starts_at: FUTURE, submitted_at: null, phase: null }).label).toBe('Draft');
    expect(electionStatusChip({ status: 'pending_approval', filing_starts_at: FUTURE, submitted_at: PAST, phase: null, approval_status: 'rejected', declined_at: PAST })).toEqual({ label: 'Rejected', tone: 'danger' });
    expect(electionStatusChip(withPhase('filing', { suspended_at: PAST })).label).toBe('Suspended');
    expect(electionStatusChip(withPhase('cancelled', { cancelled_at: PAST })).label).toBe('Cancelled');
    expect(electionStatusChip(withPhase('filing', { cancelled_at: PAST, suspended_at: PAST })).label).toBe('Cancelled');
  });

  it('keeps a returned filing election Returned, and a submitted one Pending approval', () => {
    expect(electionStatusChip({ status: 'pending_approval', filing_starts_at: FUTURE, submitted_at: PAST, phase: null, approval_status: 'rejected' }).label).toBe('Returned');
    expect(electionStatusChip({ status: 'pending_approval', filing_starts_at: FUTURE, submitted_at: PAST, phase: null }).label).toBe('Pending approval');
  });

  it('keeps today labels for an election with no phase', () => {
    expect(electionStatusChip({ status: 'upcoming', phase: null, submitted_at: PAST }).label).toBe('Upcoming');
    expect(electionStatusChip({ status: 'active', phase: null }).label).toBe('Voting open');
    expect(electionStatusChip({ status: 'closed', phase: null })).toEqual({ label: 'Closed', tone: 'neutral' });
    expect(electionStatusChip({ status: 'pending_approval', submitted_at: null }).label).toBe('Pending approval');
  });

  it('does not call a final rejection a return', () => {
    expect(isReturned({ status: 'pending_approval', approval_status: 'rejected', declined_at: PAST })).toBe(false);
  });
});

describe('nextDeadline', () => {
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString();
  const schedule = { filing_starts_at: day(1), filing_ends_at: day(3), screening_starts_at: day(4), screening_ends_at: day(6), campaign_starts_at: day(7), campaign_ends_at: day(9), start_time: day(10), end_time: day(11), results_publish_at: day(12) };

  it('names the first date still ahead, in schedule order', () => {
    expect(nextDeadline(schedule).name).toBe('Filing opens');
    expect(nextDeadline({ ...schedule, filing_starts_at: day(-3) }).name).toBe('Filing closes');
    expect(nextDeadline({ ...schedule, filing_starts_at: day(-3), filing_ends_at: day(-2), screening_starts_at: day(-1) }).name).toBe('Screening closes');
    expect(nextDeadline({ ...schedule, end_time: day(-1), start_time: day(-2), campaign_ends_at: day(-3), campaign_starts_at: day(-4), screening_ends_at: day(-5), screening_starts_at: day(-6), filing_ends_at: day(-7), filing_starts_at: day(-8) }).name).toBe('Results publish');
  });

  it('includes the runoff dates only when they are set', () => {
    const past = { filing_starts_at: day(-9), filing_ends_at: day(-8), screening_starts_at: day(-7), screening_ends_at: day(-6), campaign_starts_at: day(-5), campaign_ends_at: day(-4), start_time: day(-3), end_time: day(-2), results_publish_at: day(-1) };
    expect(nextDeadline(past)).toBeNull();
    expect(nextDeadline({ ...past, runoff_starts_at: day(2), runoff_ends_at: day(3), runoff_publish_at: day(4) })).toEqual({ name: 'Runoff opens', at: expect.any(String) });
  });

  it('returns nothing for an election with no dates', () => {
    expect(nextDeadline({})).toBeNull();
    expect(nextDeadline(null)).toBeNull();
  });
});
