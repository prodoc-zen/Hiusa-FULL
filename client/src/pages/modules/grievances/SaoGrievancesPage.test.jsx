import { render, screen, within } from '@testing-library/react';
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
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
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
});
