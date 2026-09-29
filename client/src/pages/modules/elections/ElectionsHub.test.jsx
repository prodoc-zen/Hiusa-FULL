import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionsHub from './ElectionsHub';

const getElectionDetails = vi.hoisted(() => vi.fn());
vi.mock('../../../services/electionService', () => ({ getElectionDetails }));
vi.mock('./ElectionPickerPage', () => ({ default: () => <div>Election picker</div> }));

function renderHub(path) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/dashboard/elections" element={<ElectionsHub />}><Route path="cast-vote" element={<div>Selected election content</div>} /></Route></Routes></MemoryRouter>);
}

describe('ElectionsHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', school_id: 101, organization_id: 1 }));
  });

  it('restores a selected election after refresh using the scoped selection', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '5');
    getElectionDetails.mockResolvedValue({ id: 5, title: 'Student election', status: 'active', start_time: new Date(Date.now() - 60_000).toISOString(), end_time: new Date(Date.now() + 60_000).toISOString() });
    renderHub('/dashboard/elections/cast-vote');
    expect(await screen.findByText('Selected election content')).toBeInTheDocument();
    expect(getElectionDetails).toHaveBeenCalledWith('5');
  });

  it('shows an unavailable state for a direct voting route without a selection', async () => {
    renderHub('/dashboard/elections/cast-vote');
    expect(await screen.findByText('No election is currently open.')).toBeInTheDocument();
    expect(screen.getByText('Election picker')).toBeInTheDocument();
  });
});
