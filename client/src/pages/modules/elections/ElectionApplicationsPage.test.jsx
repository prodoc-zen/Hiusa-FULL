import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionApplicationsPage from './ElectionApplicationsPage';

const { getApplications, reviewApplication, openProtectedFile, outlet } = vi.hoisted(() => ({
  getApplications: vi.fn(),
  reviewApplication: vi.fn(),
  openProtectedFile: vi.fn(),
  outlet: {
    role: 'ADMIN',
    election: {
      id: 5,
      title: 'Council Election',
      phase: 'screening',
      filing_starts_at: '2026-11-01T00:00:00Z',
      screening_starts_at: '2026-11-10T00:00:00Z',
      screening_ends_at: '2026-11-12T00:00:00Z',
    },
    refreshElection: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/electionService', () => ({ getApplications, reviewApplication }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useOutletContext: () => outlet }));

const rows = [
  {
    id: 1, status: 'pending_review', user: { name: 'Ana Reyes', school_id: 301, year_level: 3 }, year_level_missing: false,
    position: { id: 1, title: 'President', is_executive: true }, partylist: { id: 2, name: 'Forward', color: '#1D4ED8' },
    platform: 'Open books.', photo_url: '/storage/candidates/ana.jpg', coc_open_url: '/elections/5/applications/1/files/coc',
    credentials_open_url: '/elections/5/applications/1/files/credentials', review_notes: null, submitted_at: '2026-11-05T01:00:00Z', submitted_by_name: 'Ana Reyes',
  },
  {
    id: 2, status: 'for_revision', user: { name: 'Luis Cruz', school_id: 302, year_level: null }, year_level_missing: true,
    position: { id: 2, title: 'Treasurer', is_executive: false }, partylist: null,
    platform: null, photo_url: null, coc_open_url: '/elections/5/applications/2/files/coc', credentials_open_url: null,
    review_notes: 'Upload the COC again.', submitted_at: '2026-11-05T02:00:00Z', submitted_by_name: 'Luis Cruz',
  },
  {
    id: 3, status: 'approved', user: { name: 'Mara Dizon', school_id: 303, year_level: 2 }, year_level_missing: false,
    position: { id: 2, title: 'Treasurer', is_executive: false }, partylist: null,
    platform: null, photo_url: null, coc_open_url: null, credentials_open_url: null,
    review_notes: null, submitted_at: '2026-11-05T03:00:00Z', submitted_by_name: 'Mara Dizon',
  },
];

function renderPage() {
  return render(<MemoryRouter><ElectionApplicationsPage /></MemoryRouter>);
}

// The list renders as a table and as cards for a narrow screen; the table is read here.
const table = () => within(screen.getByRole('table'));
const rowOf = (name) => table().getByText(name).closest('tr');

async function openMenu(name) {
  await screen.findAllByText(name);
  const row = rowOf(name);
  fireEvent.click(within(row).getByRole('button', { name: /Actions/ }));
  return row;
}

describe('ElectionApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outlet.role = 'ADMIN';
    outlet.election.phase = 'screening';
    getApplications.mockResolvedValue({ data: rows, counts: {} });
    reviewApplication.mockResolvedValue({ success: true });
  });

  it('lists each application with candidate, school ID, position, party list or Independent', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(getApplications).toHaveBeenCalledWith(5);
    expect(table().getByText('301')).toBeInTheDocument();
    expect(table().getByText('President')).toBeInTheDocument();
    expect(table().getByText('Forward')).toBeInTheDocument();
    expect(table().getAllByText('Independent')).toHaveLength(2);
    expect(within(rowOf('Ana Reyes')).getByText('Pending review')).toBeInTheDocument();
    expect(within(rowOf('Luis Cruz')).getByText('For revision')).toBeInTheDocument();
  });

  it('says Year level not on record for a student with no year level, and nowhere else', async () => {
    renderPage();
    await screen.findAllByText('Luis Cruz');
    expect(table().getAllByText('Year level not on record')).toHaveLength(1);
    expect(within(rowOf('Luis Cruz')).getByText('Year level not on record')).toBeInTheDocument();
  });

  it('approves a pending application after a confirmation', async () => {
    renderPage();
    await openMenu('Ana Reyes');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(reviewApplication).toHaveBeenCalledWith(5, 1, { decision: 'approve' }));
    await waitFor(() => expect(getApplications).toHaveBeenCalledTimes(2));
    expect(outlet.refreshElection).toHaveBeenCalled();
  });

  it('asks for a correction only with notes written', async () => {
    renderPage();
    await openMenu('Ana Reyes');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask for correction' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Ask for correction' });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Notes for the candidate'), { target: { value: '  Upload the COC again.  ' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(reviewApplication).toHaveBeenCalledWith(5, 1, { decision: 'correction', notes: 'Upload the COC again.' }));
  });

  it('rejects only with a reason written', async () => {
    renderPage();
    await openMenu('Ana Reyes');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Reject' });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Reason for rejecting'), { target: { value: 'Not a member.' } });
    fireEvent.click(send);
    await waitFor(() => expect(reviewApplication).toHaveBeenCalledWith(5, 1, { decision: 'reject', notes: 'Not a member.' }));
  });

  it('shows the server message as returned when a review is refused', async () => {
    reviewApplication.mockRejectedValue({ response: { status: 422, data: { message: 'Screening has ended.' } } });
    renderPage();
    await openMenu('Ana Reyes');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Screening has ended.')).toBeInTheDocument();
  });

  it('offers actions only on applications that wait for review', async () => {
    renderPage();
    await screen.findAllByText('Luis Cruz');
    expect(table().getAllByRole('button', { name: /Actions/ })).toHaveLength(1);
  });

  it('shows the notes the candidate was sent for a correction', async () => {
    renderPage();
    await screen.findAllByText('Upload the COC again.');
    expect(within(rowOf('Luis Cruz')).getByText('Upload the COC again.')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    expect(table().queryByText('Ana Reyes')).not.toBeInTheDocument();
    expect(table().getByText('Mara Dizon')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    expect(table().getByText('Ana Reyes')).toBeInTheDocument();
  });

  it('opens the certificate and credentials through the protected file helper', async () => {
    renderPage();
    await screen.findAllByText('Ana Reyes');
    const row = rowOf('Ana Reyes');
    fireEvent.click(within(row).getByRole('button', { name: 'COC' }));
    expect(openProtectedFile).toHaveBeenCalledWith('/elections/5/applications/1/files/coc');
    fireEvent.click(within(row).getByRole('button', { name: 'Credentials' }));
    expect(openProtectedFile).toHaveBeenCalledWith('/elections/5/applications/1/files/credentials');
    expect(within(row).getByRole('link', { name: 'Photo' })).toBeInTheDocument();
  });

  it('shows when screening runs and no action buttons outside the screening phase', async () => {
    outlet.election.phase = 'filing';
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(screen.getByText(/Screening runs from/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions/ })).not.toBeInTheDocument();
  });

  it('is read only for an officer, with no actions and no document links', async () => {
    outlet.role = 'SBO_OFFICER';
    renderPage();
    await screen.findAllByText('Ana Reyes');
    expect(screen.getByText('The Admin screens the applications.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'COC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Credentials' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Photo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();
  });

  it('says so when the list did not load', async () => {
    getApplications.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText('Applications did not load.')).toBeInTheDocument();
  });
});
