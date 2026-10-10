import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionDetailPage from './ElectionDetailPage';

const { getElectionVoters, outlet } = vi.hoisted(() => ({
  getElectionVoters: vi.fn(),
  outlet: { election: { id: 5, title: 'Council Election', status: 'active', finalized_at: '2026-09-01T08:00:00Z', positions: [{ id: 1, title: 'President', max_winners: 1 }], candidates: [], votes: [] }, refreshElection: vi.fn() },
}));

vi.mock('../../../services/electionService', () => ({ getElectionVoters, createElectionPosition: vi.fn(), deleteElectionPosition: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useOutletContext: () => outlet }));

describe('ElectionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getElectionVoters.mockResolvedValue({ data: [{ school_id: '2024-1', first_name: 'Ana', last_name: 'Reyes', role: 'STUDENT', email: 'ana@example.com', has_voted: true }], per_page: 10, summary: { eligible_total: 4, voted_count: 1, turnout_percent: 25 } });
  });

  it('shows the ballot setup on the overview', () => {
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5']}><ElectionDetailPage /></MemoryRouter>);
    expect(screen.getByText('President')).toBeInTheDocument();
    expect(getElectionVoters).not.toHaveBeenCalled();
  });

  it('shows read only turnout on the voters view for the Admin', async () => {
    render(<MemoryRouter initialEntries={['/dashboard/elections/manage-elections?record=5&view=voters']}><ElectionDetailPage /></MemoryRouter>);
    expect(await screen.findByText('25% turnout')).toBeInTheDocument();
    expect(getElectionVoters).toHaveBeenCalledWith(5, { page: 1 });
    expect(screen.queryByRole('button', { name: 'Add Position' })).not.toBeInTheDocument();
  });
});
