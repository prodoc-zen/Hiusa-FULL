import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemCollegesPage from './SystemCollegesPage';
import { findRowAction } from '../../../test/rowActions';

const mocks = vi.hoisted(() => ({
  getSystemColleges: vi.fn(), getSystemAgency: vi.fn(), updateSystemCollege: vi.fn(), uploadSystemCollegeLogo: vi.fn(),
  inviteDepartmentHead: vi.fn(), updateDepartmentHead: vi.fn(), resetDepartmentHeadPassword: vi.fn(),
  archiveSystemCollege: vi.fn(), restoreSystemCollege: vi.fn(), createSystemCollege: vi.fn(), deleteSystemCollege: vi.fn(),
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
const openDetails = async (name = 'College of Computing') => {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog', { name });
};
const organizationsTable = async (name) => within(await openDetails(name)).getByRole('table');

describe('SystemCollegesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2 }]);
    mocks.getSystemAgency.mockResolvedValue(agency());
  });

  it('offers one primary Add college button beside a secondary Department Head invite, and edit, archive and delete per college', async () => {
    renderPage();
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
    expect(cardOf('College of Arts').querySelector('h2 + p')).toHaveTextContent('COA · 0 organizations · 0 members');
    expect(screen.getAllByRole('button', { name: 'Invite Department Head' })[0]).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add college' })).toBeEnabled();
    expect(await findRowAction(/^Edit College of Arts/)).toBeInTheDocument();
    expect(await findRowAction('Archive college')).toBeInTheDocument();
    expect(await findRowAction('Delete college')).toBeEnabled();
    expect(screen.queryByText('Add a college, edit it, invite its Department Head, and see its organizations.')).not.toBeInTheDocument();
  });

  it('adds a college from the modal, sends only the filled fields and shows it in the list', async () => {
    mocks.createSystemCollege.mockResolvedValue({ id: 8, name: 'College of Law', code: 'LAW' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add college' }));
    const dialog = screen.getByRole('dialog', { name: 'Add college' });
    fireEvent.change(within(dialog).getByLabelText(/College name/), { target: { value: '  College of Law ' } });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: 'LAW' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add college' }));
    await waitFor(() => expect(mocks.createSystemCollege).toHaveBeenCalledWith({ name: 'College of Law', code: 'LAW', color: null }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('College of Law added.');
    expect(mocks.getSystemColleges).toHaveBeenCalledTimes(2);
  });

  it('sends the chosen color and keeps the modal open with field errors when the name is taken', async () => {
    mocks.createSystemCollege.mockRejectedValue({ response: { status: 422, data: { errors: { name: ['The name has already been taken.'] } } } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add college' }));
    const dialog = screen.getByRole('dialog', { name: 'Add college' });
    fireEvent.change(within(dialog).getByLabelText(/College name/), { target: { value: 'College of Arts' } });
    fireEvent.change(within(dialog).getByLabelText(/^Color/), { target: { value: '#123abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add college' }));
    expect(await within(dialog).findByText('The name has already been taken.')).toBeInTheDocument();
    expect(mocks.createSystemCollege).toHaveBeenCalledWith({ name: 'College of Arts', code: null, color: '#123ABC' });
    expect(screen.getByRole('dialog', { name: 'Add college' })).toBeInTheDocument();
  });

  it('deletes an empty college after confirmation and refreshes the list', async () => {
    mocks.deleteSystemCollege.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await findRowAction('Delete college'));
    const dialog = screen.getByRole('dialog', { name: 'Delete college' });
    expect(dialog).toHaveTextContent('Delete College of Arts?');
    expect(mocks.deleteSystemCollege).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete college' }));
    await waitFor(() => expect(mocks.deleteSystemCollege).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('College of Arts deleted.');
    expect(mocks.getSystemColleges).toHaveBeenCalledTimes(2);
  });

  it('disables Delete with the reason when the college still has organizations or people', async () => {
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2, can_delete: false }]);
    renderPage();
    const item = await findRowAction('Delete college (has organizations or people)');
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(screen.queryByRole('dialog', { name: 'Delete college' })).not.toBeInTheDocument();
    expect(mocks.deleteSystemCollege).not.toHaveBeenCalled();
  });

  it('shows the server refusal inside the delete dialog and keeps the college', async () => {
    mocks.deleteSystemCollege.mockRejectedValue({ response: { status: 409, data: { message: 'This college still has organizations or people. Archive it instead.' } } });
    renderPage();
    fireEvent.click(await findRowAction('Delete college'));
    const dialog = screen.getByRole('dialog', { name: 'Delete college' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete college' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Archive it instead.');
    expect(screen.getByRole('dialog', { name: 'Delete college' })).toBeInTheDocument();
    expect(screen.getByText('College of Arts')).toBeInTheDocument();
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
    expect(screen.queryByRole('menuitem', { name: /Invite Department Head/ })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore college' }));
    await waitFor(() => expect(mocks.restoreSystemCollege).toHaveBeenCalledWith(3));
  });

  it('has one h1, from the shared header, with a breadcrumb', async () => {
    renderPage();
    await screen.findByText('College of Arts');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Colleges');
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
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

  it('keeps the college cards and Invite Department Head when only the agency read fails, with an inline error and retry in place of the tiles', async () => {
    mocks.getSystemAgency.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Not allowed.' } } });
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'College of Arts' })).toBeInTheDocument();
    expect((await findRowAction('Invite Department Head to College of Arts'))).toBeInTheDocument();
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

  it('says in the details that organization figures are unavailable while the agency read is failing', async () => {
    mocks.getSystemAgency.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Not allowed.' } } });
    renderPage();
    const drawer = await openDetails('College of Arts');
    expect(within(drawer).getByText('Organization details are unavailable until the agency overview loads.')).toBeInTheDocument();
    expect(within(drawer).queryByRole('table')).not.toBeInTheDocument();
  });

  it('lets a Department Head be invited while the agency read is failing', async () => {
    mocks.getSystemAgency.mockRejectedValue(new Error('offline'));
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 0, department_head: null }]);
    renderPage();
    fireEvent.click(await findRowAction('Invite Department Head to College of Arts'));
    expect(await screen.findByRole('dialog', { name: 'Invite Department Head' })).toBeInTheDocument();
  });

  it('shows empty and filtered states', async () => {
    mocks.getSystemColleges.mockResolvedValueOnce([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('No colleges yet')).toBeInTheDocument();
    expect(screen.getByText('Add a college, then invite its Department Head.')).toBeInTheDocument();
    unmount();
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Search colleges'), { target: { value: 'zzz' } });
    expect(screen.getByText('No colleges match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Search colleges')).toHaveValue('');
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
  });

  it('makes each college name the tap target that opens its details, with the head and the organization figures only on larger screens', async () => {
    show(agency());
    mocks.getSystemColleges.mockResolvedValue(collegeList(agency()).map((college) => (college.id === 1 ? { ...college, department_head: { school_id: 5001, name: 'Maria Cruz', email: 'maria@example.edu', account_status: 'active' } } : college)));
    renderPage();
    const heading = await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
    const card = heading.closest('article');
    expect(within(card).getByText('Maria Cruz').closest('div')).toHaveClass('max-md:hidden');
    expect(within(card).getByText(/^2 organizations/).closest('div')).toHaveClass('max-md:hidden');
    expect(within(card).queryByRole('table')).not.toBeInTheDocument();

    fireEvent.click(within(heading).getByRole('button', { name: 'College of Computing' }));
    const drawer = await screen.findByRole('dialog', { name: 'College of Computing' });
    expect(within(drawer).getByText('Department Head')).toBeInTheDocument();
    expect(within(drawer).getByText('Maria Cruz')).toBeInTheDocument();
    expect(within(drawer).getByText('maria@example.edu')).toBeInTheDocument();
    expect(within(drawer).getByRole('table')).toBeInTheDocument();
  });

  it('adds a mobile-only cue to the one-line meta when the college has no Department Head or has organizations waiting', async () => {
    const overview = agency({ colleges: [{ ...agency().colleges[0], organizations: [row(), row({ id: 2, name: 'Robotics Club', lifecycle_status: 'returned' }), row({ id: 3, name: 'Chess Club', administrators_count: 0 })], organizations_count: 3, by_lifecycle_status: { pending: 1, returned: 1, active: 1, archived: 0 } }, agency().colleges[1]] });
    show(overview);
    mocks.getSystemColleges.mockResolvedValue(collegeList(overview).map((college) => (college.id === 3 ? { ...college, department_head: { school_id: 5001, name: 'Maria Cruz', email: 'maria@example.edu', account_status: 'active' } } : { ...college, department_head: null })));
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
    const computingMeta = cardOf('College of Computing').querySelector('h2 + p');
    expect(computingMeta).toHaveClass('md:hidden');
    expect(computingMeta).toHaveTextContent('· No Department Head');
    expect(computingMeta).toHaveTextContent('· 3 waiting');
    const artsMeta = cardOf('College of Arts').querySelector('h2 + p');
    expect(artsMeta).not.toHaveTextContent('No Department Head');
    expect(artsMeta).not.toHaveTextContent('waiting');
  });

  it('adds no mobile cue for an archived college without a head or for a quiet college with one', async () => {
    mocks.getSystemColleges.mockResolvedValue([
      { id: 3, name: 'College of Arts', code: 'COA', is_active: false, organizations_count: 0, department_head: null },
      { id: 4, name: 'College of Science', code: 'COS', is_active: true, organizations_count: 0, department_head: { school_id: 5001, name: 'Maria Cruz', email: 'maria@example.edu', account_status: 'active' } },
    ]);
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'College of Arts' });
    const meta = (name) => cardOf(name).querySelector('h2 + p');
    expect(meta('College of Arts')).toHaveTextContent('COA · 0 organizations · 0 members · Archived');
    expect(meta('College of Arts')).not.toHaveTextContent('No Department Head');
    expect(meta('College of Science')).not.toHaveTextContent('No Department Head');
    expect(meta('College of Science')).not.toHaveTextContent('waiting');
  });

  it('labels the search field with visible text', async () => {
    renderPage();
    await screen.findByText('College of Arts');
    expect(screen.getByLabelText('Search colleges').labels[0]).toHaveTextContent('Search colleges');
  });

  describe('agency overview merged into the college cards', () => {
    beforeEach(() => show(agency()));

    it('leads with three linked agency tiles, pending reviews first, and has one card per college', async () => {
      renderPage();
      const totals = await screen.findByRole('region', { name: 'Agency totals' });
      const links = within(totals).getAllByRole('link');
      expect(links.map((link) => link.querySelector('p').textContent)).toEqual(['Pending reviews', 'Organizations', 'Archived']);
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/dashboard/super-admin/organizations?status=pending',
        '/dashboard/super-admin/organizations?status=active',
        '/dashboard/super-admin/organizations?status=archived',
      ]);
      expect(within(totals).queryByText('Colleges')).not.toBeInTheDocument();
      expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('1');
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
      expect(await findRowAction('Invite Department Head to College of Computing')).toBeInTheDocument();
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

    it('names the Department Head on the card and counts the administrators in the details', async () => {
      const overview = agency({ colleges: [{ ...agency().colleges[0], administrators_count: 3 }, agency().colleges[1]] });
      show(overview);
      mocks.getSystemColleges.mockResolvedValue(collegeList(overview).map((college) => (college.id === 1 ? { ...college, department_head: { school_id: 5001, name: 'Maria Cruz', email: 'maria@example.edu', account_status: 'active' } } : college)));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      expect(within(cardOf('College of Computing')).getByText('Maria Cruz')).toBeInTheDocument();
      const drawer = await openDetails();
      expect(within(drawer).getByText(/administrators/)).toHaveTextContent('3 administrators');
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
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      expect(cardOf('College of Computing')).toHaveTextContent('2 organizations');
      expect(within(await organizationsTable()).getByText('Computing Society')).toBeInTheDocument();
    });

    it('lists organization figures with no badge on an active organization, one needs-attention cell and an Open link', async () => {
      renderPage();
      const table = await organizationsTable();
      const first = within(table).getByText('Computing Society').closest('tr');
      expect(within(first).queryByText('Active')).not.toBeInTheDocument();
      expect(within(first).getByText('12')).toBeInTheDocument();
      expect(within(first).getByText('2 approvals, 4 documents')).toBeInTheDocument();
      expect(within(first).queryByText('Accredited')).not.toBeInTheDocument();
      expect(within(first).getByRole('link', { name: 'Open Computing Society' })).toHaveAttribute('href', '/dashboard/super-admin/org/1');
      const second = within(table).getByText('Robotics Club').closest('tr');
      expect(within(second).getByText('Nothing waiting')).toBeInTheDocument();
    });

    it('shows a singular needs-attention summary', async () => {
      show(agency({ colleges: [{ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: 1, by_lifecycle_status: { pending: 1, returned: 0, active: 0, archived: 0 }, organizations: [row({ pending_approvals_count: 0, pending_documents_count: 1 })] }] }));
      renderPage();
      expect(within(await organizationsTable()).getByText('1 document')).toBeInTheDocument();
    });

    it('links Review to the organization in the review drawer, not the whole list', async () => {
      renderPage();
      const drawer = await openDetails();
      const reviewLinks = within(drawer).getAllByRole('link', { name: 'Review Robotics Club' });
      expect(reviewLinks[0]).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending&review=2');
    });

    it('marks archived organizations as read only for assistive technology', async () => {
      show(agency({ colleges: [{ id: 1, name: 'College of Computing', code: 'CCS', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 1, active: 0, archived: 1 }, organizations: [row({ lifecycle_status: 'archived' })] }] }));
      renderPage();
      const drawer = await openDetails();
      expect(within(drawer).getAllByLabelText('Archived, read only')[0]).toHaveTextContent('Archived');
    });

    it('orders colleges by pending then returned reviews, then name', async () => {
      const college = (id, name, counts) => ({ id, name, code: String(id), organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 0, active: 1, archived: 0, ...counts }, organizations: [row({ id: id * 10, name: `${name} Club` })] });
      show(agency({ colleges: [college(1, 'Alpha', {}), college(2, 'Beta', { returned: 2 }), college(3, 'Gamma', { pending: 1 }), college(4, 'Delta', { pending: 1, returned: 1 })] }));
      renderPage();
      await screen.findByRole('heading', { name: /Alpha/ });
      const order = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
      expect(order).toEqual(['Delta', 'Gamma', 'Beta', 'Alpha']);
    });

    it('shows one compact row per college with what is waiting, and lists organizations only in the details', async () => {
      const quiet = { id: 5, name: 'College of Law', code: 'LAW', organizations_count: 1, by_lifecycle_status: { pending: 0, returned: 0, active: 1, archived: 0 }, organizations: [row({ id: 50, name: 'Moot Court' })] };
      show(agency({ colleges: [...agency().colleges, quiet] }));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Computing' });
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Organizations of/ })).not.toBeInTheDocument();
      expect(cardOf('College of Computing')).toHaveTextContent('2 organizations · 24 members');
      expect(cardOf('College of Computing')).toHaveTextContent('1 pending');
      expect(cardOf('College of Law')).toHaveTextContent('1 organization · 12 members');
      expect(cardOf('College of Law')).not.toHaveTextContent('pending');
      expect(screen.queryByText('Moot Court')).not.toBeInTheDocument();
      const drawer = await openDetails('College of Law');
      expect(within(drawer).getAllByText('Moot Court').length).toBeGreaterThan(0);
    });

    it('shows zero organizations on the row and the apply flow in the details for a college without organizations', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'College of Arts' });
      const card = cardOf('College of Arts');
      expect(card).toHaveTextContent('0 organizations · 0 members');
      expect(card).not.toHaveTextContent('No student organizations yet');
      const drawer = await openDetails('College of Arts');
      expect(within(drawer).getByText('No student organizations yet. A student the Department Head allows applies, the Department Head reviews the application, and you approve it.')).toBeInTheDocument();
      expect(within(drawer).queryByText(/registers/)).not.toBeInTheDocument();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
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
      const counts = within(await openDetails()).getByText(/pending/).closest('p');
      expect(counts).toHaveTextContent('2 organizations · 1 pending · 1 active · 0 returned · 0 archived');
      const spans = Array.from(counts.querySelectorAll('span'));
      expect(spans.map((span) => span.textContent)).toEqual(['2', '1', '1', '0', '0']);
      expect(spans[1]).toHaveClass('font-semibold');
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
      expect(cardOf('College of Computing')).toHaveTextContent('1 awaiting organization head');
    });

    it('says what the SAO does next for each lifecycle status', async () => {
      show(agency({ colleges: [college([pending, waiting, quiet, returned], { pending: 1, returned: 1, active: 2 })] }));
      renderPage();
      const table = await organizationsTable();
      const rowOf = (name) => within(table).getByText(name).closest('tr');

      expect(within(rowOf('Robotics Club')).getByText('Review this registration')).toBeInTheDocument();
      expect(within(rowOf('Robotics Club')).getByText('Step 2 of 4: SAO approval')).toBeInTheDocument();
      expect(within(rowOf('Chess Club')).getByText('Approved: waiting for the Department Head to name the organization head')).toBeInTheDocument();
      expect(within(rowOf('Chess Club')).getByText('Step 3 of 4: Admin account')).toBeInTheDocument();
      expect(within(rowOf('Art Club')).getByText('Active: administrator can sign in')).toBeInTheDocument();
      expect(within(rowOf('Drama Guild')).getByText('Waiting for the Department Head to resubmit')).toBeInTheDocument();
    });

    it('offers no Provision administrator link, only Open, for an organization still waiting for its first Admin', async () => {
      show(agency({ colleges: [college([waiting, quiet], { active: 2 })] }));
      renderPage();

      const drawer = await openDetails();
      expect(within(drawer).queryByRole('link', { name: /Provision administrator/ })).not.toBeInTheDocument();
      expect(within(drawer).getAllByRole('link', { name: 'Open Chess Club' })[0]).toBeInTheDocument();
    });
  });

  describe('Department Head', () => {
    const head = (overrides = {}) => ({ school_id: 940001, name: 'Ramon Castillo', first_name: 'Ramon', last_name: 'Castillo', email: 'dean@example.edu', account_status: 'active', ...overrides });
    const college = (department_head) => [{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2, department_head }];
    const withHead = (overrides) => mocks.getSystemColleges.mockResolvedValue(college(head(overrides)));
    const withoutHead = () => mocks.getSystemColleges.mockResolvedValue(college(null));
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const openInvite = async () => {
      renderPage();
      fireEvent.click(await findRowAction(/Invite Department Head/));
      return screen.findByRole('dialog', { name: 'Invite Department Head' });
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
      expect((await findRowAction(/Invite Department Head/))).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Manage Department Head/ })).not.toBeInTheDocument();
    });

    it('shows the head, with a status badge only when the account is not active, and a Manage action', async () => {
      withHead();
      renderPage();

      expect(await screen.findByText('Ramon Castillo')).toBeInTheDocument();
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(screen.getByText('dean@example.edu')).toBeInTheDocument();
      expect((await findRowAction(/Manage Department Head/))).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /Invite Department Head/ })).not.toBeInTheDocument();
    });

    it('offers a replacement when the only head is inactive, and keeps Manage for reactivation', async () => {
      withHead({ account_status: 'inactive' });
      renderPage();

      expect(await screen.findByText('Inactive')).toBeInTheDocument();
      expect((await findRowAction(/Invite Department Head/))).toBeInTheDocument();
      expect((await findRowAction(/Manage Department Head/))).toBeInTheDocument();
    });

    it('asks for a college before making a link', async () => {
      withoutHead();
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Invite Department Head' }));
      const dialog = await screen.findByRole('dialog', { name: 'Invite Department Head' });

      fireEvent.change(within(dialog).getByLabelText(/Send it to/), { target: { value: 'not-an-email' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

      expect(await within(dialog).findByText('Choose a college.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter a valid email address, or leave it blank.')).toBeInTheDocument();
      expect(mocks.inviteDepartmentHead).not.toHaveBeenCalled();
    });

    it('does not promise an email before the link is made, because mail may be off', async () => {
      withoutHead();
      const dialog = await openInvite();

      expect(within(dialog).queryByText(/We email the link/)).not.toBeInTheDocument();
      expect(within(dialog).getByText('The link is shown for you to copy. It is emailed to this address only when email is set up.')).toBeInTheDocument();
    });

    it('makes a link from the college card with the college already chosen, and asks for no identity', async () => {
      withoutHead();
      mocks.inviteDepartmentHead.mockResolvedValue({ magic_link: 'http://localhost:5173/accept-invitation?token=abc', emailed: false });
      const dialog = await openInvite();
      expect(within(dialog).getByLabelText(/^College/)).toHaveValue('3');
      expect(within(dialog).queryByLabelText(/School ID/)).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/First name/)).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/Password/)).not.toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

      await waitFor(() => expect(mocks.inviteDepartmentHead).toHaveBeenCalledWith('3', {}));
      const ready = await screen.findByRole('dialog', { name: 'Link ready' });
      expect(within(ready).getByLabelText('Invitation link')).toHaveValue('http://localhost:5173/accept-invitation?token=abc');
      expect(within(ready).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
      fireEvent.click(within(ready).getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('status')).toHaveTextContent('Link created for College of Arts');
    });

    it('copies the link and sends it to the optional email', async () => {
      withoutHead();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      mocks.inviteDepartmentHead.mockResolvedValue({ magic_link: 'http://localhost:5173/accept-invitation?token=xyz', emailed: true });
      const dialog = await openInvite();
      type(/Send it to/, ' Dean@Example.edu ');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

      await waitFor(() => expect(mocks.inviteDepartmentHead).toHaveBeenCalledWith('3', { email: 'dean@example.edu' }));
      const ready = await screen.findByRole('dialog', { name: 'Link ready' });
      expect(within(ready).getByRole('status')).toHaveTextContent('We also emailed it to dean@example.edu.');
      fireEvent.click(within(ready).getByRole('button', { name: 'Copy link' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:5173/accept-invitation?token=xyz'));
      expect(await within(ready).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('says nothing was sent when the server reports that email is switched off', async () => {
      withoutHead();
      mocks.inviteDepartmentHead.mockResolvedValue({ magic_link: 'http://localhost:5173/accept-invitation?token=off', emailed: false, mail_is_off: true });
      const dialog = await openInvite();
      type(/Send it to/, 'dean@example.edu');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

      const ready = await screen.findByRole('dialog', { name: 'Link ready' });
      expect(within(ready).getByRole('status')).toHaveTextContent('Email is switched off, so nothing was sent to dean@example.edu. Copy the link and send it yourself.');
      expect(within(ready).queryByText(/We also emailed it/)).not.toBeInTheDocument();
      expect(within(ready).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('lets the SAO pick the college from the page header', async () => {
      mocks.getSystemColleges.mockResolvedValue([
        { id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 0, department_head: null },
        { id: 4, name: 'College of Science', code: 'COS', is_active: true, organizations_count: 0, department_head: head() },
      ]);
      mocks.inviteDepartmentHead.mockResolvedValue({ magic_link: 'http://localhost:5173/accept-invitation?token=h', emailed: false });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Invite Department Head' }));
      const dialog = await screen.findByRole('dialog', { name: 'Invite Department Head' });
      const select = within(dialog).getByLabelText(/^College/);
      fireEvent.change(select, { target: { value: '3' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

      await waitFor(() => expect(mocks.inviteDepartmentHead).toHaveBeenCalledWith('3', {}));
    });

    it('shows a conflict inside the dialog and keeps it open', async () => {
      withoutHead();
      mocks.inviteDepartmentHead.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
      const dialog = await openInvite();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This college already has an active Department Head. Deactivate the current one first.');
      expect(screen.getByRole('dialog', { name: 'Invite Department Head' })).toBeInTheDocument();
    });

    it('disables the header button when every college already has a head', async () => {
      withHead();
      renderPage();
      expect(await screen.findByText('Ramon Castillo')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Invite Department Head' })).toBeDisabled();
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
      expect((await findRowAction(/Invite Department Head/))).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Create reset link' })).toBeDisabled();
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
      fireEvent.click(screen.getByRole('button', { name: 'Create reset link' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Create reset link' });
      expect(mocks.resetDepartmentHeadPassword).not.toHaveBeenCalled();

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Create reset link' }));

      await waitFor(() => expect(mocks.resetDepartmentHeadPassword).toHaveBeenCalledWith(940001));
      expect(await screen.findByRole('status')).toHaveTextContent('Password reset instructions were sent');
    });

    it('shows the one-time reset link with a copy button when mail is off', async () => {
      const writeText = vi.fn().mockResolvedValue();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      withHead();
      mocks.resetDepartmentHeadPassword.mockResolvedValue({ message: 'The reset link is ready.', reset_link: 'https://hiusa.example.test/reset-password?token=abc' });
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Create reset link' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Create reset link' });
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Create reset link' }));

      const dialog = await screen.findByRole('dialog', { name: 'Reset link ready' });
      expect(within(dialog).getByDisplayValue('https://hiusa.example.test/reset-password?token=abc')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://hiusa.example.test/reset-password?token=abc'));
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

    it('refreshes the agency read too and keeps the details the user opened', async () => {
      show(agency());
      renderPage();
      await openDetails();

      mocks.getSystemAgency.mockResolvedValueOnce(agency({ totals: { colleges: 2, organizations: 5, by_lifecycle_status: { pending: 4, returned: 0, active: 1, archived: 1 } } }));
      await act(async () => { await refetchHook.current(); });

      expect(mocks.getSystemAgency).toHaveBeenCalledTimes(2);
      expect(mocks.getSystemColleges).toHaveBeenCalledTimes(2);
      const totals = screen.getByRole('region', { name: 'Agency totals' });
      expect(within(totals).getByText('Pending reviews').nextSibling).toHaveTextContent('4');
      expect(within(totals).getByText('Organizations').nextSibling).toHaveTextContent('5');
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'College of Computing' })).toBeInTheDocument();
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
});
