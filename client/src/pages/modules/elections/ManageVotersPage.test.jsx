import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageVotersPage from './ManageVotersPage';

const electionMocks = vi.hoisted(() => ({
  getElectionVoters: vi.fn(),
}));

vi.mock('../../../services/electionService', () => electionMocks);

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({
    election: { id: 7, title: 'General Elections 2026', status: 'active' },
  }),
}));

describe('ManageVotersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression guard: GET /elections/{id}/voters is paginated, so it answers with a
  // Laravel paginator envelope rather than a bare array. The page previously did
  // setVoters(Array.isArray(data) ? data : []), which silently produced an empty
  // list for every election.
  it('renders voters out of the paginated envelope', async () => {
    electionMocks.getElectionVoters.mockResolvedValue({
      current_page: 1,
      per_page: 20,
      total: 2,
      data: [
        { school_id: '2021-00142', first_name: 'Juan', last_name: 'Dela Vega', email: 'juan@hiusa.local', has_voted: true },
        { school_id: '2022-00055', first_name: 'Pia', last_name: 'Torres', email: 'pia@hiusa.local', has_voted: false },
      ],
      summary: { eligible_total: 2, voted_count: 1, turnout_percent: 50 },
    });

    render(<ManageVotersPage />);

    await waitFor(() => {
      expect(screen.getByText('Juan Dela Vega')).toBeInTheDocument();
    });
    expect(screen.getByText('Pia Torres')).toBeInTheDocument();
    expect(screen.queryByText('No voters match your search.')).not.toBeInTheDocument();

    // Vote status is per row, and the words also appear as card labels and filter
    // buttons, so scope the assertion to each voter's own table row.
    const votedRow = screen.getByText('Juan Dela Vega').closest('tr');
    const pendingRow = screen.getByText('Pia Torres').closest('tr');
    expect(votedRow).toHaveTextContent('Voted');
    expect(pendingRow).toHaveTextContent('Not Yet');
  });

  // The headline counts must come from the server-wide `summary`, never from the
  // length of the current page, or they under-report as soon as voters paginate.
  it('takes the headline counts from the summary rather than the loaded page', async () => {
    electionMocks.getElectionVoters.mockResolvedValue({
      current_page: 1,
      per_page: 20,
      total: 320,
      data: [
        { school_id: '2021-00142', first_name: 'Juan', last_name: 'Dela Vega', email: 'juan@hiusa.local', has_voted: true },
      ],
      summary: { eligible_total: 320, voted_count: 118, turnout_percent: 36.9 },
    });

    render(<ManageVotersPage />);

    // These numbers and words also appear in the pagination footer, the filter
    // buttons and the row badges, so resolve each stat card by finding the label
    // whose sibling is the numeric value. Only ONE voter row is loaded here, so a
    // regression back to page-length counting would read 1 / 1 / 0 instead.
    const cardValue = (label) =>
      screen
        .getAllByText(label)
        .map((node) => node.parentElement?.querySelector('.tabular-nums')?.textContent)
        .find((value) => value !== undefined);

    await waitFor(() => {
      expect(cardValue('Total Voters')).toBe('320');
    });
    expect(cardValue('Voted')).toBe('118');
    expect(cardValue('Not Yet Voted')).toBe('202');
    expect(screen.getByText('36.9% turnout')).toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    electionMocks.getElectionVoters.mockRejectedValue(new Error('boom'));

    render(<ManageVotersPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load voters.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
