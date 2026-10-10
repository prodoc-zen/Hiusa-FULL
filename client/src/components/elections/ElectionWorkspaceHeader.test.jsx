import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionWorkspaceHeader from './ElectionWorkspaceHeader';

const { finalizeElection, updateElection } = vi.hoisted(() => ({ finalizeElection: vi.fn(), updateElection: vi.fn() }));
vi.mock('../../services/electionService', () => ({ finalizeElection, updateElection }));

const PAST = new Date(Date.now() - 3_600_000).toISOString();
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const base = { id: 7, title: 'Council Election', start_time: FUTURE, end_time: FUTURE, positions: [], candidates: [] };

function renderHeader(election, role, { path = '/dashboard/elections/manage-elections', onChanged = vi.fn() } = {}) {
  localStorage.setItem('user', JSON.stringify({ role }));
  render(
    <MemoryRouter initialEntries={[path]}>
      <ElectionWorkspaceHeader election={election} role={role} onClear={vi.fn()} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return { onChanged };
}

function currentStage() {
  const items = within(screen.getByRole('list', { name: 'Election progress' })).getAllByRole('listitem');
  const item = items.find((li) => li.getAttribute('aria-current') === 'step') ?? items.find((li) => /Blocked:/.test(li.textContent));
  return item ? item.querySelector('p').textContent.replace(/^(Current step|Blocked): /, '') : null;
}

describe('ElectionWorkspaceHeader lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const cases = [
    ['pending approval, Admin', { ...base, status: 'pending_approval' }, 'ADMIN', 'Submitted', 'Awaiting Department Head review'],
    ['pending approval, Department Head', { ...base, status: 'pending_approval' }, 'DEPARTMENT_HEAD', 'Submitted', 'Review this election'],
    ['returned, Admin', { ...base, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Add the voting room.' }, 'ADMIN', 'Submitted', 'Returned: edit and resubmit'],
    ['returned by flag, Admin', { ...base, status: 'pending_approval', returned: true }, 'ADMIN', 'Submitted', 'Returned: edit and resubmit'],
    ['returned, Department Head', { ...base, status: 'pending_approval', approval_status: 'rejected' }, 'DEPARTMENT_HEAD', 'Submitted', 'Returned to the Admin for changes'],
    ['building the ballot, Admin', { ...base, status: 'upcoming', finalized_at: null }, 'ADMIN', 'Build ballot', 'Build the ballot'],
    ['building the ballot, Officer', { ...base, status: 'upcoming', finalized_at: null }, 'SBO_OFFICER', 'Build ballot', 'Build the ballot'],
    ['building the ballot, Student', { ...base, status: 'upcoming', finalized_at: null }, 'STUDENT', 'Build ballot', 'Waiting for the ballot to be built'],
    ['ballot locked, Admin', { ...base, status: 'upcoming', finalized_at: PAST }, 'ADMIN', 'Ballot locked', 'Ballot locked: open voting when it starts'],
    ['voting open, Student not voted', { ...base, status: 'active', finalized_at: PAST, has_voted: false }, 'STUDENT', 'Voting', 'Cast your ballot'],
    ['voting open, Student voted', { ...base, status: 'active', finalized_at: PAST, has_voted: true }, 'STUDENT', 'Voting', 'You have voted'],
    ['voting open, Officer', { ...base, status: 'active', finalized_at: PAST }, 'SBO_OFFICER', 'Voting', /^Voting is open/],
    ['closed unreleased, Admin', { ...base, status: 'closed', finalized_at: PAST, results_visible: false }, 'ADMIN', 'Results', 'Closed: release the results'],
    ['closed unreleased, Officer', { ...base, status: 'closed', finalized_at: PAST, results_visible: false }, 'SBO_OFFICER', 'Results', 'Closed: results not released yet'],
    ['results released, Student', { ...base, status: 'closed', finalized_at: PAST, results_visible: true }, 'STUDENT', null, 'Results released'],
  ];

  it.each(cases)('%s shows the stage and the next action', (_name, election, role, stage, nextTitle) => {
    renderHeader(election, role);
    expect(currentStage()).toBe(stage);
    expect(screen.getByText(nextTitle)).toBeInTheDocument();
  });

  it('shows the Department Head reason and the edit and resubmit action to the Admin on a returned election', () => {
    renderHeader({ ...base, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Add the voting room.' }, 'ADMIN');
    expect(screen.getByText('Add the voting room.')).toBeInTheDocument();
    expect(screen.getAllByText('Returned').length).toBeGreaterThan(1);
    expect(screen.getByRole('link', { name: 'Edit and resubmit' })).toHaveAttribute('href', '/dashboard/elections/manage-elections?edit=7');
  });

  it('falls back to a plain pending state when the payload has no approval fields', () => {
    renderHeader({ ...base, status: 'pending_approval' }, 'ADMIN');
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit and resubmit' })).not.toBeInTheDocument();
  });

  it('words the banner for each role', () => {
    renderHeader({ ...base, status: 'upcoming' }, 'SBO_OFFICER');
    expect(screen.getByText(/Manage the candidates and voters/)).toBeInTheDocument();
  });

  it('prints one h1 and names the selected election', () => {
    renderHeader({ ...base, status: 'upcoming' }, 'ADMIN');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Council Election')).toBeInTheDocument();
  });
});

describe('ElectionWorkspaceHeader step strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('lists the Admin steps in process order with the election in every link', () => {
    renderHeader({ ...base, status: 'upcoming' }, 'ADMIN');
    const strip = screen.getByRole('navigation', { name: 'Election workspace steps' });
    const items = within(strip).getAllByRole('listitem');
    expect(items.map((item) => item.textContent.replace(/^\d\.\s*/, '').replace(/:.*$/, ''))).toEqual(['Overview', 'Party lists', 'Candidates', 'Voters', 'Results']);
    expect(within(strip).getByRole('link', { name: /Party lists/ })).toHaveAttribute('href', '/dashboard/elections/manage-partylists?record=7');
    expect(within(strip).getByRole('link', { name: /Voters/ })).toHaveAttribute('href', '/dashboard/elections/manage-elections?record=7&view=voters');
  });

  it('marks the current step and explains an unavailable one in text', () => {
    renderHeader({ ...base, status: 'upcoming' }, 'ADMIN', { path: '/dashboard/elections/manage-partylists?record=7' });
    const strip = screen.getByRole('navigation', { name: 'Election workspace steps' });
    expect(within(strip).getByRole('link', { name: /Party lists/ })).toHaveAttribute('aria-current', 'step');
    expect(within(strip).getByText(/Results appear after voting opens/)).toBeInTheDocument();
  });

  it('gives the Officer Candidates, Voters and Results only', () => {
    renderHeader({ ...base, status: 'upcoming' }, 'SBO_OFFICER', { path: '/dashboard/elections/manage-candidates' });
    const strip = screen.getByRole('navigation', { name: 'Election workspace steps' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3);
    expect(within(strip).getByRole('link', { name: /Voters/ })).toHaveAttribute('href', '/dashboard/elections/manage-voters?record=7');
  });

  it('shows no step strip to a role with a single place to go', () => {
    renderHeader({ ...base, status: 'closed', finalized_at: PAST, results_visible: true }, 'STUDENT', { path: '/dashboard/elections/election-results' });
    expect(screen.queryByRole('navigation', { name: 'Election workspace steps' })).not.toBeInTheDocument();
  });
});

describe('ElectionWorkspaceHeader finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const blocked = {
    ...base,
    status: 'upcoming',
    finalized_at: null,
    positions: [{ id: 1, title: 'President' }, { id: 2, title: 'Treasurer' }],
    candidates: [{ id: 5, position_id: 1, partylist_id: null }],
  };
  const ready = { ...blocked, candidates: [{ id: 5, position_id: 1, partylist_id: 3 }, { id: 6, position_id: 2, partylist_id: null }] };

  it('blocks Finalize ballot with a visible reason and the checklist while the ballot is incomplete', () => {
    renderHeader(blocked, 'ADMIN');
    const button = screen.getByRole('button', { name: 'Finalize ballot' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Add a candidate to the 1 position that has none first.')).toBeInTheDocument();
    expect(screen.getByText('Positions without candidates: 1')).toBeInTheDocument();
    expect(screen.getByText('Party list candidates missing')).toBeInTheDocument();
    expect(finalizeElection).not.toHaveBeenCalled();
  });

  it('enables Finalize ballot once the checklist passes, and refreshes after it runs', async () => {
    finalizeElection.mockResolvedValue({ id: 7 });
    const { onChanged } = renderHeader(ready, 'ADMIN');
    const button = screen.getByRole('button', { name: 'Finalize ballot' });
    expect(button).toBeEnabled();
    expect(screen.getByText('Positions without candidates: 0')).toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(finalizeElection).toHaveBeenCalledWith(7));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows the reason the server gives when it refuses to finalize', async () => {
    finalizeElection.mockRejectedValue({ response: { status: 422, data: { message: 'Assign at least one candidate to a party list before finalizing.' } } });
    renderHeader(ready, 'ADMIN');
    fireEvent.click(screen.getByRole('button', { name: 'Finalize ballot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Assign at least one candidate to a party list before finalizing.');
  });

  it('shows the Officer the checklist but no Finalize button', () => {
    renderHeader(blocked, 'SBO_OFFICER', { path: '/dashboard/elections/manage-candidates' });
    expect(screen.getByText('Positions without candidates: 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize ballot' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open ballot setup' })).toHaveAttribute('href', '/dashboard/elections/manage-candidates?record=7');
  });

  it('opens voting and releases results from the same place', async () => {
    updateElection.mockResolvedValue({ id: 7 });
    renderHeader({ ...base, status: 'upcoming', finalized_at: PAST }, 'ADMIN');
    fireEvent.click(screen.getByRole('button', { name: 'Open voting' }));
    await waitFor(() => expect(updateElection).toHaveBeenCalledWith(7, { status: 'active' }));
  });

  it('releases the results of a closed election', async () => {
    updateElection.mockResolvedValue({ id: 7 });
    renderHeader({ ...base, status: 'closed', finalized_at: PAST, results_visible: false }, 'ADMIN');
    fireEvent.click(screen.getByRole('button', { name: 'Release results' }));
    await waitFor(() => expect(updateElection).toHaveBeenCalledWith(7, { results_visible: true }));
  });
});
