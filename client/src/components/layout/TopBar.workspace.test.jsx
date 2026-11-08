import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar';
import { PERIOD_KEY } from '../../utils/academicPeriodStore';
import { SUB_ACCOUNT_KEY } from '../../utils/subAccountStore';

const mocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  getAccountProfiles: vi.fn(),
  switchAccountProfile: vi.fn(),
  getActiveAcademicPeriod: vi.fn(),
  getAcademicPeriods: vi.fn(),
  getCollegeOrganizations: vi.fn(),
}));

vi.mock('../../services/notificationService', () => ({ getNotifications: mocks.getNotifications, markRead: vi.fn(), markAllRead: vi.fn() }));
vi.mock('../../services/authService', () => ({ logout: vi.fn(), getAccountProfiles: mocks.getAccountProfiles, switchAccountProfile: mocks.switchAccountProfile }));
vi.mock('../../services/systemAdministrationService', () => ({ getActiveAcademicPeriod: mocks.getActiveAcademicPeriod, getAcademicPeriods: mocks.getAcademicPeriods }));
vi.mock('../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: mocks.getCollegeOrganizations }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const renderTopBar = (path = '/dashboard/student') => render(<MemoryRouter initialEntries={[path]}><TopBar onMenuToggle={() => {}} /><Where /></MemoryRouter>);

const profile = (id, role, name, extra = {}) => ({ id, role, account_status: 'active', organization: { id: id * 10, name, is_active: true, organization_type: role === 'STUDENT' ? 'COLLEGE' : 'STUDENT_ORGANIZATION' }, ...extra });

const live = { id: 3, number: 1, status: 'active', academic_year: { label: '2026-2027' } };
const upcoming = { id: 4, number: 2, status: 'upcoming', academic_year: { label: '2026-2027' } };
const closed = { id: 2, number: 2, status: 'completed', academic_year: { label: '2025-2026' } };

describe('TopBar workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mocks.getNotifications.mockResolvedValue({ data: { data: [], unread_count: 0 } });
    mocks.getActiveAcademicPeriod.mockResolvedValue(live);
    mocks.getAcademicPeriods.mockResolvedValue([closed, live, upcoming]);
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: [] } });
  });

  it('gives an officer one switcher between My account and their organization', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Olive', last_name: 'Officer' }));
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [profile(1, 'STUDENT', 'College of Computing'), profile(2, 'SBO_OFFICER', 'Computing Society')] } });
    renderTopBar();

    fireEvent.click(await screen.findByRole('button', { name: 'Workspace: My account' }));
    const panel = screen.getByRole('region', { name: 'Workspaces' });

    expect(within(panel).getByRole('button', { name: /Computing Society/ })).toBeEnabled();
  });

  it('shows no switcher to a student with one profile', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Sam', last_name: 'Student' }));
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [profile(1, 'STUDENT', 'College of Computing')] } });
    renderTopBar();

    await waitFor(() => expect(mocks.getAccountProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Workspace:/ })).not.toBeInTheDocument();
  });

  it('gives a dean the college and every active organization, and opens one as its own space', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Dana', last_name: 'Cruz' }));
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [] } });
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: [{ id: 11, name: 'Computing Society', acronym: 'CS', members_count: 40 }, { id: 12, name: 'Arts Guild', acronym: 'AG', members_count: 12 }] } });
    renderTopBar('/dashboard/department-head');

    fireEvent.click(await screen.findByRole('button', { name: 'Workspace: My college' }));
    expect(mocks.getCollegeOrganizations).toHaveBeenCalledWith({ per_page: 100, lifecycle_status: 'active' });
    fireEvent.click(screen.getByRole('button', { name: /Arts Guild/ }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/department-head/org/12');
    expect(JSON.parse(sessionStorage.getItem(SUB_ACCOUNT_KEY)).id).toBe(12);
    expect(await screen.findByRole('button', { name: 'Workspace: Arts Guild' })).toBeInTheDocument();
  });

  it('shows no switcher to a dean whose college has no organizations yet', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Dana', last_name: 'Cruz' }));
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [] } });
    renderTopBar('/dashboard/department-head');

    await waitFor(() => expect(mocks.getCollegeOrganizations).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Workspace:/ })).not.toBeInTheDocument();
  });
});

describe('TopBar school year picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Ana', last_name: 'Head' }));
    mocks.getNotifications.mockResolvedValue({ data: { data: [], unread_count: 0 } });
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [] } });
    mocks.getActiveAcademicPeriod.mockResolvedValue(live);
    mocks.getAcademicPeriods.mockResolvedValue([closed, live, upcoming]);
    mocks.getCollegeOrganizations.mockResolvedValue({ data: { data: [] } });
  });

  async function openPicker() {
    fireEvent.click(await screen.findByRole('button', { name: /Academic Period: AY 2026-2027 · 1st Semester/ }));
    return screen.getByRole('listbox', { name: 'Academic Periods' });
  }

  it('saves an upcoming semester to localStorage so planning survives a reload', async () => {
    renderTopBar('/dashboard/admin');
    const list = await openPicker();

    fireEvent.click(within(list).getByRole('button', { name: /AY 2026-2027 · 2nd Semester/ }));

    expect(JSON.parse(localStorage.getItem(PERIOD_KEY)).id).toBe(4);
    expect(sessionStorage.getItem(PERIOD_KEY)).toBeNull();
    expect(await screen.findByText('Planning')).toBeInTheDocument();
  });

  it('forgets the choice when the current semester is picked again', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify(upcoming));
    renderTopBar('/dashboard/admin');
    fireEvent.click(await screen.findByRole('button', { name: /Academic Period: AY 2026-2027 · 2nd Semester/ }));

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Academic Periods' })).getByRole('button', { name: /AY 2026-2027 · 1st Semester/ }));

    expect(localStorage.getItem(PERIOD_KEY)).toBeNull();
  });

  it('sends a closed semester to Records instead of switching to it', async () => {
    renderTopBar('/dashboard/admin');
    const list = await openPicker();

    fireEvent.click(within(list).getByRole('button', { name: /AY 2025-2026 · 2nd Semester/ }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/records');
    expect(localStorage.getItem(PERIOD_KEY)).toBeNull();
  });

  it('offers an Open records link to the roles that have the page', async () => {
    renderTopBar('/dashboard/admin');
    const list = await openPicker();

    fireEvent.click(within(list).getByRole('button', { name: 'Open records' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/records');
  });

  it('gives a student no Records link', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Sam', last_name: 'Student' }));
    renderTopBar('/dashboard/student');
    const list = await openPicker();

    expect(within(list).queryByRole('button', { name: 'Open records' })).not.toBeInTheDocument();
  });

  it('drops a saved choice that is gone or closed so the API never gets a stale period', async () => {
    localStorage.setItem(PERIOD_KEY, JSON.stringify({ ...closed }));
    renderTopBar('/dashboard/admin');

    await waitFor(() => expect(localStorage.getItem(PERIOD_KEY)).toBeNull());
  });

  it('moves a period chosen under the old sessionStorage key', async () => {
    sessionStorage.setItem(PERIOD_KEY, JSON.stringify(upcoming));
    renderTopBar('/dashboard/admin');

    expect(await screen.findByRole('button', { name: /Academic Period: AY 2026-2027 · 2nd Semester/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(PERIOD_KEY)).id).toBe(4);
    expect(sessionStorage.getItem(PERIOD_KEY)).toBeNull();
  });
});
