import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoGrievancesPage from './SaoGrievancesPage';

const mocks = vi.hoisted(() => ({
  getGrievances: vi.fn(),
  updateGrievanceStatus: vi.fn(),
}));

vi.mock('../../../services/grievanceService', () => ({
  getGrievances: mocks.getGrievances,
  updateGrievanceStatus: mocks.updateGrievanceStatus,
}));

function envelope(data, total = data.length) {
  return { data: { data, current_page: 1, last_page: 1, per_page: 50, total } };
}

const CRITICAL = { id: 1, title: 'Critical concern', organization_id: null, status: 'submitted', urgency: 'Critical', category: 'Safety & Security', submitted_by: 9, submitter: { first_name: 'Ana', last_name: 'Cruz' }, is_anonymous: false, created_at: new Date().toISOString() };
const LOW = { id: 2, title: 'Low concern', organization_id: 3, status: 'submitted', urgency: 'Low', category: 'General', submitted_by: 10, submitter: { first_name: 'Ben', last_name: 'Reyes' }, is_anonymous: false, created_at: new Date(Date.now() - 1000).toISOString() };

describe('SaoGrievancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The summary strip issues eight independent per_page=1 count queries;
    // default them all to zero so tests can override only what they check.
    mocks.getGrievances.mockResolvedValue(envelope([]));
  });

  it('shows an empty state with no filters applied', async () => {
    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    expect(await screen.findByText('No grievances to review')).toBeInTheDocument();
  });

  it('shows a retryable error state for the main table', async () => {
    mocks.getGrievances.mockImplementation((params) => (params?.per_page === 50
      ? Promise.reject(new Error('down'))
      : Promise.resolve(envelope([]))));
    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    expect(await screen.findByText('Failed to load grievances.')).toBeInTheDocument();
  });

  it('sorts by urgency first by default, most urgent on top', async () => {
    mocks.getGrievances.mockImplementation((params) => (params?.per_page === 50
      ? Promise.resolve(envelope([LOW, CRITICAL], 2))
      : Promise.resolve(envelope([]))));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    const rows = await screen.findAllByRole('row');
    // rows[0] is the header row; the table body should lead with Critical.
    expect(within(rows[1]).getByText('Critical Concern')).toBeTruthy();
  });

  it('shows no badge on default states and one word for a closed grievance', async () => {
    const closed = { ...LOW, id: 3, title: 'Closed concern', status: 'resolved', urgency: 'Medium' };
    mocks.getGrievances.mockImplementation((params) => (params?.per_page === 50
      ? Promise.resolve(envelope([closed, LOW], 2))
      : Promise.resolve(envelope([]))));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    const closedRow = (await screen.findAllByText('Closed Concern')).map((node) => node.closest('tr')).find(Boolean);
    expect(within(closedRow).getAllByText('Resolved')).toHaveLength(1);
    expect(within(closedRow).getByText('Medium').className).not.toMatch(/rounded/);
    expect(within(closedRow).queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();
  });

  it('renders the status and urgency summary strip from the count queries', async () => {
    mocks.getGrievances.mockImplementation((params) => {
      if (params?.status === 'submitted') return Promise.resolve(envelope([], 5));
      if (params?.urgency === 'Critical') return Promise.resolve(envelope([], 2));
      return Promise.resolve(envelope([]));
    });

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /submitted.*5/is })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /critical.*2/is })).toBeInTheDocument();
  });
  it('asks for page one once when a filter changes on a later page', async () => {
    mocks.getGrievances.mockImplementation((params) => Promise.resolve({ data: { data: params?.per_page === 50 ? [CRITICAL] : [], current_page: params?.page || 1, last_page: 3, per_page: 50, total: 120 } }));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    await screen.findAllByText('Critical Concern');
    fireEvent.click(screen.getByRole('button', { name: /next page of grievances/i }));
    await waitFor(() => expect(mocks.getGrievances).toHaveBeenCalledWith(expect.objectContaining({ page: 2, per_page: 50 })));

    mocks.getGrievances.mockClear();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'resolved' } });
    await waitFor(() => expect(mocks.getGrievances).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.getGrievances.mock.calls.map(([params]) => params)).toEqual([expect.objectContaining({ status: 'resolved', page: 1, per_page: 50 })]);
  });

  it('shows the answer to the latest filter even when an earlier request lands last', async () => {
    let releaseFirst;
    mocks.getGrievances.mockImplementation((params) => {
      if (params?.per_page !== 50) return Promise.resolve(envelope([]));
      if (!params.status && !releaseFirst) return new Promise((resolve) => { releaseFirst = () => resolve(envelope([CRITICAL])); });
      return Promise.resolve(envelope([]));
    });

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'resolved' } });
    await screen.findByText('No grievances match');

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Critical Concern')).not.toBeInTheDocument();
    expect(screen.getByText('No grievances match')).toBeInTheDocument();
  });
});
