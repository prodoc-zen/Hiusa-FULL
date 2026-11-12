import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionPickerPage from './ElectionPickerPage';

const electionMocks = vi.hoisted(() => ({
  getElections: vi.fn(),
  createElection: vi.fn(),
  updateElection: vi.fn(),
  deleteElection: vi.fn(),
}));

vi.mock('../../../services/electionService', () => electionMocks);
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => openMocks);
const periodMocks = vi.hoisted(() => ({
  getAcademicPeriods: vi.fn().mockResolvedValue([
    { id: 1, number: 1, status: 'completed', academic_year: { label: '2026-2027' } },
    { id: 2, number: 2, status: 'active', academic_year: { label: '2026-2027' } },
  ]),
}));
vi.mock('../../../services/systemAdministrationService', () => periodMocks);

const upcoming = {
  id: 7,
  title: 'HIUSA General Election 2026',
  status: 'upcoming',
  start_time: '2026-10-01T08:00:00Z',
  end_time: '2026-10-02T08:00:00Z',
  positions_count: 4,
  candidates_count: 10,
  votes_count: 0,
};

// The table and the phone list both render, so the table row (first in the DOM) stands in for the card.
async function rowFor(title) {
  return (await screen.findAllByText(title))[0].closest('tr');
}

describe('ElectionPickerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openMocks.openProtectedFile.mockResolvedValue();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([upcoming]);
  });

  it('requires an explicit election selection and exposes election artwork controls', async () => {
    const onSelect = vi.fn();
    render(<ElectionPickerPage onSelect={onSelect} />);

    expect(screen.queryByRole('heading', { name: 'Election Workspace' })).not.toBeInTheDocument();
    await screen.findAllByText('HIUSA General Election 2026');
    fireEvent.click(screen.getAllByRole('button', { name: 'HIUSA General Election 2026' })[0]);
    expect(onSelect).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole('button', { name: 'Create election' }));
    await waitFor(() => expect(screen.getByText('Election artwork')).toBeInTheDocument());
    expect(screen.getByLabelText('Election title')).toBeRequired();
    expect(screen.getByLabelText(/Election artwork/)).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText(/Informative letter/)).toBeRequired();
    expect(screen.getAllByText('(optional)').length).toBeGreaterThan(0);
  });

  it('has no academic period picker of its own and lists the semester the top bar is on', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await screen.findAllByText('HIUSA General Election 2026');
    expect(screen.queryByLabelText('Academic period')).not.toBeInTheDocument();
    expect(screen.queryByText('Active period')).not.toBeInTheDocument();
    expect(periodMocks.getAcademicPeriods).not.toHaveBeenCalled();
    expect(electionMocks.getElections).toHaveBeenCalledWith();
  });

  it('opens the creation form when launched from the approval-request selector', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);

    expect(await screen.findByRole('heading', { name: 'Create election' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    // The list's Create election button is gone, so the form has the only filled button.
    expect(screen.queryByRole('button', { name: 'Create election' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows each election its stage and next action, and keeps Finalize ballot for the workspace', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Next: Build the ballot')).toBeInTheDocument();
    expect(within(row).getByText('Upcoming')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Finalize ballot/ })).not.toBeInTheDocument();
  });

  it('marks a returned election with the reason and an edit and resubmit action', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Add the voting room.' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Returned')).toBeInTheDocument();
    expect(within(row).getByText('Reason: Add the voting room.')).toBeInTheDocument();
    expect(within(row).getByText('Next: Returned: edit and resubmit')).toBeInTheDocument();
    expect(await findRowAction(/Edit and resubmit/)).toBeInTheDocument();
    expect(within(row).queryByText('Pending approval')).not.toBeInTheDocument();
  });

  it('opens the submitted informative letter after a rejection', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Revise the letter.', has_informative_letter: true }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    fireEvent.click(await findRowAction('View informative letter'));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/elections/7/informative-letter'));
  });

  it('keeps a pending election that has no approval fields as pending approval', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Pending approval')).toBeInTheDocument();
    expect(within(row).getByText('Next: Awaiting Department Head review')).toBeInTheDocument();
  });

  it('opens the edit form for the election named in an edit link and reports when it closes', async () => {
    const onEditClosed = vi.fn();
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={onEditClosed} />);
    expect(await screen.findByRole('heading', { name: 'Edit election' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEditClosed).toHaveBeenCalledWith(null);
  });

  it('resubmits through the edit form and hands the updated election back', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected' }]);
    electionMocks.updateElection.mockResolvedValue({ id: 7, title: upcoming.title, status: 'pending_approval' });
    const onEditClosed = vi.fn();
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={onEditClosed} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalled());
    await waitFor(() => expect(onEditClosed).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
  });
});

describe('ElectionPickerPage editing an approved election', () => {
  const approved = { ...upcoming, approved_at: '2026-09-20T08:00:00Z', finalized_at: '2026-09-21T08:00:00Z', approval_status: 'approved' };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('says before saving that a new schedule needs approval and a new finalize', async () => {
    electionMocks.getElections.mockResolvedValue([approved]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(screen.getByText(/Changing the schedule sends this election back for approval and un-finalizes the ballot/)).toBeInTheDocument();
  });

  it('says it again after saving when the election went back to approval', async () => {
    electionMocks.getElections.mockResolvedValue([approved]);
    electionMocks.updateElection.mockResolvedValue({ id: 7, title: upcoming.title, status: 'pending_approval', approved_at: null, finalized_at: null });
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Election updated and sent back for approval. Finalize the ballot again once it is approved.')).toBeInTheDocument();
  });

  it('adds no warning for an election that is not approved yet', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} editElectionId="7" onEditClosed={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Edit election' });
    expect(screen.queryByText(/Changing the schedule/)).not.toBeInTheDocument();
  });
});

describe('ElectionPickerPage empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electionMocks.getElections.mockResolvedValue([]);
  });

  it('gives the Admin a first action to create the first election, and only one create button', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    expect(await screen.findByText(/Submit an election for Department Head approval/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Create (your first )?election/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create your first election' }));
    expect(await screen.findByRole('heading', { name: 'Create election' })).toBeInTheDocument();
  });

  it('tells an Officer who can create elections', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    expect(await screen.findByText('No elections yet')).toBeInTheDocument();
    expect(screen.getByText(/Only the Admin creates elections/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('tells a student that voting appears when the Admin opens an election', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    expect(await screen.findByText('No election is currently open')).toBeInTheDocument();
  });

  it('offers to clear the filters when a search matches nothing', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await screen.findAllByText('HIUSA General Election 2026');
    fireEvent.change(screen.getByLabelText('Search elections'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No elections match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect((await screen.findAllByText('HIUSA General Election 2026')).length).toBeGreaterThan(0);
  });
});

describe('ElectionPickerPage by screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('is a plain chooser on the candidates screen, with no create button', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} mode="candidates" />);
    expect(await screen.findByRole('heading', { name: 'Choose an election' })).toBeInTheDocument();
    expect(screen.getByText('Pick the election whose candidates you want to manage.')).toBeInTheDocument();
    await screen.findAllByText('HIUSA General Election 2026');
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Next:/)).not.toBeInTheDocument();
  });

  it('lists only elections with results on the results screen', async () => {
    const closed = { ...upcoming, id: 8, title: 'Closed Election', status: 'closed', votes_count: 12 };
    electionMocks.getElections.mockResolvedValue([upcoming, closed]);
    render(<ElectionPickerPage onSelect={vi.fn()} mode="results" />);
    expect(await screen.findByRole('heading', { name: 'Election results' })).toBeInTheDocument();
    expect((await screen.findAllByText('Closed Election')).length).toBeGreaterThan(0);
    expect(screen.queryByText('HIUSA General Election 2026')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('says there are no results yet instead of offering to create an election', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    render(<ElectionPickerPage onSelect={vi.fn()} mode="results" />);
    expect(await screen.findByText('No results yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('shows no hours countdown and calls an open election Open', async () => {
    const soon = new Date(Date.now() + 168 * 3_600_000).toISOString();
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', finalized_at: '2026-10-01T00:00:00Z', end_time: soon }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(within(row).queryByText(/hours? remaining/)).not.toBeInTheDocument();
  });

  it('uses a styled file chooser that names the chosen file', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} startCreate />);
    const letter = await screen.findByLabelText(/Informative letter/);
    expect(screen.getAllByText('No file selected').length).toBe(2);
    fireEvent.change(letter, { target: { files: [new File(['x'], 'letter.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText('letter.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/PIO/)).not.toBeInTheDocument();
  });
});

describe('ElectionPickerPage delete rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('offers Delete for an upcoming election without votes and deletes it without a confirmation flag', async () => {
    electionMocks.getElections.mockResolvedValue([upcoming]);
    electionMocks.deleteElection.mockResolvedValue({});
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');

    expect(within(row).getByRole('button', { name: /^Actions for/ })).toBeInTheDocument();
    fireEvent.click(await findRowAction(/Delete/));
    const dialog = await screen.findByRole('dialog', { name: 'Delete election' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(electionMocks.deleteElection).toHaveBeenCalledWith(7));
  });

  it('offers Open voting on a finalized election only once its start time has passed', async () => {
    const finalized = { ...upcoming, approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' };
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    electionMocks.getElections.mockResolvedValue([{ ...finalized, start_time: future, end_time: new Date(Date.now() + 6 * 86_400_000).toISOString() }]);
    const waiting = render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    expect(within(row).getByText(/^Next: Ballot locked: voting opens on /)).toBeInTheDocument();
    expect(await findRowAction(/Edit/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Open voting/ })).not.toBeInTheDocument();
    waiting.unmount();

    electionMocks.getElections.mockResolvedValue([finalized]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await rowFor('HIUSA General Election 2026');
    expect(await findRowAction(/Open voting/)).toBeInTheDocument();
  });

  it('hides Delete for an open election and offers Close instead', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');

    expect(within(row).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(await findRowAction(/Close/)).toBeInTheDocument();
  });

  it('asks before closing an open election and only closes it on confirm', async () => {
    const open = { ...upcoming, status: 'active', approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' };
    electionMocks.getElections.mockResolvedValue([open]);
    electionMocks.updateElection.mockResolvedValue({ ...open, status: 'closed' });
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    await rowFor('HIUSA General Election 2026');

    fireEvent.click(await findRowAction(/Close/));
    const dialog = await screen.findByRole('dialog', { name: 'Close election' });
    expect(within(dialog).getByText(/Closing ends voting and cannot be undone/)).toBeInTheDocument();
    expect(within(dialog).getByText(/The winners become the new officers and the outgoing officers lose their officer access/)).toBeInTheDocument();
    expect(electionMocks.updateElection).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Close election' })).not.toBeInTheDocument());
    expect(electionMocks.updateElection).not.toHaveBeenCalled();

    fireEvent.click(await findRowAction(/Close/));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Close election' })).getByRole('button', { name: 'Close election' }));
    await waitFor(() => expect(electionMocks.updateElection).toHaveBeenCalledWith(7, { status: 'closed' }));
  });

  it('counts ballots cast, not individual selections, under the name Ballots', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', votes_count: 18, voters_count: 9 }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');
    const table = row.closest('table');

    expect(within(table).getByRole('columnheader', { name: 'Ballots' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Votes' })).not.toBeInTheDocument();
    expect(within(row).getByText('9')).toBeInTheDocument();
    expect(within(row).queryByText('18')).not.toBeInTheDocument();
  });

  it('hides Delete for a closed election and for any election that has votes', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'closed' }]);
    const closed = render(<ElectionPickerPage onSelect={vi.fn()} />);
    const closedRow = await rowFor('HIUSA General Election 2026');
    expect(within(closedRow).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    closed.unmount();

    electionMocks.getElections.mockResolvedValue([{ ...upcoming, votes_count: 3 }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const votedRow = await rowFor('HIUSA General Election 2026');
    expect(within(votedRow).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});
