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
vi.mock('../../../services/systemAdministrationService', () => ({
  getAcademicPeriods: vi.fn().mockResolvedValue([
    { id: 1, number: 1, status: 'completed', academic_year: { label: '2026-2027' } },
    { id: 2, number: 2, status: 'active', academic_year: { label: '2026-2027' } },
  ]),
}));

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

  it('shows a completed semester as read only', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const period = await screen.findByLabelText('Academic period');
    fireEvent.change(period, { target: { value: '1' } });
    await screen.findByText('Completed semester elections are available for viewing only.');
    expect(screen.queryByRole('button', { name: 'Create election' })).not.toBeInTheDocument();
    expect(electionMocks.getElections).toHaveBeenCalledWith({ academic_semester_id: '1' });
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

  it('hides Delete for an open election and offers Close instead', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'active', approved_at: '2026-09-01T00:00:00Z', finalized_at: '2026-09-02T00:00:00Z' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const row = await rowFor('HIUSA General Election 2026');

    expect(within(row).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(await findRowAction(/Close/)).toBeInTheDocument();
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
