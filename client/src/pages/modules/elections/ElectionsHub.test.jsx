import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionsHub from './ElectionsHub';

const { getElectionDetails, getElections, finalizeElection, updateElection } = vi.hoisted(() => ({
  getElectionDetails: vi.fn(),
  getElections: vi.fn(),
  finalizeElection: vi.fn(),
  updateElection: vi.fn(),
}));
vi.mock('../../../services/electionService', () => ({ getElectionDetails, getElections, finalizeElection, updateElection }));
vi.mock('./ElectionPickerPage', () => ({
  default: ({ onSelect, editElectionId }) => (
    <div>
      Election picker
      {editElectionId && <span>Editing {editElectionId}</span>}
      <button type="button" onClick={() => onSelect(9)}>Pick nine</button>
    </div>
  ),
}));

vi.mock('./CastVoteRedirectPage', () => ({ default: () => <div>Vote list</div> }));

const election = (overrides = {}) => ({
  id: 5,
  title: 'Council Election',
  status: 'upcoming',
  finalized_at: null,
  start_time: new Date(Date.now() + 86_400_000).toISOString(),
  end_time: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  positions: [],
  candidates: [],
  ...overrides,
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

function renderHub(path, { role = 'ADMIN' } = {}) {
  localStorage.setItem('user', JSON.stringify({ role, school_id: 101, organization_id: 1 }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/dashboard/elections" element={<ElectionsHub />}>
          <Route path="manage-candidates" element={<div>Candidates content</div>} />
          <Route path="manage-elections" element={<div>Overview content</div>} />
          <Route path="cast-vote" element={<div>Outlet vote</div>} />
        </Route>
        <Route path="/dashboard/elections/election-results" element={<div>Results destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ElectionsHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    getElections.mockResolvedValue([]);
    getElectionDetails.mockImplementation(async (id) => election({ id: Number(id) }));
  });

  it('opens the election named in the URL and shows its workspace', async () => {
    renderHub('/dashboard/elections/manage-candidates?record=5');
    expect(await screen.findByText('Candidates content')).toBeInTheDocument();
    expect(getElectionDetails).toHaveBeenCalledWith('5');
    expect(screen.getByRole('navigation', { name: 'Election workspace steps' })).toBeInTheDocument();
    expect(screen.getByText('Council Election')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/elections/manage-candidates?record=5');
  });

  it('prefers the election in the URL over an older selection in the tab', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '2');
    renderHub('/dashboard/elections/manage-candidates?record=5');
    await screen.findByText('Candidates content');
    expect(getElectionDetails).toHaveBeenCalledTimes(1);
    expect(getElectionDetails).toHaveBeenCalledWith('5');
  });

  it('uses the selection saved in the tab for an old link without a record, and writes it into the URL', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '5');
    renderHub('/dashboard/elections/manage-candidates');
    expect(await screen.findByText('Candidates content')).toBeInTheDocument();
    expect(getElectionDetails).toHaveBeenCalledWith('5');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/elections/manage-candidates?record=5'));
  });

  it('shows the election picker when no election is named or saved', async () => {
    renderHub('/dashboard/elections/manage-elections');
    expect(await screen.findByText('Election picker')).toBeInTheDocument();
    expect(getElectionDetails).not.toHaveBeenCalled();
  });

  it('puts the chosen election in the URL', async () => {
    renderHub('/dashboard/elections/manage-elections');
    fireEvent.click(await screen.findByRole('button', { name: 'Pick nine' }));
    expect(await screen.findByText('Overview content')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/elections/manage-elections?record=9');
    expect(sessionStorage.getItem('hiusa-election-1-101')).toBe('9');
  });

  it('falls back to the picker and forgets a record that cannot be loaded', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '5');
    getElectionDetails.mockRejectedValue(new Error('not found'));
    renderHub('/dashboard/elections/manage-elections?record=404');
    expect(await screen.findByText('Election picker')).toBeInTheDocument();
    expect(sessionStorage.getItem('hiusa-election-1-101')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('record=404'));
  });

  it('keeps the picker, not the workspace, when the Admin is sent to edit a returned election', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '5');
    renderHub('/dashboard/elections/manage-elections?edit=5');
    expect(await screen.findByText('Editing 5')).toBeInTheDocument();
    expect(getElectionDetails).not.toHaveBeenCalled();
  });

  it('shows the vote list for a student without loading a workspace', async () => {
    sessionStorage.setItem('hiusa-election-1-101', '5');
    getElections.mockResolvedValue([]);
    renderHub('/dashboard/elections/cast-vote', { role: 'STUDENT' });
    expect(await screen.findByText('Vote list')).toBeInTheDocument();
    expect(getElectionDetails).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: 'Election workspace steps' })).not.toBeInTheDocument();
  });

  it('sends a Department Head asking for the voting route to the results page instead of the ballot list', async () => {
    renderHub('/dashboard/elections/cast-vote', { role: 'DEPARTMENT_HEAD' });
    expect(await screen.findByText('Results destination')).toBeInTheDocument();
    expect(getElections).not.toHaveBeenCalled();
  });
});
