import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoNotificationsPage from './SaoNotificationsPage';
import GlobalAnnouncementsPage from './GlobalAnnouncementsPage';
import AcademicYearsPage from './AcademicYearsPage';
import GeneralAuditLogPage from '../admin/GeneralAuditLogPage';
import StudyObjectivesPage from '../../modules/objectives/StudyObjectivesPage';

const mocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  getGlobalAnnouncements: vi.fn(),
  getAcademicYears: vi.fn(),
  getAuditLogs: vi.fn(),
  getObjectivesOverview: vi.fn(),
}));

vi.mock('../../../services/notificationService', () => ({
  getNotifications: mocks.getNotifications,
  markAllRead: mocks.markAllRead,
  markRead: mocks.markRead,
}));
vi.mock('../../../services/systemAdministrationService', () => ({
  getGlobalAnnouncements: mocks.getGlobalAnnouncements,
  getSystemOrganizations: vi.fn(() => Promise.resolve({ data: [] })),
  createGlobalAnnouncement: vi.fn(),
  updateGlobalAnnouncement: vi.fn(),
  archiveGlobalAnnouncement: vi.fn(),
  deleteGlobalAnnouncement: vi.fn(),
  getAcademicYears: mocks.getAcademicYears,
  createAcademicYear: vi.fn(),
  updateAcademicYear: vi.fn(),
  makeAcademicYearCurrent: vi.fn(),
  closeAcademicYear: vi.fn(),
  createAcademicSemester: vi.fn(),
  activateAcademicSemester: vi.fn(),
  closeAcademicSemester: vi.fn(),
  deleteAcademicYear: vi.fn(),
  deleteAcademicSemester: vi.fn(),
}));
vi.mock('../../../services/financeService', () => ({ getAuditLogs: mocks.getAuditLogs, exportAuditLogs: vi.fn() }));
vi.mock('../../../services/objectivesService', () => ({ getObjectivesOverview: mocks.getObjectivesOverview }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function renderAt(entry, element) {
  return render(<MemoryRouter initialEntries={[entry]}>{element}</MemoryRouter>);
}

const NOTIFICATION = { id: 1, title: 'Registration submitted', message: 'Computing Society', is_read: false, created_at: '2026-10-01T08:00:00Z', notification_type: 'system' };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
  mocks.getNotifications.mockResolvedValue({ data: { data: [NOTIFICATION] } });
  mocks.getGlobalAnnouncements.mockResolvedValue({ data: [] });
  mocks.getAcademicYears.mockResolvedValue([]);
  mocks.getAuditLogs.mockResolvedValue({ data: { data: [], total: 0, per_page: 10, current_page: 1 } });
  mocks.getObjectivesOverview.mockResolvedValue({ data: { scope: { type: 'university' }, objectives: [] } });
});

describe('SaoNotificationsPage header', () => {
  it('has one h1, the pageMeta purpose line and Mark all as read as the single primary action', async () => {
    renderAt('/dashboard/super-admin/notifications', <SaoNotificationsPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Notifications');
    expect(screen.getByText('SAO approval activity and system notices.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Mark all as read' })).toBeEnabled();
  });

  it('says what lands here when there are no notifications', async () => {
    mocks.getNotifications.mockResolvedValue({ data: { data: [] } });
    renderAt('/dashboard/super-admin/notifications', <SaoNotificationsPage />);
    expect(await screen.findByText('No SAO notifications yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });
});

describe('GlobalAnnouncementsPage header', () => {
  it('shows a first-run state with the single Create official notice button', async () => {
    renderAt('/dashboard/super-admin/announcements', <GlobalAnnouncementsPage />);
    expect(await screen.findByText('No official announcements yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create official notice' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('moves the button into the header once a notice exists', async () => {
    mocks.getGlobalAnnouncements.mockResolvedValue({ data: [{ id: 5, title: 'Enrollment reminder', body: 'Soon', published_at: null, is_published: false, target_scope: 'all_users', recipients_count: 0 }] });
    renderAt('/dashboard/super-admin/announcements', <GlobalAnnouncementsPage />);
    expect(await screen.findByText(/enrollment reminder/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create official notice' })).toHaveLength(1);
    expect(screen.queryByText('No official announcements yet')).not.toBeInTheDocument();
  });
});

describe('AcademicYearsPage header', () => {
  it('has one h1 and a single Add academic year button in the first-run state', async () => {
    renderAt('/dashboard/super-admin/academic-years', <AcademicYearsPage />);
    expect(await screen.findByText('No academic year set')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add academic year' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('moves Add academic year into the header once a year exists', async () => {
    mocks.getAcademicYears.mockResolvedValue([{ id: 1, label: '2026-2027', starts_on: '2026-08-01', ends_on: '2027-05-31', is_current: true, semesters: [] }]);
    renderAt('/dashboard/super-admin/academic-years', <AcademicYearsPage />);
    expect((await screen.findAllByText('2026-2027')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add academic year' })).toHaveLength(1);
  });
});

describe('GeneralAuditLogPage header', () => {
  it('has one h1 and explains what is recorded when the log is empty', async () => {
    renderAt('/dashboard/super-admin/audit-logs', <GeneralAuditLogPage />);
    expect(await screen.findByText('No audit activity yet')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Audit trail');
  });

  it('offers to clear filters when a filter leaves nothing', async () => {
    renderAt('/dashboard/super-admin/audit-logs', <GeneralAuditLogPage />);
    await screen.findByText('No audit activity yet');
    fireEvent.change(screen.getByPlaceholderText('Search actor, action, module, or record ID'), { target: { value: 'budget' } });
    expect(await screen.findByText('No audit activity matches these filters')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1));
    await waitFor(() => expect(screen.getByText('No audit activity yet')).toBeInTheDocument());
  });
});

describe('StudyObjectivesPage header', () => {
  it('takes its title and purpose from the page meta, under one h1', async () => {
    renderAt('/dashboard/objectives', <StudyObjectivesPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Study objectives');
    expect(screen.getByText(/See each objective the study set out to prove/)).toBeInTheDocument();
    expect(await screen.findByText('No objectives are configured yet')).toBeInTheDocument();
  });
});
