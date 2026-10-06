import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('ElectionPickerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    electionMocks.getElections.mockResolvedValue([{
      id: 7,
      title: 'HIUSA General Election 2026',
      status: 'upcoming',
      start_time: '2026-10-01T08:00:00Z',
      end_time: '2026-10-02T08:00:00Z',
      positions_count: 4,
      candidates_count: 10,
      votes_count: 0,
    }]);
  });

  it('requires an explicit election selection and exposes election artwork controls', async () => {
    const onSelect = vi.fn();
    render(<ElectionPickerPage onSelect={onSelect} />);

    expect(screen.queryByRole('heading', { name: 'Election Workspace' })).not.toBeInTheDocument();
    await screen.findByText('HIUSA General Election 2026');
    fireEvent.click(screen.getByRole('button', { name: /Select election/ }));
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
});
