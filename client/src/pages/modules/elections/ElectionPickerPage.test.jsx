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

describe('ElectionPickerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([upcoming]);
  });

  it('requires an explicit election selection and exposes election artwork controls', async () => {
    const onSelect = vi.fn();
    render(<ElectionPickerPage onSelect={onSelect} />);

    expect(screen.queryByRole('heading', { name: 'Election Workspace' })).not.toBeInTheDocument();
    await screen.findByText('HIUSA General Election 2026');
    fireEvent.click(screen.getByRole('button', { name: /Open election/ }));
    expect(onSelect).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole('button', { name: 'Create election' }));
    await waitFor(() => expect(screen.getByText('Election artwork')).toBeInTheDocument());
    expect(screen.getByLabelText('Election title *')).toBeInTheDocument();
    expect(screen.getByText('Choose image')).toBeInTheDocument();
    expect(screen.getByText('Informative letter (PDF) *')).toBeInTheDocument();
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

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create election' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
  });

  it('shows each election its stage and next action, and keeps Finalize ballot for the workspace', async () => {
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const card = (await screen.findByText('HIUSA General Election 2026')).closest('article');
    expect(within(card).getByText('Next: Build the ballot')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar', { name: /Progress for HIUSA General Election 2026/ })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Finalize ballot/ })).not.toBeInTheDocument();
  });

  it('marks a returned election with the reason and an edit and resubmit action', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval', approval_status: 'rejected', approval_remarks: 'Add the voting room.' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const card = (await screen.findByText('HIUSA General Election 2026')).closest('article');
    expect(within(card).getByText('Returned')).toBeInTheDocument();
    expect(within(card).getByText('Reason: Add the voting room.')).toBeInTheDocument();
    expect(within(card).getByText('Next: Returned: edit and resubmit')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Edit and resubmit/ })).toBeInTheDocument();
    expect(within(card).queryByText('In review')).not.toBeInTheDocument();
  });

  it('keeps a pending election that has no approval fields as in review', async () => {
    electionMocks.getElections.mockResolvedValue([{ ...upcoming, status: 'pending_approval' }]);
    render(<ElectionPickerPage onSelect={vi.fn()} />);
    const card = (await screen.findByText('HIUSA General Election 2026')).closest('article');
    expect(within(card).getByText('In review')).toBeInTheDocument();
    expect(within(card).getByText('Next: Awaiting Department Head review')).toBeInTheDocument();
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
    await screen.findByText('HIUSA General Election 2026');
    fireEvent.change(screen.getByLabelText('Search elections'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No elections match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('HIUSA General Election 2026')).toBeInTheDocument();
  });
});
