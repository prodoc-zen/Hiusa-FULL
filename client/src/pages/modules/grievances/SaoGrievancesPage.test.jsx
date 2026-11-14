import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoGrievancesPage from './SaoGrievancesPage';

const mocks = vi.hoisted(() => ({
  getGrievances: vi.fn(),
  updateGrievanceStatus: vi.fn(),
  updateGrievanceClassification: vi.fn(),
}));

vi.mock('../../../services/grievanceService', () => ({
  getGrievances: mocks.getGrievances,
  updateGrievanceStatus: mocks.updateGrievanceStatus,
  updateGrievanceClassification: mocks.updateGrievanceClassification,
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
    expect(screen.queryByText(/^0 grievances$/)).not.toBeInTheDocument();
  });

  it('asks the server for most urgent first so the order holds across pages', async () => {
    mocks.getGrievances.mockImplementation((params) => (params?.per_page === 50
      ? Promise.resolve(envelope([CRITICAL, LOW], 2))
      : Promise.resolve(envelope([]))));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('Critical concern')).toBeTruthy();
    expect(mocks.getGrievances).toHaveBeenCalledWith(expect.objectContaining({ sort: 'urgency', direction: 'asc', page: 1, per_page: 50 }));
  });

  it('sends the chosen sort to the server and returns to page one', async () => {
    mocks.getGrievances.mockImplementation((params) => Promise.resolve({ data: { data: params?.per_page === 50 ? [CRITICAL] : [], current_page: params?.page || 1, last_page: 3, per_page: 50, total: 120 } }));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    await screen.findAllByText('Critical concern');
    fireEvent.click(screen.getByRole('button', { name: /next page of grievances/i }));
    await waitFor(() => expect(mocks.getGrievances).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    mocks.getGrievances.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Filed' }));
    await waitFor(() => expect(mocks.getGrievances).toHaveBeenCalledWith(expect.objectContaining({ sort: 'created_at', direction: 'asc', page: 1, per_page: 50 })));
  });

  it('shows no badge on default states and one word for a closed grievance', async () => {
    const closed = { ...LOW, id: 3, title: 'Closed concern', status: 'resolved', urgency: 'Medium' };
    mocks.getGrievances.mockImplementation((params) => (params?.per_page === 50
      ? Promise.resolve(envelope([closed, LOW], 2))
      : Promise.resolve(envelope([]))));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    const closedRow = (await screen.findAllByText('Closed concern')).map((node) => node.closest('tr')).find(Boolean);
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

  it('counts open Critical grievances with a status filter the API accepts', async () => {
    // GrievanceController validates status through FilterValues: one value or a JSON list, a comma list is a 422.
    const apiAccepts = (status) => {
      if (status === undefined || typeof status !== 'string') return true;
      if (!status.startsWith('[')) return !status.includes(',');
      const decoded = JSON.parse(status);
      return Array.isArray(decoded) && decoded.every((value) => ['submitted', 'under_review', 'resolved', 'dismissed'].includes(value));
    };
    mocks.getGrievances.mockImplementation((params) => (apiAccepts(params?.status)
      ? Promise.resolve(envelope([], params?.urgency === 'Critical' ? 4 : 2))
      : Promise.reject(new Error('422'))));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: /Critical.*4/is })).toBeInTheDocument();
    expect(mocks.getGrievances).toHaveBeenCalledWith({ urgency: 'Critical', status: '["submitted","under_review"]', per_page: 1 });
  });

  it('shows a tile as unavailable, not as 0, when its count request fails', async () => {
    mocks.getGrievances.mockImplementation((params) => (params?.urgency === 'Critical' && params?.per_page === 1
      ? Promise.reject(new Error('422'))
      : Promise.resolve(envelope([], 3))));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: /Submitted.*3/is })).toBeInTheDocument();
    const critical = screen.getByRole('button', { name: /^Critical/ });
    expect(within(critical).getByText('–')).toBeInTheDocument();
    expect(within(critical).queryByText('0')).toBeNull();
  });

  it('refreshes the tiles after a status change', async () => {
    let submitted = 1;
    mocks.getGrievances.mockImplementation((params) => {
      if (params?.per_page === 1 && params.status === 'submitted') return Promise.resolve(envelope([], submitted));
      return Promise.resolve(envelope(params?.per_page === 50 ? [CRITICAL] : []));
    });
    mocks.updateGrievanceStatus.mockImplementation(() => { submitted = 0; return Promise.resolve({ data: { ...CRITICAL, status: 'under_review' } }); });

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /submitted.*1/is })).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: /Critical concern/ }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to under review' }));

    expect(await screen.findByRole('button', { name: /submitted.*0/is })).toBeInTheDocument();
  });

  it('shows the machine reasoning and lets the SAO correct the rating', async () => {
    const rated = { ...CRITICAL, classification_engine: 'ai-service', classification_reasoning: 'Marked Critical because the text mentions "emergency"; no category words were found, so it is filed under General.' };
    mocks.getGrievances.mockImplementation((params) => Promise.resolve(envelope(params?.per_page === 50 ? [rated] : [])));
    mocks.updateGrievanceClassification.mockResolvedValue({ data: { ...rated, urgency: 'Low', category: 'General', classification_engine: 'reviewer', machine_urgency: 'Critical', machine_category: 'Safety & Security' } });

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: /Critical concern/ }))[0]);
    expect(await screen.findByText('Suggested urgency: Critical')).toBeInTheDocument();
    expect(screen.getByText('Suggested category: Safety & Security')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Why this classification?' }));
    expect(screen.getByText(/the text mentions "emergency"/)).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Correct classification' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Urgency'), { target: { value: 'Low' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'General' } });
    mocks.getGrievances.mockClear();
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateGrievanceClassification).toHaveBeenCalledWith(1, { urgency: 'Low', category: 'General' }));
    expect(await screen.findByText(/Machine rating: Critical urgency, Safety & Security/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why the machine rated it this way' })).toBeInTheDocument();
    expect(mocks.getGrievances).toHaveBeenCalledWith({ urgency: 'Critical', status: '["submitted","under_review"]', per_page: 1 });
  });
  it('asks for page one once when a filter changes on a later page', async () => {
    mocks.getGrievances.mockImplementation((params) => Promise.resolve({ data: { data: params?.per_page === 50 ? [CRITICAL] : [], current_page: params?.page || 1, last_page: 3, per_page: 50, total: 120 } }));

    render(<MemoryRouter><SaoGrievancesPage /></MemoryRouter>);
    await screen.findAllByText('Critical concern');
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
    expect(screen.queryByText('Critical concern')).not.toBeInTheDocument();
    expect(screen.getByText('No grievances match')).toBeInTheDocument();
  });
});
