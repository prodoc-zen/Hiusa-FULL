import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar';

const notificationMocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  getAccountProfiles: vi.fn(),
  switchAccountProfile: vi.fn(),
}));
const periodMocks = vi.hoisted(() => ({
  getActiveAcademicPeriod: vi.fn(),
}));

vi.mock('../../services/notificationService', () => notificationMocks);
vi.mock('../../services/authService', () => authMocks);
vi.mock('../../services/systemAdministrationService', () => periodMocks);

describe('TopBar notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    periodMocks.getActiveAcademicPeriod.mockResolvedValue({ number: 2, academic_year: { label: '2026-2027' } });
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', first_name: 'Test', last_name: 'User' }));
    notificationMocks.getNotifications.mockResolvedValue({ data: { data: [], unread_count: 0 } });
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [{ id: 1, role: 'STUDENT', account_status: 'active', organization: { id: 1, name: 'Main Campus', acronym: 'MC', is_active: true } }] } });
  });

  it('loads once and does not refetch whenever the window regains focus', async () => {
    render(
      <MemoryRouter>
        <TopBar onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(notificationMocks.getNotifications).toHaveBeenCalledOnce());

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(notificationMocks.getNotifications).toHaveBeenCalledOnce();
  });

  it('marks every notification as read from the notification panel', async () => {
    notificationMocks.getNotifications.mockResolvedValue({ data: { data: [
      { id: 1, title: 'Budget review', message: 'Approved', is_read: false },
      { id: 2, title: 'Event review', message: 'Pending', is_read: false },
    ], unread_count: 2 } });
    notificationMocks.markAllRead.mockResolvedValue({});
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);

    await waitFor(() => expect(notificationMocks.getNotifications).toHaveBeenCalledOnce());
    expect(await screen.findByText('AY 2026-2027 · 2nd Semester')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(notificationMocks.markAllRead).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();
  });

  it('keeps the admin home header compact above the dashboard briefing', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Alex', last_name: 'Rivera' }));
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(header).queryByText(/welcome back, alex/i)).not.toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Cart' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Account menu for Alex Rivera' })).toBeInTheDocument();
  });

  it('gives a Department Head no merchandise cart', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Dana', last_name: 'Cruz' }));
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('button', { name: 'Cart' })).not.toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('keeps the dashboard visible when the active period has no academic year', async () => {
    periodMocks.getActiveAcademicPeriod.mockResolvedValue({ number: 2 });
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);

    await waitFor(() => expect(periodMocks.getActiveAcademicPeriod).toHaveBeenCalledOnce());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByText(/Semester/)).not.toBeInTheDocument();
  });

  it('publishes the navbar bottom for portaled overlays and clears it on unmount', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 92 });
    const view = render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);

    expect(document.documentElement.style.getPropertyValue('--dashboard-navbar-bottom')).toBe('92px');
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--dashboard-navbar-bottom')).toBe('');
    bounds.mockRestore();
  });

  it('opens the page search from the header control', () => {
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page' }));
    expect(screen.getByRole('dialog', { name: 'Go to page' })).toHaveClass('fixed', 'inset-0');
    expect(screen.getByRole('combobox', { name: 'Search pages' })).toBeInTheDocument();
  });

  it.each([
    ['ADMIN', '/dashboard/admin/users'],
    ['ADMIN', '/dashboard/approvals'],
    ['DEPARTMENT_HEAD', '/dashboard/department-head/approvals'],
    ['SUPER_ADMIN', '/dashboard/super-admin/agency'],
    ['SUPER_ADMIN', '/dashboard/super-admin/organizations/7'],
    ['SBO_OFFICER', '/dashboard/officer'],
    ['STUDENT', '/dashboard/student'],
  ])('keeps one white header of chrome only, with no title, subtitle or breadcrumb, for %s on %s', (role, path) => {
    localStorage.setItem('user', JSON.stringify({ role, first_name: 'Test', last_name: 'User' }));
    render(<MemoryRouter initialEntries={[path]}><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('bg-white', 'border-[#DDE7EF]');
    expect(within(header).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(header).queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
    expect(within(header).queryByText(/Review approval requests|Search the organization directory|Review the agency|Start with deadlines/)).not.toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Account menu for Test User' })).toBeInTheDocument();
  });

  it('names the SAO as SAO in the account chip', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN', first_name: 'Sao', last_name: 'Director' }));
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Account menu for Sao Director' });
    expect(trigger).toHaveTextContent('SAO');
    expect(trigger).not.toHaveTextContent(/Super Admin/);
  });

  it('anchors the cart panel to the mobile viewport', async () => {
    localStorage.setItem('hiusa_student_cart', JSON.stringify([{ item: { id: 1, name: 'HIUSA Shirt', price: 250 }, quantity: 1 }]));

    render(
      <MemoryRouter>
        <TopBar onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cart' }));

    const panel = await screen.findByRole('region', { name: 'Cart summary' });
    expect(panel).toHaveClass('fixed', 'left-3', 'right-3', 'sm:absolute');
    expect(screen.getByRole('button', { name: 'Cart' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('anchors the notifications panel to the mobile viewport', async () => {
    render(
      <MemoryRouter>
        <TopBar onMenuToggle={() => {}} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    const panel = await screen.findByRole('region', { name: 'Notifications panel' });
    expect(panel).toHaveClass('fixed', 'left-3', 'right-3', 'sm:absolute');
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the current profile and makes the switch menu usable on mobile', async () => {
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [
      { id: 1, role: 'STUDENT', account_status: 'active', organization: { id: 1, name: 'Main Campus', acronym: 'MC', is_active: true } },
      { id: 2, role: 'SBO_OFFICER', account_status: 'active', organization: { id: 2, name: 'Student Council', acronym: 'SC', is_active: true } },
    ] } });

    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Account menu for Test User' });
    fireEvent.click(trigger);

    const panel = await screen.findByRole('region', { name: 'Account and profiles' });
    expect(panel).toHaveClass('fixed', 'left-3', 'right-3', 'sm:absolute');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: /Student Council/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Main Campus/ })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('calls the profile switch API and reports a failed switch', async () => {
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [
      { id: 1, role: 'STUDENT', account_status: 'active', organization: { id: 1, name: 'Main Campus', is_active: true } },
      { id: 2, role: 'SBO_OFFICER', account_status: 'active', organization: { id: 2, name: 'Student Council', is_active: true } },
    ] } });
    authMocks.switchAccountProfile.mockRejectedValue(new Error('Network failure'));
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Test User' }));
    fireEvent.click(await screen.findByRole('button', { name: /Student Council/ }));

    await waitFor(() => expect(authMocks.switchAccountProfile).toHaveBeenCalledWith(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch organization. Try again.');
  });

  it('explains when there is only one profile and can retry a failed load', async () => {
    authMocks.getAccountProfiles.mockRejectedValueOnce(new Error('Network failure'));
    render(<MemoryRouter><TopBar onMenuToggle={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Test User' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your profiles.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/This is your only active profile/)).toBeInTheDocument();
  });
});
