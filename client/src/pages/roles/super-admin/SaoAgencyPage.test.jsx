import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoAgencyPage from './SaoAgencyPage';

const mocks = vi.hoisted(() => ({ getSystemAgency: vi.fn() }));
vi.mock('../../../services/systemAdministrationService', () => mocks);

const row = (overrides) => ({
  id: 1, name: 'Computing Society', acronym: 'CS', college_id: 1, lifecycle_status: 'active', is_active: true, submitted_at: null,
  member_counts: { STUDENT: 8, SBO_OFFICER: 3, ADMIN: 1, total: 12 }, administrators_count: 1, accreditation_status: 'accredited',
  pending_approvals_count: 2, pending_documents_count: 4, ...overrides,
});

const agency = (overrides = {}) => ({
  totals: { colleges: 2, organizations: 3, by_lifecycle_status: { pending: 1, returned: 0, active: 1, archived: 1 } },
  colleges: [
    { id: 1, name: 'College of Computing', code: 'CCS', home_organization_id: 9, organizations_count: 2, by_lifecycle_status: { pending: 1, returned: 0, active: 1, archived: 0 }, organizations: [row(), row({ id: 2, name: 'Robotics Club', acronym: 'RC', lifecycle_status: 'pending', is_active: false, accreditation_status: 'not_applicable' })] },
    { id: 2, name: 'College of Arts', code: 'COA', home_organization_id: 10, organizations_count: 0, by_lifecycle_status: { pending: 0, returned: 0, active: 0, archived: 0 }, organizations: [] },
  ],
  unassigned_organizations: [],
  ...overrides,
});

const renderPage = () => render(<MemoryRouter><SaoAgencyPage /></MemoryRouter>);

describe('SaoAgencyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemAgency.mockResolvedValue(agency());
  });

  it('shows the totals strip and one section per college', async () => {
    renderPage();
    const totals = await screen.findByRole('region', { name: 'Agency totals' });
    expect(within(totals).getByText('Colleges').nextSibling).toHaveTextContent('2');
    expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('1');
    expect(within(totals).getByText('Archived').nextSibling).toHaveTextContent('1');
    expect(screen.getByRole('heading', { name: /College of Computing \(CCS\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /College of Arts \(COA\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Organizations without a college' })).not.toBeInTheDocument();
  });

  it('lists organization figures with a text status and an Open link', async () => {
    renderPage();
    const table = (await screen.findAllByRole('table'))[0];
    const first = within(table).getByText('Computing Society').closest('tr');
    expect(within(first).getByText('Active')).toBeInTheDocument();
    expect(within(first).getByText('Accredited')).toBeInTheDocument();
    expect(within(first).getByText('12')).toBeInTheDocument();
    expect(within(first).getByText('4')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Open Computing Society' })).toHaveAttribute('href', '/dashboard/super-admin/organizations/1');
  });

  it('calls out pending organizations and links to the pending filter', async () => {
    renderPage();
    const callout = await screen.findByRole('status');
    expect(callout).toHaveTextContent('1 organization is waiting for your review.');
    expect(within(callout).getByRole('link', { name: 'Review pending organizations' })).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending');
    const reviewLinks = screen.getAllByRole('link', { name: 'Review Robotics Club' });
    expect(reviewLinks[0]).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending');
  });

  it('shows organizations without a college in their own section only when present', async () => {
    mocks.getSystemAgency.mockResolvedValue(agency({ unassigned_organizations: [row({ id: 7, name: 'Loose Club', acronym: 'LC', college_id: null })] }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Organizations without a college' })).toBeInTheDocument();
    expect(screen.getAllByText('Loose Club').length).toBeGreaterThan(0);
  });

  it('shows an empty state for a college without organizations and for an empty agency', async () => {
    renderPage();
    expect(await screen.findByText('No student organizations yet.')).toBeInTheDocument();
  });

  it('shows the empty agency state', async () => {
    mocks.getSystemAgency.mockResolvedValue(agency({ totals: { colleges: 0, organizations: 0, by_lifecycle_status: {} }, colleges: [] }));
    renderPage();
    expect(await screen.findByText('No colleges or organizations yet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    mocks.getSystemAgency.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Not allowed.' } } });
    renderPage();
    expect(await screen.findByText('Not allowed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Agency totals' })).toBeInTheDocument();
    expect(mocks.getSystemAgency).toHaveBeenCalledTimes(2);
  });
});
