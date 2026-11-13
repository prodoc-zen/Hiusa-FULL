import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManageVotersPage from './ManageVotersPage';

const electionMocks = vi.hoisted(() => ({
  getElectionVoters: vi.fn(),
}));

vi.mock('../../../services/electionService', () => electionMocks);

const outletContext = vi.hoisted(() => ({
  election: { id: 7, title: 'General Elections 2026', status: 'active' },
}));

vi.mock('react-router-dom', () => ({
  useOutletContext: () => outletContext,
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
      per_page: 10,
      total: 2,
      data: [
        { school_id: '2021-00142', first_name: 'Juan', last_name: 'Dela Vega', email: 'juan@hiusa.local', has_voted: true },
        { school_id: '2022-00055', first_name: 'Pia', last_name: 'Torres', email: 'pia@hiusa.local', has_voted: false },
      ],
      summary: { eligible_total: 2, voted_count: 1, turnout_percent: 50 },
    });

    render(<ManageVotersPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Juan Dela Vega').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Pia Torres').length).toBeGreaterThan(0);
    expect(screen.queryByText('No voters match')).not.toBeInTheDocument();

    // The table and the phone list both render, so scope the assertion to each voter's
    // own table row (the table comes first in the DOM).
    const votedRow = screen.getAllByText('Juan Dela Vega')[0].closest('tr');
    const pendingRow = screen.getAllByText('Pia Torres')[0].closest('tr');
    expect(votedRow).toHaveTextContent('Voted');
    expect(pendingRow).toHaveTextContent('Not yet');
  });

  // The headline counts must come from the server-wide `summary`, never from the
  // length of the current page, or they under-report as soon as voters paginate.
  it('takes the headline counts from the summary rather than the loaded page', async () => {
    electionMocks.getElectionVoters.mockResolvedValue({
      current_page: 1,
      per_page: 10,
      total: 320,
      data: [
        { school_id: '2021-00142', first_name: 'Juan', last_name: 'Dela Vega', email: 'juan@hiusa.local', has_voted: true },
      ],
      summary: { eligible_total: 320, voted_count: 118, turnout_percent: 36.9 },
    });

    render(<ManageVotersPage />);

    // Only ONE voter row is loaded here, so a regression back to page-length counting
    // would read 1 of 1 and 0 still to vote instead.
    const summary = await screen.findByText(/eligible voters have voted/);
    expect(summary).toHaveTextContent('118 of 320 eligible voters have voted (36.9% turnout). 202 still to vote.');
  });

  it('names each role the way the rest of the app does', async () => {
    electionMocks.getElectionVoters.mockResolvedValue({
      current_page: 1,
      per_page: 10,
      total: 3,
      data: [
        { school_id: '2021-00142', first_name: 'Juan', last_name: 'Dela Vega', role: 'SBO_OFFICER', has_voted: true },
        { school_id: '2022-00055', first_name: 'Pia', last_name: 'Torres', role: 'STUDENT', has_voted: false },
        { school_id: '2020-00001', first_name: 'Ana', last_name: 'Reyes', role: 'ADMIN', has_voted: false },
      ],
      summary: { eligible_total: 3, voted_count: 1, turnout_percent: 33.3 },
    });

    render(<ManageVotersPage />);

    const officerRow = (await screen.findAllByText('Juan Dela Vega'))[0].closest('tr');
    expect(officerRow).toHaveTextContent('SBO Officer');
    expect(officerRow).not.toHaveTextContent('Sbo officer');
    expect(screen.getAllByText('Pia Torres')[0].closest('tr')).toHaveTextContent('Student');
    expect(screen.getAllByText('Ana Reyes')[0].closest('tr')).toHaveTextContent('Admin');
  });

  it('shows an error with a retry when the request fails', async () => {
    electionMocks.getElectionVoters.mockRejectedValue(new Error('boom'));

    render(<ManageVotersPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load voters.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  // Search and the Vote filter run on the server across every voter, so a voter who is not on the loaded page
  // is found, and the footer follows the filtered set while the headline turnout stays the whole election's.
  it('asks the server for the search and the vote filter and shows the filtered total in the footer', async () => {
    const everyone = Array.from({ length: 10 }, (_, index) => ({ school_id: `2021-0010${index}`, first_name: 'Pat', last_name: `Voter${index}`, email: 'p@hiusa.local', has_voted: false }));
    electionMocks.getElectionVoters.mockImplementation(async (id, params = {}) => {
      if (params.search === 'Torres') {
        const matches = Array.from({ length: 10 }, (_, index) => ({ school_id: `2022-0005${index}`, first_name: 'Pia', last_name: `Torres${index}`, email: 'pia@hiusa.local', has_voted: true }));
        return { current_page: 1, per_page: 10, total: 12, data: matches, summary: { eligible_total: 320, voted_count: 118, turnout_percent: 36.9 } };
      }
      return { current_page: 1, per_page: 10, total: 320, data: everyone, summary: { eligible_total: 320, voted_count: 118, turnout_percent: 36.9 } };
    });

    render(<ManageVotersPage />);
    await screen.findAllByText('Pat Voter0');

    fireEvent.change(screen.getByLabelText('Search voters'), { target: { value: 'Torres' } });

    await waitFor(() => expect(electionMocks.getElectionVoters).toHaveBeenLastCalledWith(7, { page: 1, search: 'Torres' }));
    expect((await screen.findAllByText('Pia Torres0')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Pat Voter0')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1-10 of 12 voters');
    expect(screen.getByText(/eligible voters have voted/)).toHaveTextContent('118 of 320 eligible voters have voted');
  });

  it('sends the Vote filter to the server and returns to the first page', async () => {
    electionMocks.getElectionVoters.mockResolvedValue({
      current_page: 1, per_page: 10, total: 6, data: [{ school_id: '2022-00055', first_name: 'Pia', last_name: 'Torres', email: 'pia@hiusa.local', has_voted: true }], summary: { eligible_total: 26, voted_count: 6, turnout_percent: 23.1 },
    });

    render(<ManageVotersPage />);
    await screen.findAllByText('Pia Torres');

    fireEvent.change(screen.getByLabelText('Vote'), { target: { value: 'Voted' } });

    await waitFor(() => expect(electionMocks.getElectionVoters).toHaveBeenLastCalledWith(7, { page: 1, vote: 'voted' }));
  });

  describe('round switch', () => {
    const original = outletContext.election;
    const page = { current_page: 1, per_page: 10, total: 1, data: [{ school_id: '2022-00055', first_name: 'Pia', last_name: 'Torres', email: 'pia@hiusa.local', has_voted: true }], summary: { eligible_total: 26, voted_count: 6, turnout_percent: 23.1 } };

    afterEach(() => { outletContext.election = original; });

    it('is absent when the election has no runoff', async () => {
      electionMocks.getElectionVoters.mockResolvedValue(page);
      render(<ManageVotersPage />);
      await screen.findAllByText('Pia Torres');
      expect(screen.queryByRole('radio', { name: 'Runoff' })).not.toBeInTheDocument();
    });

    it('asks for the first round by default and for round 2 when Runoff is chosen', async () => {
      outletContext.election = { ...original, runoff_starts_at: '2026-11-20T00:00:00Z' };
      electionMocks.getElectionVoters.mockResolvedValue(page);
      render(<ManageVotersPage />);
      await screen.findAllByText('Pia Torres');
      expect(electionMocks.getElectionVoters).toHaveBeenLastCalledWith(7, { page: 1 });
      expect(screen.getByRole('radio', { name: 'First round' })).toBeChecked();

      fireEvent.click(screen.getByRole('radio', { name: 'Runoff' }));
      await waitFor(() => expect(electionMocks.getElectionVoters).toHaveBeenLastCalledWith(7, { page: 1, round: 2 }));
      expect(screen.getByRole('radio', { name: 'Runoff' })).toBeChecked();

      fireEvent.click(screen.getByRole('radio', { name: 'First round' }));
      await waitFor(() => expect(electionMocks.getElectionVoters).toHaveBeenLastCalledWith(7, { page: 1 }));
    });
  });
});
