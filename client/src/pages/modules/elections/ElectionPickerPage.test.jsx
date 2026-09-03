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

    expect(screen.getByRole('heading', { name: 'Choose an election first' })).toBeInTheDocument();
    await screen.findByText('HIUSA General Election 2026');
    fireEvent.click(screen.getByRole('button', { name: /Select election/ }));
    expect(onSelect).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByRole('button', { name: 'Create election' }));
    await waitFor(() => expect(screen.getByText('Election artwork')).toBeInTheDocument());
    expect(screen.getByLabelText('Election title *')).toBeInTheDocument();
    expect(screen.getByText('Choose image')).toBeInTheDocument();
  });
});
