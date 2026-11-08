import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CollegeOrganizationsPage from './CollegeOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getCollegeOrganizations: vi.fn(),
  getCollegeOverview: vi.fn(),
}));
vi.mock('../../../services/collegeOrganizationService', () => mocks);
const grantMocks = vi.hoisted(() => ({ getApplicantGrants: vi.fn(), allowStudentToApply: vi.fn(), revokeApplicantGrant: vi.fn() }));
vi.mock('../../../services/applicantGrantService', () => grantMocks);
const peopleMocks = vi.hoisted(() => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/peopleService', () => peopleMocks);
const refetchHook = vi.hoisted(() => ({ current: null }));
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: (refetch) => { refetchHook.current = refetch; } }));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => openMocks);

const checklist = (status = 'submitted') => [
  { requirement_type_id: 1, requirement_name: 'Constitution', file_name: 'constitution.pdf', status, submission_id: 11 },
  { requirement_type_id: 2, requirement_name: 'Officer list', file_name: 'officers.pdf', status: 'approved', submission_id: 12 },
];

const organization = (overrides) => ({
  id: 1, name: 'Robotics Society', acronym: 'ROBO', description: 'Builds robots', color: '#0B8ED0', college: 'College of Engineering', lifecycle_status: 'active',
  review_remarks: null, submitted_at: '2026-09-01T08:00:00+08:00', members_count: 12, administrators_count: 2, registration_requirements: null, ...overrides,
});

const organizations = [
  organization(),
  organization({ id: 2, name: 'Chess Club', acronym: 'CHESS', lifecycle_status: 'pending', registration_requirements: checklist() }),
  organization({ id: 3, name: 'Drama Guild', acronym: 'DRAMA', lifecycle_status: 'returned', review_remarks: 'The constitution is missing signatures.', registration_requirements: checklist('returned') }),
  organization({ id: 4, name: 'Old Band', acronym: 'BAND', lifecycle_status: 'archived' }),
];

const paginator = (data) => ({ data: { data, current_page: 1, last_page: 1, per_page: 100, total: data.length } });

async function chooseOrganizationAction(name, action) {
  fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${name}` }))[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(entry = '/dashboard/department-head/organizations') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CollegeOrganizationsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('CollegeOrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCollegeOrganizations.mockResolvedValue(paginator(organizations));
    grantMocks.getApplicantGrants.mockResolvedValue({ data: { data: [] } });
    mocks.getCollegeOverview.mockResolvedValue({ data: { college: { id: 5, name: 'College of Engineering', code: 'COE', logo_url: null, color: '#0B8ED0' }, head: { name: 'Eduardo Ramos' } } });
  });

  it('opens with a header naming the college and its Department Head', async () => {
    renderPage();

    const header = await screen.findByRole('region', { name: 'Your college' });
    expect(await within(header).findByRole('heading', { name: 'College of Engineering' })).toBeInTheDocument();
    expect(within(header).getByText('Department Head: Eduardo Ramos')).toBeInTheDocument();
    expect(header.querySelector('img')).toBeNull();
  });

  it('shows the college logo when it has one', async () => {
    mocks.getCollegeOverview.mockResolvedValue({ data: { college: { id: 5, name: 'College of Engineering', logo_url: 'https://example.test/coe.png', color: null }, head: { name: 'Eduardo Ramos' } } });
    renderPage();

    const header = await screen.findByRole('region', { name: 'Your college' });
    await waitFor(() => expect(header.querySelector('img')).toHaveAttribute('src', 'https://example.test/coe.png'));
  });

  it('counts Admins, SBO Officers and students per organization', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([
      organization({ role_counts: { admin: 2, sbo_officer: 5, student: 31 } }),
      organization({ id: 2, name: 'Chess Club', acronym: 'CHESS', role_counts: { admin: 1, sbo_officer: 0, student: 9 } }),
    ]));
    renderPage();

    const table = (await screen.findAllByRole('table'))[0];
    ['Admins', 'SBO Officers', 'Students'].forEach((name) => expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument());
    const robotics = within(table).getAllByRole('row').find((row) => within(row).queryByText('Robotics Society'));
    const chess = within(table).getAllByRole('row').find((row) => within(row).queryByText('Chess Club'));
    expect(['2', '5', '31'].every((value) => within(robotics).getByText(value))).toBe(true);
    expect(['1', '0', '9'].every((value) => within(chess).getByText(value))).toBe(true);
  });

  it('shows leadership and role counts in the read-only organization drawer', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([organization({
      role_counts: { admin: 1, sbo_officer: 2, student: 40 },
      leadership: [
        { name: 'Ada Admin', role: 'ADMIN', position_title: null },
        { name: 'Pia President', role: 'SBO_OFFICER', position_title: 'President' },
      ],
    })]));
    renderPage();
    await screen.findAllByText('Robotics Society');

    await chooseOrganizationAction('Robotics Society', 'View checklist');

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Leadership' })).toBeInTheDocument();
    expect(within(drawer).getByText('Ada Admin')).toBeInTheDocument();
    expect(within(drawer).getByText('SBO Officer, President')).toBeInTheDocument();
    expect(within(drawer).getByText('Students').previousSibling).toHaveTextContent('40');
    expect(within(drawer).getByText('SBO Officers').previousSibling).toHaveTextContent('2');
    expect(within(drawer).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says so when an organization has no Admin or SBO Officer yet', async () => {
    renderPage();
    await screen.findAllByText('Chess Club');

    await chooseOrganizationAction('Chess Club', 'View checklist');

    expect(await within(await screen.findByRole('dialog')).findByText('No Admin or SBO Officer is assigned yet.')).toBeInTheDocument();
  });

  it('lists the college organizations with a status badge in text and the college name', async () => {
    renderPage();

    expect((await screen.findAllByText('Robotics Society')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Organizations' })).toBeInTheDocument();
    expect(screen.getByText(/College of Engineering/)).toBeInTheDocument();
    const table = screen.getAllByRole('table')[0];
    ['Pending review', 'Returned', 'Archived'].forEach((label) => expect(within(table).getAllByText(label).length).toBeGreaterThan(0));
    expect(within(table).queryByText('Active')).not.toBeInTheDocument();
    expect(screen.getAllByText('Archived by the SAO. Read only.').length).toBeGreaterThan(0);
  });

  it('filters by lifecycle status with the tabs', async () => {
    renderPage();
    await screen.findAllByText('Robotics Society');

    expect(screen.getByRole('tab', { name: 'Returned (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Returned (1)' }));

    expect(screen.getAllByText('Drama Guild').length).toBeGreaterThan(0);
    expect(screen.queryByText('Robotics Society')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Active (1)' }));
    expect(screen.getAllByText('Robotics Society').length).toBeGreaterThan(0);
    expect(screen.queryByText('Drama Guild')).not.toBeInTheDocument();
  });

  it('shows an error with a retry and then the rows', async () => {
    mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('network'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect((await screen.findAllByText('Robotics Society')).length).toBeGreaterThan(0);
    expect(mocks.getCollegeOrganizations).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when the college has no organizations', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([]));
    renderPage();

    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
  });

  it('shows the checklist of a pending registration in a drawer', async () => {
    renderPage();
    await screen.findAllByText('Chess Club');

    await chooseOrganizationAction('Chess Club', 'View checklist');

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Waiting for the SAO to decide.')).toBeInTheDocument();
    expect(within(drawer).getAllByText('constitution.pdf').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText('Approved').length).toBeGreaterThan(0);
  });

  it('shows the SAO remarks of a returned registration beside the row', async () => {
    renderPage();

    expect((await screen.findAllByText(/The constitution is missing signatures\./)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('SAO remarks').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Drama Guild' })[0]);
    expect(await screen.findByRole('menuitem', { name: 'View checklist' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit and resubmit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('preselects the status tab from the status query parameter', async () => {
    renderPage('/dashboard/department-head/organizations?status=returned');
    await screen.findAllByText('Drama Guild');

    expect(screen.getByRole('tab', { name: 'Returned (1)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Robotics Society')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Returned organizations' })).toBeInTheDocument();
  });

  it('keeps the status filter in the URL and ignores an unknown status', async () => {
    renderPage('/dashboard/department-head/organizations?status=bogus');
    await screen.findAllByText('Robotics Society');
    expect(screen.getByRole('tab', { name: 'All (4)' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Pending review (1)' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?status=pending');
    fireEvent.click(screen.getByRole('tab', { name: 'All (4)' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('status');
  });

  it('labels archived rows as read only while keeping the Archived text', async () => {
    renderPage('/dashboard/department-head/organizations?status=archived');
    await screen.findAllByText('Old Band');

    const badge = screen.getAllByRole('group', { name: 'Archived, read only' })[0];
    expect(within(badge).getByText('Archived')).toBeInTheDocument();
  });

  it('keeps the checklist content visible while the drawer closes', async () => {
    renderPage();
    await screen.findAllByText('Chess Club');
    await chooseOrganizationAction('Chess Club', 'View checklist');
    const drawer = await screen.findByRole('dialog');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(within(drawer).getAllByText('constitution.pdf').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  describe('registration flow', () => {
    it('shows the full stepper and a waiting callout without a button for a pending registration', async () => {
      renderPage('/dashboard/department-head/organizations?record=2');
      const drawer = await screen.findByRole('dialog');

      const stepper = within(drawer).getByRole('list', { name: 'Registration progress for Chess Club' });
      expect(within(stepper).getByText('SAO approval').closest('li')).toHaveAttribute('aria-current', 'step');
      expect(within(drawer).getByText('Waiting for the SAO to decide.')).toBeInTheDocument();
      expect(within(drawer).queryByRole('button', { name: 'Edit and resubmit' })).not.toBeInTheDocument();
    });

  });

  describe('record parameter', () => {
    it('opens the detail drawer for ?record and keeps it alongside the status filter', async () => {
      renderPage('/dashboard/department-head/organizations?status=returned&record=2');
      const drawer = await screen.findByRole('dialog');

      expect(within(drawer).getByText('Chess Club')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent('status=returned');
    });

    it('writes ?record when a row opens its drawer and removes it on close', async () => {
      renderPage();
      await screen.findAllByText('Chess Club');

      await chooseOrganizationAction('Chess Club', 'View checklist');
      await screen.findByRole('dialog');
      expect(screen.getByTestId('location')).toHaveTextContent('?record=2');

      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('record='));
    });

    it('tells the head when the record is not in the college and drops the parameter', async () => {
      renderPage('/dashboard/department-head/organizations?record=999');

      expect(await screen.findByRole('alert')).toHaveTextContent('That organization is not in your college');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('record='));
    });
  });

  describe('first use', () => {
    it('shows the empty state with one way forward: allow a student to apply', async () => {
      mocks.getCollegeOrganizations.mockResolvedValue(paginator([]));
      renderPage();

      expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
      expect(screen.getByText(/Allow a student to apply\. Their application comes to you/)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Allow a student to apply' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Register an organization' })).not.toBeInTheDocument();
    });

    it('puts the one primary action in the header once the college has organizations', async () => {
      renderPage();
      await screen.findAllByText('Robotics Society');

      expect(screen.getAllByRole('button', { name: 'Allow a student to apply' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Register an organization' })).not.toBeInTheDocument();
    });

    it('opens the grant modal and finds the student by name, never by school ID', async () => {
      mocks.getCollegeOrganizations.mockResolvedValue(paginator([]));
      peopleMocks.searchPeople.mockResolvedValue([{ school_id: 20260042, name: 'Ana Cruz', email: 'ana.cruz@example.test', role: 'STUDENT', program: 'BSIT', year_level: '3', college: 'College of Engineering', organizations: [] }]);
      grantMocks.allowStudentToApply.mockResolvedValue({ data: { id: 1, state: 'open', student: { school_id: 20260042, name: 'Ana Cruz', email: 'ana.cruz@example.test' }, application: null } });
      renderPage();
      await screen.findByText('No organizations yet');
      fireEvent.click(screen.getByRole('button', { name: 'Allow a student to apply' }));

      const dialog = await screen.findByRole('dialog', { name: 'Allow a student to apply' });
      expect(within(dialog).queryByLabelText(/school id/i)).not.toBeInTheDocument();
      fireEvent.change(within(dialog).getByRole('combobox', { name: /Student/ }), { target: { value: 'ana' } });
      fireEvent.click(await within(dialog).findByRole('option', { name: /Ana Cruz/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Allow to apply' }));

      await waitFor(() => expect(grantMocks.allowStudentToApply).toHaveBeenCalledWith(20260042));
      expect(peopleMocks.searchPeople).toHaveBeenCalledWith(expect.objectContaining({ q: 'ana', scope: 'college', role: 'STUDENT' }));
      await waitFor(() => expect(grantMocks.getApplicantGrants).toHaveBeenCalledTimes(2));
    });

    it('lists the students allowed to apply and lets the dean take one back', async () => {
      grantMocks.getApplicantGrants.mockResolvedValue({ data: { data: [
        { id: 4, state: 'open', student: { school_id: 20260042, name: 'Ana Cruz', email: 'ana.cruz@example.test' }, application: null },
        { id: 5, state: 'used', student: { school_id: 20260043, name: 'Ben Reyes', email: 'ben.reyes@example.test' }, application: { id: 9, name: 'Chess Club', status: 'pending_dean' } },
      ] } });
      grantMocks.revokeApplicantGrant.mockResolvedValue({ data: { id: 4, state: 'revoked' } });
      renderPage();

      const list = (await screen.findByRole('heading', { name: 'Students allowed to apply' })).closest('section');
      expect(within(list).getByText('Ana Cruz')).toBeInTheDocument();
      expect(within(list).getByText('Chess Club: With the Department Head')).toBeInTheDocument();
      expect(within(list).getAllByRole('button', { name: /Take back/ })).toHaveLength(1);
      fireEvent.click(within(list).getByRole('button', { name: 'Take back permission from Ana Cruz' }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Take back this permission?' })).getByRole('button', { name: 'Take back' }));

      await waitFor(() => expect(grantMocks.revokeApplicantGrant).toHaveBeenCalledWith(4));
    });

    it('has one h1 from the shared header', async () => {
      renderPage();
      await screen.findAllByText('Robotics Society');

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
  });
});

describe('CollegeOrganizationsPage silent refresh while the tab stays open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCollegeOrganizations.mockResolvedValue(paginator(organizations));
    mocks.getCollegeOverview.mockResolvedValue({ data: { college: { id: 5, name: 'College of Engineering', code: 'COE', logo_url: null, color: '#0B8ED0' }, head: { name: 'Eduardo Ramos' } } });
  });

  it('shows an Admin the SAO just created without a loading state, and keeps the tab and the open checklist', async () => {
    renderPage('/dashboard/department-head/organizations?status=pending');
    await screen.findAllByText('Chess Club');
    await chooseOrganizationAction('Chess Club', 'View checklist');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No Admin or SBO Officer is assigned yet.')).toBeInTheDocument();

    let release;
    mocks.getCollegeOrganizations.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let refresh;
    act(() => { refresh = refetchHook.current(); });
    expect(screen.queryByRole('status', { name: 'Loading table' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Chess Club').length).toBeGreaterThan(0);

    await act(async () => {
      release(paginator([
        ...organizations.slice(0, 1),
        organization({ id: 2, name: 'Chess Club', acronym: 'CHESS', lifecycle_status: 'pending', registration_requirements: checklist(), leadership: [{ role: 'admin', name: 'Ana Reyes' }], role_counts: { admin: 1, sbo_officer: 0, student: 0 } }),
        ...organizations.slice(2),
      ]));
      await refresh;
    });

    expect(within(screen.getByRole('dialog')).getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading table' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('status=pending');
  });

  it('keeps the rows and shows no error when the silent refresh fails', async () => {
    renderPage();
    await screen.findAllByText('Robotics Society');

    mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await refetchHook.current(); });

    expect(screen.getAllByText('Robotics Society').length).toBeGreaterThan(0);
    expect(screen.queryByText('Could not load the organizations of your college.')).not.toBeInTheDocument();
  });
});
