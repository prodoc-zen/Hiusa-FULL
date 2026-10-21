import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemCollegesPage from './SystemCollegesPage';
import { findRowAction } from '../../../test/rowActions';

const mocks = vi.hoisted(() => ({
  getSystemColleges: vi.fn(), getSystemAgency: vi.fn(), createSystemCollege: vi.fn(), uploadSystemCollegeLogo: vi.fn(), deleteSystemCollege: vi.fn(),
  createDepartmentHead: vi.fn(), updateDepartmentHead: vi.fn(), resetDepartmentHeadPassword: vi.fn(),
  archiveSystemCollege: vi.fn(), restoreSystemCollege: vi.fn(), permanentlyDeleteCollege: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);
const refetchHook = vi.hoisted(() => ({ current: null }));
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: (refetch) => { refetchHook.current = refetch; } }));

const renderPage = () => render(<MemoryRouter initialEntries={['/dashboard/super-admin/colleges']}><SystemCollegesPage /></MemoryRouter>);

const row = (overrides) => ({
  id: 1, name: 'Computing Society', acronym: 'CS', college_id: 1, lifecycle_status: 'active', is_active: true, submitted_at: null,
  member_counts: { STUDENT: 8, SBO_OFFICER: 3, ADMIN: 1, total: 12 }, administrators_count: 1, accreditation_status: 'accredited',
  pending_approvals_count: 2, pending_documents_count: 4, ...overrides,
});

const agency = (overrides = {}) => ({
  totals: { colleges: 2, organizations: 3, by_lifecycle_status: { pending: 1, returned: 0, active: 1, archived: 1 } },
  colleges: [
    { id: 1, name: 'College of Computing', code: 'CCS', home_organization_id: 9, organizations_count: 2, by_lifecycle_status: { pending: 1, returned: 0, active: 1, archived: 0 }, organizations: [row(), row({ id: 2, name: 'Robotics Club', acronym: 'RC', lifecycle_status: 'pending', is_active: false, accreditation_status: 'not_applicable', pending_approvals_count: 0, pending_documents_count: 0 })] },
    { id: 3, name: 'College of Arts', code: 'COA', home_organization_id: 10, organizations_count: 0, by_lifecycle_status: { pending: 0, returned: 0, active: 0, archived: 0 }, organizations: [] },
  ],
  unassigned_organizations: [],
  ...overrides,
});

const collegeList = (overview) => overview.colleges.map(({ id, name, code, organizations_count }) => ({ id, name, code, is_active: true, organizations_count }));
const show = (overview) => {
  mocks.getSystemAgency.mockResolvedValue(overview);
  mocks.getSystemColleges.mockResolvedValue(collegeList(overview));
};
const cardOf = (name) => screen.getByRole('heading', { level: 2, name }).closest('article');
const organizationsTable = async () => (await screen.findAllByRole('table'))[0];

describe('SystemCollegesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2 }]);
    mocks.getSystemAgency.mockResolvedValue(agency());
  });

  it('offers college creation and management', async () => {
    renderPage();
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
    expect(screen.getByText(/COA · 0 organizations · Active/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add college' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect((await findRowAction('Delete college and transfer users'))).toBeInTheDocument();
    expect(screen.getByText("Add colleges, assign Department Heads, and manage each college's organizations.")).toBeInTheDocument();
  });

  it('requires the exact college name for permanent deletion and keeps transfer deletion separate', async () => {
    mocks.permanentlyDeleteCollege.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await findRowAction('Delete with all data'));
    const dialog = screen.getByRole('dialog', { name: 'Permanently delete college' });
    const confirm = within(dialog).getByRole('button', { name: 'Permanently delete college' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Type the college name to confirm'), { target: { value: 'Wrong college' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Type the college name to confirm'), { target: { value: 'College of Arts' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.permanentlyDeleteCollege).toHaveBeenCalledWith(3, 'College of Arts'));
    expect(mocks.deleteSystemCollege).not.toHaveBeenCalled();
  });

  it('archives with confirmation and displays an API failure inside the dialog', async () => {
    mocks.archiveSystemCollege.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This college is already archived.' } } });
    mocks.archiveSystemCollege.mockResolvedValueOnce({ id: 3, is_active: false });
    renderPage();
    fireEvent.click(await findRowAction('Archive college'));
    const dialog = screen.getByRole('dialog', { name: 'Archive college' });
    expect(dialog).toHaveTextContent('SAO can still view their files');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive college' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already archived');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive college' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Sign-in is disabled');
  });

  it('restores an archived college and keeps Department Head mutation controls hidden until restored', async () => {
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', is_active: false, organizations_count: 2 }]);
    mocks.restoreSystemCollege.mockResolvedValue({ id: 3, is_active: true });
    renderPage();
    fireEvent.click(await findRowAction('Restore college'));
    expect(screen.queryByRole('menuitem', { name: /Assign Department Head/ })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore college' }));
    await waitFor(() => expect(mocks.restoreSystemCollege).toHaveBeenCalledWith(3));
  });

  it('adds a college and shows validation errors', async () => {
    mocks.createSystemCollege.mockRejectedValueOnce({ response: { status: 422, data: { message: 'Invalid college.', errors: { name: ['The name has already been taken.'] } } } });
    mocks.createSystemCollege.mockResolvedValueOnce({ id: 5, name: 'College of Science' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add college' }));
    const dialog = screen.getByRole('dialog', { name: 'Add college' });
    fireEvent.change(within(dialog).getByLabelText(/College name/), { target: { value: 'College of Science' } });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: ' COS ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add college' }));
    expect(await within(dialog).findByText('The name has already been taken.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add college' }));
    await waitFor(() => expect(mocks.createSystemCollege).toHaveBeenCalledWith({ name: 'College of Science', code: 'COS', description: null }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add college' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('College of Science added');
  });

  it('has one h1, from the shared header, with a breadcrumb', async () => {
    renderPage();
    await screen.findByText('College of Arts');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Colleges');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('reads the colleges and the agency overview together', async () => {
    renderPage();
    await screen.findByText('College of Arts');
    expect(mocks.getSystemColleges).toHaveBeenCalledTimes(1);
    expect(mocks.getSystemAgency).toHaveBeenCalledTimes(1);
  });

  it('links each college to its organizations', async () => {
    renderPage();
    const link = await findRowAction('View organizations of College of Arts');
    expect(link).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=active&search=College%20of%20Arts');
  });

  it('uploads a logo and shows it', async () => {
    mocks.uploadSystemCollegeLogo.mockResolvedValue({ id: 3, logo_url: 'https://cdn.test/logo.png' });
    const { container } = renderPage();
    await screen.findByText('College of Arts');
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.uploadSystemCollegeLogo).toHaveBeenCalledWith(3, file));
    expect(await screen.findByRole('status')).toHaveTextContent('Logo updated');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/logo.png');
  });

  it('shows the upload error', async () => {
    mocks.uploadSystemCollegeLogo.mockRejectedValue({ response: { status: 422, data: { message: 'The logo must be an image.' } } });
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The logo must be an image.');
  });

  it('shows an error with retry', async () => {
    mocks.getSystemColleges.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
  });

  it('keeps the college cards and Assign Department Head when only the agency read fails, with an inline error and retry in place of the tiles', async () => {
    mocks.getSystemAgency.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Not allowed.' } } });
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'College of Arts' })).toBeInTheDocument();
    expect((await findRowAction('Assign Department Head to College of Arts'))).toBeInTheDocument();
    expect((await findRowAction('Upload logo'))).toBeInTheDocument();
    expect(screen.getByText('Not allowed.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agency totals' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Agency totals' })).toBeInTheDocument();
    expect(screen.queryByText('Not allowed.')).not.toBeInTheDocument();
    expect(mocks.getSystemAgency).toHaveBeenCalledTimes(2);
    expect(mocks.getSystemColleges).toHaveBeenCalledTimes(2);
  });

  it('lets a Department Head be assigned while the agency read is failing', async () => {
    mocks.getSystemAgency.mockRejectedValue(new Error('offline'));
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 0, department_head: null }]);
    renderPage();
    fireEvent.click(await findRowAction('Assign Department Head to College of Arts'));
    expect(await screen.findByRole('dialog', { name: 'Assign Department Head' })).toBeInTheDocument();
  });

  it('shows empty and filtered states', async () => {
    mocks.getSystemColleges.mockResolvedValueOnce([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('No colleges found')).toBeInTheDocument();
    unmount();
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Search colleges'), { target: { value: 'zzz' } });
    expect(screen.getByText('No colleges match your search.')).toBeInTheDocument();
  });

  it('labels the search field with visible text', async () => {
    renderPage();
    await screen.findByText('College of Arts');
    expect(screen.getByLabelText('Search colleges').labels[0]).toHaveTextContent('Search colleges');
  });

  describe('agency overview merged into the college cards', () => {
    beforeEach(() => show(agency()));

    it('leads with the three linked agency tiles and the Colleges count, pending reviews first, and has one card per college', async () => {
      renderPage();
      const totals = await screen.findByRole('region', { name: 'Agency totals' });
      const links = within(totals).getAllByRole('link');
      expect(links.map((link) => link.querySelector('p').textContent)).toEqual(['Pending reviews', 'Organizations', 'Archived']);
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/dashboard/super-admin/organizations?status=pending',
        '/dashboard/super-admin/organizations?status=active',
        '/dashboard/super-admin/organizations?status=archived',
      ]);
      expect(within(totals).getByText('Colleges').closest('a')).toBeNull();
      expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('1');
      expect(within(totals).getByText('Colleges').nextSibling).toHaveTextContent('2');
      expect(within(totals).getByText('Archived').nextSibling).toHaveTextContent('1');
      expect(screen.getByRole('heading', { level: 2, name: 'College of Computing' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'College of Arts' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Organizations without a college' })).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps the logo, the Department Head actions and the registrations link on a card that lists organizations', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      expect(screen.getByLabelText('Logo file for College of Computing')).toBeInTheDocument();
      expect(await findRowAction('Upload logo')).toBeInTheDocument();
      expect(await findRowAction('Assign Department Head to College of Computing')).toBeInTheDocument();
      expect(await findRowAction('View organizations of College of Computing')).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=active&search=College%20of%20Computing');
    });

    it('keeps the table to five data columns plus actions so nothing is clipped', async () => {
      renderPage();
      const table = await organizationsTable();
      const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent);
      expect(headers).toEqual(['Organization', 'Status', 'Members', 'Admins', 'Needs attention', 'Actions']);
    });

    it('aligns the numeric columns to the right and uses the fixed shared column layout', async () => {
      renderPage();
      const table = await organizationsTable();
      const headers = within(table).getAllByRole('columnheader');
      expect(headers[2]).toHaveClass('text-right');
      expect(headers[3]).toHaveClass('text-right');
      expect(headers[4]).not.toHaveClass('text-right');
      expect(table.closest('[class*="table-fixed"]').className).toContain('[&_th:nth-child(5)]:w-[15%]');
      expect(table.closest('[class*="table-fixed"]').className).toContain('[&_table]:table-fixed');
    });

    it('shows the administrator count of each organization next to its members', async () => {
      show(agency({ colleges: [{ ...agency().colleges[0], organizations: [row({ administrators_count: 2 }), row({ id: 2, name: 'Robotics Club', administrators_count: 0 })] }, agency().colleges[1]] }));
      renderPage();
      const table = await organizationsTable();
      const cells = (name) => within(within(table).getByText(name).closest('tr')).getAllByRole('cell');
      expect(cells('Computing Society')[3]).toHaveTextContent('2');
      expect(cells('Robotics Club')[3]).toHaveTextContent('0');
    });

    it('leaves the Admins column out when the server does not send administrator counts', async () => {
      const withoutCount = (organization) => Object.fromEntries(Object.entries(organization).filter(([key]) => key !== 'administrators_count'));
      show(agency({ colleges: [{ ...agency().colleges[0], organizations: agency().colleges[0].organizations.map(withoutCount) }, agency().colleges[1]] }));
      renderPage();
      const table = await organizationsTable();
      const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent);
      expect(headers).toEqual(['Organization', 'Status', 'Members', 'Needs attention', 'Actions']);
      expect(table.closest('[class*="table-fixed"]').className).toContain('[&_th:nth-child(4)]:w-[17%]');
    });

    it('names the Department Head on the card and counts the administrators in the summary', async () => {
      const overview = agency({ colleges: [{ ...agency().colleges[0], administrators_count: 3 }, agency().colleges[1]] });
      show(overview);
      mocks.getSystemColleges.mockResolvedValue(collegeList(overview).map((college) => (college.id === 1 ? { ...college, department_head: { school_id: 5001, name: 'Maria Cruz', email: 'maria@example.edu', account_status: 'active' } } : college)));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      const card = cardOf('College of Computing');
      expect(within(card).getByText('Maria Cruz')).toBeInTheDocument();
      expect(within(card).getByText(/administrators/)).toHaveTextContent('3 administrators');
    });

    it('says so when a college has no Department Head yet, including colleges without organizations', async () => {
      mocks.getSystemColleges.mockResolvedValue(collegeList(agency()).map((college) => ({ ...college, department_head: null })));
      renderPage();
      expect(await screen.findAllByText('No Department Head yet')).toHaveLength(2);
    });

    it('shows no administrator count and no crash when the server omits the fields', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      expect(screen.queryByText(/Department Head:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/administrators$/)).not.toBeInTheDocument();
      expect(screen.getAllByText('No Department Head yet')).toHaveLength(2);
    });

    it('matches the agency by name when the college ids differ', async () => {
      mocks.getSystemColleges.mockResolvedValue(collegeList(agency()).map((college) => ({ ...college, id: college.id + 100 })));
      renderPage();
      const toggle = await screen.findByRole('button', { name: 'Organizations of College of Computing' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByText('Computing Society').length).toBeGreaterThan(0);
    });

    it('lists organization figures with a text status, one needs-attention cell and an Open link', async () => {
      renderPage();
      const table = await organizationsTable();
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
      show(agency({ colleges: [{ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: 1, by_lifecycle_status: { pending: 1, returned: 0, active: 0, archived: 0 }, organizations: [row({ pending_approvals_count: 0, pending_documents_count: 1 })] }] }));
      renderPage();
      expect((await screen.findAllByText('1 document')).length).toBeGreaterThan(0);
    });

    it('links Review to the organization in the review drawer, not the whole list', async () => {
      renderPage();
      const reviewLinks = await screen.findAllByRole('link', { name: 'Review Robotics Club' });
      expect(reviewLinks[0]).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending&review=2');
    });

    it('marks archived organizations as read only for assistive technology', async () => {
      show(agency({ colleges: [{ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 1, active: 0, archived: 1 }, organizations: [row({ lifecycle_status: 'archived' })] }] }));
      renderPage();
      const badge = await screen.findAllByLabelText('Archived, read only');
      expect(badge[0]).toHaveTextContent('Archived');
    });

    it('orders colleges by pending then returned reviews, then name', async () => {
      const college = (id, name, counts) => ({ id, name, code: String(id), organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 0, active: 1, archived: 0, ...counts }, organizations: [row({ id: id * 10, name: `${name} Club` })] });
      show(agency({ colleges: [college(1, 'Alpha', {}), college(2, 'Beta', { returned: 2 }), college(3, 'Gamma', { pending: 1 }), college(4, 'Delta', { pending: 1, returned: 1 })] }));
      renderPage();
      await screen.findByRole('heading', { name: /Alpha/ });
      const order = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
      expect(order).toEqual(['Delta', 'Gamma', 'Beta', 'Alpha']);
    });

    it('expands colleges that need attention, collapses the rest and lets either toggle', async () => {
      const quiet = { id: 5, name: 'College of Law', code: 'LAW', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 0, active: 1, archived: 0 }, organizations: [row({ id: 50, name: 'Moot Court' })] };
      show(agency({ colleges: [...agency().colleges, quiet] }));
      renderPage();
      const open = await screen.findByRole('button', { name: 'Organizations of College of Computing' });
      const closed = screen.getByRole('button', { name: 'Organizations of College of Law' });
      expect(open).toHaveAttribute('aria-expanded', 'true');
      expect(closed).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Moot Court')).not.toBeInTheDocument();
      fireEvent.click(closed);
      expect(closed).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByText('Moot Court').length).toBeGreaterThan(0);
      fireEvent.click(open);
      expect(screen.queryByText('Computing Society')).not.toBeInTheDocument();
    });

    it('shows the empty text and no toggle for a college without organizations', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Arts' });
      const card = cardOf('College of Arts');
      expect(card).toHaveTextContent('No student organizations yet. The Department Head registers them.');
      expect(within(card).queryByRole('button', { name: /^Organizations of/ })).not.toBeInTheDocument();
      expect(await findRowAction('View organizations of College of Arts', 'College of Arts')).toBeInTheDocument();
    });

    it('shows organizations without a college in their own section only when present', async () => {
      show(agency({ unassigned_organizations: [row({ id: 7, name: 'Loose Club', acronym: 'LC', college_id: null })] }));
      renderPage();
      expect(await screen.findByRole('heading', { name: 'Organizations without a college' })).toBeInTheDocument();
      expect(screen.getAllByText('Loose Club').length).toBeGreaterThan(0);
    });

    it('renders zero counts muted and non-zero counts bold, in the agency summary format', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      const counts = within(cardOf('College of Computing')).getByText(/pending/).closest('p');
      expect(counts).toHaveTextContent('2 organizations · 1 pending · 1 active · 0 returned · 0 archived');
      const spans = Array.from(counts.querySelectorAll('span'));
      expect(spans.map((span) => span.textContent)).toEqual(['2', '1', '1', '0', '0']);
      expect(spans[1]).toHaveClass('font-bold');
      expect(spans[3]).toHaveClass('text-ink-muted');
    });
  });

  describe('registration flow', () => {
    const waiting = row({ id: 3, name: 'Chess Club', acronym: 'CHESS', administrators_count: 0, pending_approvals_count: 0, pending_documents_count: 0 });
    const busy = row({ id: 4, name: 'Zebra Society', acronym: 'ZS', pending_approvals_count: 3, pending_documents_count: 0 });
    const quiet = row({ id: 5, name: 'Art Club', acronym: 'AC', pending_approvals_count: 0, pending_documents_count: 0 });
    const pending = row({ id: 2, name: 'Robotics Club', acronym: 'RC', lifecycle_status: 'pending', is_active: false, administrators_count: 0, pending_approvals_count: 0, pending_documents_count: 0 });
    const returned = row({ id: 6, name: 'Drama Guild', acronym: 'DG', lifecycle_status: 'returned', is_active: false, administrators_count: 0, pending_approvals_count: 0, pending_documents_count: 0 });
    const college = (organizations, counts = {}) => ({ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: organizations.length, by_lifecycle_status: { pending: 0, returned: 0, active: 0, archived: 0, ...counts }, organizations });

    it('lists the organizations that need the SAO first within a college', async () => {
      show(agency({ colleges: [college([quiet, busy, waiting, pending], { pending: 1, active: 3 })] }));
      renderPage();
      const table = await organizationsTable();

      const names = within(table).getAllByRole('row').slice(1).map((tableRow) => within(tableRow).getAllByText(/Club|Society/)[0].textContent);
      expect(names).toEqual(['Robotics Club', 'Chess Club', 'Zebra Society', 'Art Club']);
    });

    it('puts a college with an organization awaiting an administrator ahead of quieter ones', async () => {
      const calm = { id: 2, name: 'College of Arts', code: 'COA', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 3, active: 1, archived: 0 }, organizations: [quiet] };
      show(agency({ colleges: [calm, college([waiting], { active: 1 })] }));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });

      const order = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
      expect(order).toEqual(['College of Computing', 'College of Arts']);
      expect(screen.getByRole('button', { name: 'Organizations of College of Computing' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText(/awaiting administrator/)).toBeInTheDocument();
    });

    it('says what the SAO does next for each lifecycle status', async () => {
      show(agency({ colleges: [college([pending, waiting, quiet, returned], { pending: 1, returned: 1, active: 2 })] }));
      renderPage();
      const table = await organizationsTable();
      const rowOf = (name) => within(table).getByText(name).closest('tr');

      expect(within(rowOf('Robotics Club')).getByText('Review this registration')).toBeInTheDocument();
      expect(within(rowOf('Robotics Club')).getByText('Step 2 of 4: SAO approval')).toBeInTheDocument();
      expect(within(rowOf('Chess Club')).getByText('Add the first Admin account')).toBeInTheDocument();
      expect(within(rowOf('Chess Club')).getByText('Step 3 of 4: Admin account')).toBeInTheDocument();
      expect(within(rowOf('Art Club')).getByText('Active: administrator can sign in')).toBeInTheDocument();
      expect(within(rowOf('Drama Guild')).getByText('Waiting for the Department Head to resubmit')).toBeInTheDocument();
    });

    it('links Provision administrator to the prefilled administrator form', async () => {
      show(agency({ colleges: [college([waiting, quiet], { active: 2 })] }));
      renderPage();

      const link = (await screen.findAllByRole('link', { name: 'Provision administrator for Chess Club' }))[0];
      expect(link).toHaveAttribute('href', '/dashboard/super-admin/admins?organization=3&create=1');
      expect(screen.queryByRole('link', { name: 'Provision administrator for Art Club' })).not.toBeInTheDocument();
    });
  });

  describe('Department Head', () => {
    const head = (overrides = {}) => ({ school_id: 940001, name: 'Ramon Castillo', first_name: 'Ramon', last_name: 'Castillo', email: 'dean@example.edu', account_status: 'active', ...overrides });
    const college = (department_head) => [{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2, department_head }];
    const withHead = (overrides) => mocks.getSystemColleges.mockResolvedValue(college(head(overrides)));
    const withoutHead = () => mocks.getSystemColleges.mockResolvedValue(college(null));
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const fillAssignment = (overrides = {}) => {
      const values = { school_id: '20269001', first_name: 'Ramon', last_name: 'Castillo', email: 'Ramon@Example.edu ', password: 'Dean2026!Pass', password_confirmation: 'Dean2026!Pass', ...overrides };
      type(/School ID/, values.school_id);
      type(/First name/, values.first_name);
      type(/Last name/, values.last_name);
      type(/^Email/, values.email);
      type(/^Password/, values.password);
      type(/Confirm password/, values.password_confirmation);
    };
    const openAssignment = async () => {
      renderPage();
      fireEvent.click(await findRowAction(/Assign Department Head/));
      return screen.findByRole('dialog', { name: 'Assign Department Head' });
    };
    const openManagement = async () => {
      renderPage();
      fireEvent.click(await findRowAction(/Manage Department Head/));
      return screen.findByRole('dialog', { name: 'Manage Department Head' });
    };

    it('says so when a college has no Department Head and offers the single primary action', async () => {
      withoutHead();
      renderPage();

      expect(await screen.findByText('No Department Head yet')).toBeInTheDocument();
      expect((await findRowAction(/Assign Department Head/))).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Manage Department Head/ })).not.toBeInTheDocument();
    });

    it('shows the head with a text status badge and a Manage action', async () => {
      withHead();
      renderPage();

      expect(await screen.findByText('Ramon Castillo')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('dean@example.edu')).toBeInTheDocument();
      expect((await findRowAction(/Manage Department Head/))).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Assign Department Head/ })).not.toBeInTheDocument();
    });

    it('offers a replacement when the only head is inactive, and keeps Manage for reactivation', async () => {
      withHead({ account_status: 'inactive' });
      renderPage();

      expect(await screen.findByText('Inactive')).toBeInTheDocument();
      expect((await findRowAction(/Assign Department Head/))).toBeInTheDocument();
      expect((await findRowAction(/Manage Department Head/))).toBeInTheDocument();
    });

    it('validates the assignment per field and focuses the first invalid control', async () => {
      withoutHead();
      const dialog = await openAssignment();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      expect(await within(dialog).findByText('Enter the School ID.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter the first name.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter the last name.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter the email address.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter an initial password.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/School ID/)).toHaveFocus());
      expect(mocks.createDepartmentHead).not.toHaveBeenCalled();

      fillAssignment({ password_confirmation: 'different' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      expect(await within(dialog).findByText('The password confirmation does not match.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/Confirm password/)).toHaveFocus());
      expect(mocks.createDepartmentHead).not.toHaveBeenCalled();
    });

    it('assigns a head and shows them on the card', async () => {
      withoutHead();
      mocks.createDepartmentHead.mockResolvedValue({ school_id: 20269001, first_name: 'Ramon', last_name: 'Castillo', email: 'ramon@example.edu', account_status: 'active' });
      const dialog = await openAssignment();
      fillAssignment();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      await waitFor(() => expect(mocks.createDepartmentHead).toHaveBeenCalledWith(3, {
        school_id: 20269001, first_name: 'Ramon', last_name: 'Castillo', email: 'ramon@example.edu', password: 'Dean2026!Pass', password_confirmation: 'Dean2026!Pass',
      }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('status')).toHaveTextContent('Ramon Castillo is now the Department Head of College of Arts.');
      expect(screen.getByText('ramon@example.edu')).toBeInTheDocument();
      expect(screen.queryByText('No Department Head yet')).not.toBeInTheDocument();
      expect((await findRowAction(/Manage Department Head/))).toBeInTheDocument();
    });

    it('assigns an existing member using their School ID and keeps their current credentials', async () => {
      withoutHead();
      mocks.createDepartmentHead.mockResolvedValue({ school_id: 20269001, first_name: 'Ramon', last_name: 'Castillo', email: 'ramon@example.edu', account_status: 'active' });
      const dialog = await openAssignment();
      fireEvent.click(within(dialog).getByRole('radio', { name: /Existing member/ }));
      expect(within(dialog).queryByLabelText(/^Password/)).not.toBeInTheDocument();
      fireEvent.change(within(dialog).getByLabelText(/School ID/), { target: { value: '20269001' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      await waitFor(() => expect(mocks.createDepartmentHead).toHaveBeenCalledWith(3, {
        account_mode: 'existing', school_id: 20269001,
      }));
      expect(await screen.findByText('Ramon Castillo')).toBeInTheDocument();
    });

    it('shows server field errors under the field and a conflict as a form message', async () => {
      withoutHead();
      const dialog = await openAssignment();
      fillAssignment();

      mocks.createDepartmentHead.mockRejectedValueOnce({ response: { status: 422, data: { message: 'invalid', errors: { email: ['The email has already been taken.'] } } } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));
      expect(await within(dialog).findByText('The email has already been taken.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/^Email/)).toHaveFocus());

      mocks.createDepartmentHead.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This college already has an active Department Head. Deactivate the current one first.');
      expect(screen.getByRole('dialog', { name: 'Assign Department Head' })).toBeInTheDocument();
    });

    it('edits the head details and only enables Save once something changed', async () => {
      withHead();
      mocks.updateDepartmentHead.mockResolvedValue({ school_id: 940001, first_name: 'Ramon', last_name: 'Castillo', email: 'new@example.edu', account_status: 'active' });
      const dialog = await openManagement();
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();

      type(/^Email/, ' New@Example.edu ');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mocks.updateDepartmentHead).toHaveBeenCalledWith(940001, { first_name: 'Ramon', last_name: 'Castillo', email: 'new@example.edu' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('new@example.edu')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Department Head details updated.');
    });

    it('deactivates only after a confirmation that states the consequence', async () => {
      withHead();
      mocks.updateDepartmentHead.mockResolvedValue({ school_id: 940001, first_name: 'Ramon', last_name: 'Castillo', email: 'dean@example.edu', account_status: 'inactive' });
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

      const confirmation = await screen.findByRole('dialog', { name: 'Deactivate Department Head' });
      expect(within(confirmation).getByText(/They will no longer be able to sign in/)).toBeInTheDocument();
      expect(mocks.updateDepartmentHead).not.toHaveBeenCalled();
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Deactivate' }));

      await waitFor(() => expect(mocks.updateDepartmentHead).toHaveBeenCalledWith(940001, { account_status: 'inactive' }));
      expect(await screen.findByText('Inactive')).toBeInTheDocument();
      expect((await findRowAction(/Assign Department Head/))).toBeInTheDocument();
    });

    it('returns to the details when the confirmation is cancelled', async () => {
      withHead();
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Deactivate Department Head' });

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));

      expect(await screen.findByRole('dialog', { name: 'Manage Department Head' })).toBeInTheDocument();
      expect(mocks.updateDepartmentHead).not.toHaveBeenCalled();
    });

    it('reactivates an inactive head and shows the conflict when another head is active', async () => {
      withHead({ account_status: 'inactive' });
      mocks.updateDepartmentHead.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
      await openManagement();
      expect(screen.getByRole('button', { name: 'Send password reset' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Reactivate Department Head' });
      expect(within(confirmation).getByText(/They will be able to sign in again/)).toBeInTheDocument();

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Reactivate' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('This college already has an active Department Head. Deactivate the current one first.');
      expect(screen.getByRole('dialog', { name: 'Manage Department Head' })).toBeInTheDocument();
    });

    it('sends a password reset after a confirmation', async () => {
      withHead();
      mocks.resetDepartmentHeadPassword.mockResolvedValue({ message: 'Password reset instructions were sent to the Department Head email address.' });
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Send password reset' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Send password reset' });
      expect(mocks.resetDepartmentHeadPassword).not.toHaveBeenCalled();

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Send reset link' }));

      await waitFor(() => expect(mocks.resetDepartmentHeadPassword).toHaveBeenCalledWith(940001));
      expect(await screen.findByRole('status')).toHaveTextContent('Password reset instructions were sent');
    });
  });

  describe('silent refresh while the tab stays open', () => {
    const arts = (overrides = {}) => ({ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 0, ...overrides });
    const pendingPoll = () => {
      let release;
      mocks.getSystemColleges.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      return { release: (value) => act(async () => { release(value); await refresh; }) };
    };

    it('shows the new Department Head and counts without a skeleton and keeps the typed search', async () => {
      renderPage();
      expect(await screen.findByText('College of Arts')).toBeInTheDocument();
      expect(screen.getByText('No Department Head yet')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Search colleges'), { target: { value: 'Arts' } });

      const poll = pendingPoll();
      expect(screen.queryByRole('region', { name: 'Loading colleges' })).not.toBeInTheDocument();
      expect(screen.getByText('College of Arts')).toBeInTheDocument();

      await poll.release([arts({ organizations_count: 3, department_head: { name: 'Eduardo Ramos', email: 'eduardo@example.test', account_status: 'active' } })]);

      expect(screen.getByText('Eduardo Ramos')).toBeInTheDocument();
      expect(screen.getByLabelText('Search colleges')).toHaveValue('Arts');
      expect(screen.queryByRole('region', { name: 'Loading colleges' })).not.toBeInTheDocument();
    });

    it('refreshes the agency read too and keeps a card the user collapsed', async () => {
      show(agency());
      renderPage();
      const toggle = await screen.findByRole('button', { name: 'Organizations of College of Computing' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      mocks.getSystemAgency.mockResolvedValueOnce(agency({ totals: { colleges: 2, organizations: 5, by_lifecycle_status: { pending: 4, returned: 0, active: 1, archived: 1 } } }));
      await act(async () => { await refetchHook.current(); });

      expect(mocks.getSystemAgency).toHaveBeenCalledTimes(2);
      expect(mocks.getSystemColleges).toHaveBeenCalledTimes(2);
      const totals = screen.getByRole('region', { name: 'Agency totals' });
      expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('4');
      expect(within(totals).getByText('Organizations').nextSibling).toHaveTextContent('5');
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Organizations of College of Computing' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps the list and shows no error when the silent refresh fails', async () => {
      renderPage();
      expect(await screen.findByText('College of Arts')).toBeInTheDocument();

      mocks.getSystemColleges.mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('College of Arts')).toBeInTheDocument();
      expect(screen.queryByText('Unable to load colleges.')).not.toBeInTheDocument();
    });

    it('keeps the list and shows no error when only the agency refresh fails', async () => {
      renderPage();
      expect(await screen.findByText('College of Arts')).toBeInTheDocument();

      mocks.getSystemAgency.mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('College of Arts')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Agency totals' })).toBeInTheDocument();
      expect(screen.queryByText('Unable to load colleges.')).not.toBeInTheDocument();
    });

    it('recovers on its own when the first load failed and a silent refresh succeeds', async () => {
      mocks.getSystemAgency.mockRejectedValueOnce(new Error('offline'));
      renderPage();
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();

      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('College of Arts')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Agency totals' })).toBeInTheDocument();
    });

    it('recovers on its own when the first colleges read failed and a silent refresh succeeds', async () => {
      mocks.getSystemColleges.mockRejectedValueOnce(new Error('offline'));
      renderPage();
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(screen.queryByText('College of Arts')).not.toBeInTheDocument();

      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('College of Arts')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Agency totals' })).toBeInTheDocument();
    });

    it('keeps the agency tiles when a silent refresh loses only the agency read', async () => {
      renderPage();
      await screen.findByRole('region', { name: 'Agency totals' });

      mocks.getSystemAgency.mockRejectedValueOnce(new Error('offline'));
      mocks.getSystemColleges.mockResolvedValueOnce([arts({ name: 'College of Arts Renamed' })]);
      await act(async () => { await refetchHook.current(); });

      expect(screen.getByText('College of Arts Renamed')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Agency totals' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('drops a silent response that arrives after a newer full load', async () => {
      mocks.getSystemAgency.mockRejectedValueOnce(new Error('offline'));
      renderPage();
      await screen.findByRole('button', { name: 'Try again' });

      const poll = pendingPoll();
      mocks.getSystemAgency.mockResolvedValueOnce(agency({ totals: { colleges: 2, organizations: 9, by_lifecycle_status: { pending: 7, returned: 0, active: 1, archived: 1 } } }));
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      const totals = await screen.findByRole('region', { name: 'Agency totals' });
      expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('7');

      await poll.release([arts({ name: 'College of Stale Data' })]);

      expect(within(screen.getByRole('region', { name: 'Agency totals' })).getByText('Pending reviews').nextSibling).toHaveTextContent('7');
      expect(screen.queryByText('College of Stale Data')).not.toBeInTheDocument();
    });

    it('drops a silent response that was in flight when a logo upload finished', async () => {
      mocks.uploadSystemCollegeLogo.mockResolvedValue({ id: 3, logo_url: 'https://cdn.test/new-logo.png' });
      const { container } = renderPage();
      await screen.findByText('College of Arts');

      const poll = pendingPoll();
      fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });
      expect(await screen.findByRole('status')).toHaveTextContent('Logo updated');
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/new-logo.png');

      await poll.release([arts({ logo_url: 'https://cdn.test/old-logo.png' })]);

      expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/new-logo.png');
    });

    it('drops a silent response that was in flight when a Department Head was changed', async () => {
      mocks.getSystemColleges.mockResolvedValue([arts({ department_head: { school_id: 940001, name: 'Ramon Castillo', first_name: 'Ramon', last_name: 'Castillo', email: 'dean@example.edu', account_status: 'active' } })]);
      mocks.updateDepartmentHead.mockResolvedValue({ school_id: 940001, first_name: 'Ramon', last_name: 'Castillo', email: 'new@example.edu', account_status: 'active' });
      renderPage();
      fireEvent.click(await findRowAction(/Manage Department Head/));
      const dialog = await screen.findByRole('dialog', { name: 'Manage Department Head' });

      const poll = pendingPoll();
      fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'new@example.edu' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('new@example.edu')).toBeInTheDocument();

      await poll.release([arts({ department_head: { school_id: 940001, name: 'Ramon Castillo', email: 'dean@example.edu', account_status: 'active' } })]);

      expect(screen.getByText('new@example.edu')).toBeInTheDocument();
      expect(screen.queryByText('dean@example.edu')).not.toBeInTheDocument();
    });
  });

  it('requires an empty replacement before deleting an assigned college', async () => {
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', is_active: true, organizations_count: 2, has_assignments: true }, { id: 4, name: 'College of Science', is_active: true, organizations_count: 0, can_receive_transfer: true }, { id: 5, name: 'Busy College', is_active: true, organizations_count: 1, can_receive_transfer: false }]);
    mocks.deleteSystemCollege.mockResolvedValue({});
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.click(await findRowAction('Delete college and transfer users', 'College of Arts'));
    const dialog = screen.getByRole('dialog', { name: 'Delete College of Arts' });
    expect(within(dialog).getByRole('button', { name: 'Delete college' })).toBeDisabled();
    const replacement = within(dialog).getByLabelText(/Replacement college/);
    expect(within(replacement).queryByRole('option', { name: 'Busy College' })).not.toBeInTheDocument();
    fireEvent.change(replacement, { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete college' }));
    await waitFor(() => expect(mocks.deleteSystemCollege).toHaveBeenCalledWith(3, '4'));
  });

  it('explains when a replacement college must be added first', async () => {
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', is_active: true, organizations_count: 2, has_assignments: true }]);
    renderPage();
    fireEvent.click((await findRowAction('Delete college and transfer users')));
    const dialog = screen.getByRole('dialog', { name: 'Delete College of Arts' });
    expect(dialog).toHaveTextContent('add a new college first');
    expect(within(dialog).getByRole('button', { name: 'Delete college' })).toBeDisabled();
  });
});
