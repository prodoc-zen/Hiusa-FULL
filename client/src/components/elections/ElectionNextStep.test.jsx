import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionNextStep from './ElectionNextStep';

const mocks = vi.hoisted(() => ({
  finalizeElection: vi.fn(),
  updateElection: vi.fn(),
  suspendElection: vi.fn(),
  resumeElection: vi.fn(),
  cancelElection: vi.fn(),
}));
vi.mock('../../services/electionService', () => mocks);

const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();
const filing = (overrides = {}) => ({
  id: 7,
  title: 'SBO Election',
  status: 'upcoming',
  phase: 'filing',
  submitted_at: '2026-10-01T08:00:00+08:00',
  filing_starts_at: '2026-12-01T08:00:00+08:00',
  filing_ends_at: '2026-12-05T17:00:00+08:00',
  start_time: FUTURE,
  end_time: FUTURE,
  finalized_at: null,
  positions: [],
  candidates: [],
  ...overrides,
});
const legacy = (overrides = {}) => ({ id: 2, title: 'Demo', status: 'upcoming', phase: null, finalized_at: null, positions: [], candidates: [], ...overrides });

function renderStep(election, role = 'ADMIN', onChanged = vi.fn()) {
  render(<MemoryRouter><ElectionNextStep election={election} role={role} onChanged={onChanged} /></MemoryRouter>);
  return onChanged;
}

describe('ElectionNextStep for an election where students file their own candidacy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no Finalize or Open voting button, in any phase before voting', () => {
    for (const phase of ['scheduled', 'filing', 'screening', 'campaign']) {
      const { unmount } = render(<MemoryRouter><ElectionNextStep election={filing({ phase })} role="ADMIN" /></MemoryRouter>);
      expect(screen.queryByRole('button', { name: 'Finalize ballot' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open voting' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Before the ballot can be finalized/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('keeps Finalize for an election where the Admin adds the candidates', () => {
    renderStep(legacy());
    expect(screen.getByRole('button', { name: 'Finalize ballot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel election' })).not.toBeInTheDocument();
  });

  it('gives the Admin Suspend and Cancel election, and nobody else', () => {
    renderStep(filing());
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel election' })).toBeInTheDocument();
  });

  it.each(['STUDENT', 'SBO_OFFICER', 'DEPARTMENT_HEAD'])('shows %s no Suspend, Resume or Cancel', (role) => {
    renderStep(filing({ suspended_at: '2026-12-02T08:00:00+08:00', halt_reason: 'x' }), role);
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume election' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel election' })).not.toBeInTheDocument();
  });

  it('asks for the reason before suspending, and sends it', async () => {
    mocks.suspendElection.mockResolvedValue({ id: 7 });
    const onChanged = renderStep(filing());
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));

    const dialog = await screen.findByRole('dialog', { name: 'Suspend election' });
    const confirm = within(dialog).getByRole('button', { name: 'Suspend election' });
    expect(confirm).toBeDisabled();
    expect(mocks.suspendElection).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: '  Venue fire drill ' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.suspendElection).toHaveBeenCalledWith(7, 'Venue fire drill'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for the reason before cancelling, and sends it', async () => {
    mocks.cancelElection.mockResolvedValue({ id: 7 });
    const onChanged = renderStep(filing({ phase: 'screening' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel election' }));

    const dialog = await screen.findByRole('dialog', { name: 'Cancel election' });
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    const confirm = within(dialog).getByRole('button', { name: 'Cancel election' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Not enough candidates' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.cancelElection).toHaveBeenCalledWith(7, 'Not enough candidates'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('keeps the dialog open and shows the server message when the request fails', async () => {
    mocks.suspendElection.mockRejectedValue({ response: { data: { message: 'The election is already suspended.' } } });
    renderStep(filing());
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Suspend election' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Pause' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend election' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The election is already suspended.');
  });

  it('shows Resume instead of Suspend on a suspended election and resumes it without a reason', async () => {
    mocks.resumeElection.mockResolvedValue({ id: 7 });
    const onChanged = renderStep(filing({ suspended_at: '2026-12-02T08:00:00+08:00', halt_reason: 'Venue fire drill' }));
    expect(screen.getByText('Suspended: Venue fire drill')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume election' }));

    await waitFor(() => expect(mocks.resumeElection).toHaveBeenCalledWith(7));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows no Suspend, Cancel or Release results on a cancelled election', () => {
    renderStep(filing({ phase: 'cancelled', status: 'closed', cancelled_at: '2026-12-02T08:00:00+08:00', halt_reason: 'Stopped', results_visible: false }));
    expect(screen.getByText('Cancelled: Stopped')).toBeInTheDocument();
    for (const name of ['Suspend', 'Cancel election', 'Release results', 'Resume election']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('keeps Release results on a closed election where the Admin added the candidates', () => {
    renderStep(legacy({ status: 'closed', finalized_at: 'x', results_visible: false }));
    expect(screen.getByRole('button', { name: 'Release results' })).toBeInTheDocument();
  });

  it('offers no Suspend or Cancel once the election is completed', () => {
    renderStep(filing({ phase: 'completed', status: 'closed', results_visible: true }));
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel election' })).not.toBeInTheDocument();
  });

  it('does not offer to edit and resubmit an election rejected for good', () => {
    renderStep(filing({ status: 'pending_approval', phase: null, approval_status: 'rejected', declined_at: '2026-10-02T08:00:00+08:00', approval_remarks: 'Not within the semester' }));
    expect(screen.getByText('Rejected by the Department Head')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit and resubmit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
  });
});
