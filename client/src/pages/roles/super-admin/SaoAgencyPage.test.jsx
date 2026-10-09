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
    { id: 1, name: 'College of Computing', code: 'CCS', home_organization_id: 9, organizations_count: 2, by_lifecycle_status: { pending: 1, returned: 0, active: 1, archived: 0 }, organizations: [row(), row({ id: 2, name: 'Robotics Club', acronym: 'RC', lifecycle_status: 'pending', is_active: false, accreditation_status: 'not_applicable', pending_approvals_count: 0, pending_documents_count: 0 })] },
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

  it('leads with pending reviews and has one section per college', async () => {
    renderPage();
    const totals = await screen.findByRole('region', { name: 'Agency totals' });
    const labels = within(totals).getAllByRole('link').map((link) => link.querySelector('p').textContent);
    expect(labels[0]).toBe('Pending reviews');
    expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('1');
    expect(within(totals).getByText('Colleges').nextSibling).toHaveTextContent('2');
    expect(within(totals).getByText('Archived').nextSibling).toHaveTextContent('1');
    expect(screen.getByRole('heading', { name: /College of Computing \(CCS\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /College of Arts \(COA\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Organizations without a college' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the table to four data columns plus actions so nothing is clipped', async () => {
    renderPage();
    const table = (await screen.findAllByRole('table'))[0];
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Organization', 'Status', 'Members', 'Needs attention', 'Actions']);
  });

  it('lists organization figures with a text status, one needs-attention cell and an Open link', async () => {
    renderPage();
    const table = (await screen.findAllByRole('table'))[0];
    const first = within(table).getByText('Computing Society').closest('tr');
    expect(within(first).getByText('Active')).toBeInTheDocument();
    expect(within(first).getByText('12')).toBeInTheDocument();
    expect(within(first).getByText('2 approvals, 4 documents')).toBeInTheDocument();
    expect(within(first).queryByText('Accredited')).not.toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Open Computing Society' })).toHaveAttribute('href', '/dashboard/super-admin/organizations/1');
    const second = within(table).getByText('Robotics Club').closest('tr');
    expect(within(second).getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('shows a singular needs-attention summary', async () => {
    mocks.getSystemAgency.mockResolvedValue(agency({ colleges: [{ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: 1, by_lifecycle_status: { pending: 1, returned: 0, active: 0, archived: 0 }, organizations: [row({ pending_approvals_count: 0, pending_documents_count: 1 })] }] }));
    renderPage();
    expect((await screen.findAllByText('1 document')).length).toBeGreaterThan(0);
  });

  it('links Review to the organization in the review drawer, not the whole list', async () => {
    renderPage();
    const reviewLinks = await screen.findAllByRole('link', { name: 'Review Robotics Club' });
    expect(reviewLinks[0]).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending&review=2');
  });

  it('marks archived organizations as read only for assistive technology', async () => {
    mocks.getSystemAgency.mockResolvedValue(agency({ colleges: [{ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 1, active: 0, archived: 1 }, organizations: [row({ lifecycle_status: 'archived' })] }] }));
    renderPage();
    const badge = await screen.findAllByLabelText('Archived, read only');
    expect(badge[0]).toHaveTextContent('Archived');
  });

  it('orders colleges by pending then returned reviews, then name', async () => {
    const college = (id, name, counts) => ({ id, name, code: String(id), organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 0, active: 1, archived: 0, ...counts }, organizations: [row({ id: id * 10, name: `${name} Club` })] });
    mocks.getSystemAgency.mockResolvedValue(agency({ colleges: [college(1, 'Alpha', {}), college(2, 'Beta', { returned: 2 }), college(3, 'Gamma', { pending: 1 }), college(4, 'Delta', { pending: 1, returned: 1 })] }));
    renderPage();
    await screen.findByRole('heading', { name: /Alpha/ });
    const order = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent.replace(/\s*\(\d+\)$/, ''));
    expect(order).toEqual(['Delta', 'Gamma', 'Beta', 'Alpha']);
  });

  it('expands colleges that need attention, collapses the rest and lets either toggle', async () => {
    const quiet = { id: 5, name: 'College of Law', code: 'LAW', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 0, active: 1, archived: 0 }, organizations: [row({ id: 50, name: 'Moot Court' })] };
    mocks.getSystemAgency.mockResolvedValue(agency({ colleges: [...agency().colleges, quiet] }));
    renderPage();
    const open = await screen.findByRole('button', { name: /College of Computing/ });
    const closed = screen.getByRole('button', { name: /College of Law/ });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Moot Court')).not.toBeInTheDocument();
    fireEvent.click(closed);
    expect(closed).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('Moot Court').length).toBeGreaterThan(0);
    fireEvent.click(open);
    expect(screen.queryByText('Computing Society')).not.toBeInTheDocument();
  });

  it('collapses a college without organizations to one muted line', async () => {
    renderPage();
    const heading = await screen.findByRole('heading', { name: /College of Arts \(COA\)/ });
    expect(heading.closest('section')).toHaveTextContent('No organizations yet');
    expect(within(heading.closest('section')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows organizations without a college in their own section only when present', async () => {
    mocks.getSystemAgency.mockResolvedValue(agency({ unassigned_organizations: [row({ id: 7, name: 'Loose Club', acronym: 'LC', college_id: null })] }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Organizations without a college' })).toBeInTheDocument();
    expect(screen.getAllByText('Loose Club').length).toBeGreaterThan(0);
  });

  it('renders zero counts muted and non-zero counts bold', async () => {
    renderPage();
    const heading = await screen.findByRole('heading', { name: /College of Computing/ });
    const counts = within(heading.closest('header')).getByText(/pending/).closest('p');
    const spans = Array.from(counts.querySelectorAll('span'));
    expect(spans.map((span) => span.textContent)).toEqual(['2', '1', '1', '0', '0']);
    expect(spans[1]).toHaveClass('font-bold');
    expect(spans[3]).toHaveClass('text-ink-muted');
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
