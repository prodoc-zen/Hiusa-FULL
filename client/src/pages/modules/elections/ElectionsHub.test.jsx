import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionsHub from './ElectionsHub';

const { getElectionDetails, getElections } = vi.hoisted(() => ({ getElectionDetails: vi.fn(), getElections: vi.fn() }));
vi.mock('../../../services/electionService', () => ({ getElectionDetails, getElections }));
vi.mock('./ElectionPickerPage', () => ({ default: () => <div>Election picker</div> }));

function renderHub(path) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/dashboard/elections" element={<ElectionsHub />}><Route path="cast-vote" element={<div>Selected election content</div>} /></Route></Routes></MemoryRouter>);
}

describe('ElectionsHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', school_id: 101, organization_id: 1 }));
    getElections.mockResolvedValue([]);
  });

  it('restores a selected election after refresh using the scoped selection', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '5');
    getElectionDetails.mockResolvedValue({ id: 5, title: 'Student election', status: 'active', start_time: new Date(Date.now() - 60_000).toISOString(), end_time: new Date(Date.now() + 60_000).toISOString() });
    renderHub('/dashboard/elections/cast-vote');
    expect(await screen.findByText('Selected election content')).toBeInTheDocument();
    expect(getElectionDetails).toHaveBeenCalledWith('5');
  });

  it('shows the no-active-election state for a voting route without a selection', async () => {
    renderHub('/dashboard/elections/cast-vote');
    expect(await screen.findByText('No active election')).toBeInTheDocument();
  });

  it('lists concurrent ballots and displays a receipt for an already submitted one', async () => {
    const active = { status: 'active', finalized_at: '2026-09-01T08:00:00Z', start_time: new Date(Date.now() - 60_000).toISOString(), end_time: new Date(Date.now() + 60_000).toISOString() };
    getElections.mockResolvedValue([{ ...active, id: 1 }, { ...active, id: 2 }]);
    getElectionDetails.mockImplementation(async (id) => ({ ...active, id, title: `Election ${id}`, my_votes: id === 1 ? [{ vote_hash: 'RECEIPT-123' }] : [] }));
    renderHub('/dashboard/elections/cast-vote');
    expect(await screen.findByText('Election 1')).toBeInTheDocument();
    expect(screen.getByText('Election 2')).toBeInTheDocument();
    expect(screen.getByText('RECEIPT-123')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Vote in this election' })).toHaveLength(1);
  });
});
