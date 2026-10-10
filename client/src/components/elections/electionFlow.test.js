import { describe, expect, it } from 'vitest';
import { electionStatusChip, finalizeChecklist, isReturned, resultsLink, roleBanner, studentVoteState, withApprovalState, workspaceSteps } from './electionFlow';

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

describe('workspaceSteps', () => {
  const election = { id: 12, status: 'upcoming', finalized_at: null };

  it('puts party lists before candidates, with voters and results last, for the Admin', () => {
    const steps = workspaceSteps('ADMIN', election);
    expect(steps.map((step) => step.label)).toEqual(['Overview', 'Party lists', 'Candidates', 'Voters', 'Results']);
    expect(steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]);
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

  it('counts positions without candidates and names the missing party list candidates', () => {
    const checklist = finalizeChecklist({ positions, candidates: [{ id: 9, position_id: 1, partylist_id: null }] });
    expect(checklist.ready).toBe(false);
    expect(checklist.items.find((item) => item.key === 'candidates').label).toBe('Positions without candidates: 2');
    expect(checklist.items.find((item) => item.key === 'partylist').label).toBe('Party list candidates missing');
    expect(checklist.disabledReason).toBe('Add a candidate to each of the 2 positions that has none first.');
  });

  it('asks for a party list candidate once every position has a candidate', () => {
    const checklist = finalizeChecklist({ positions: [{ id: 1 }], candidates: [{ id: 9, position_id: 1, partylist_id: null }] });
    expect(checklist.disabledReason).toBe('Assign at least one candidate to a party list first.');
  });

  it('is ready when every position has a candidate and one belongs to a party list', () => {
    const checklist = finalizeChecklist({ positions: [{ id: 1 }], candidates: [{ id: 9, position_id: 1, partylist_id: 4 }] });
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
});

describe('role banners and status', () => {
  it('words the banner for what each role does', () => {
    expect(roleBanner('ADMIN')).toMatch(/You run this election/);
    expect(roleBanner('SBO_OFFICER')).toMatch(/candidates and voters/);
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
