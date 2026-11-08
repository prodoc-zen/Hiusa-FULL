import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

const mocks = vi.hoisted(() => ({ getMyOrganizationApplications: vi.fn() }));
vi.mock('../../services/authService', () => ({ logout: vi.fn() }));
vi.mock('../../services/organizationApplicationService', () => mocks);

function renderSidebar(role, path = '/dashboard/student') {
  localStorage.setItem('user', JSON.stringify({ role, first_name: 'Ana', last_name: 'Cruz' }));
  return render(<MemoryRouter initialEntries={[path]}><Sidebar isOpen={false} onClose={() => {}} desktopCollapsed={false} onToggleDesktop={() => {}} /></MemoryRouter>);
}

describe('Apply for an organization in the student sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  afterEach(() => localStorage.clear());

  it('appears after Ask AI while the Department Head’s permission is unused', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue({ data: { can_apply: true, applications: [] } });
    renderSidebar('STUDENT');

    const link = await screen.findByRole('link', { name: 'Apply for an organization' });
    expect(link).toHaveAttribute('href', '/dashboard/student/apply-organization');
    const names = screen.getAllByRole('link').map((item) => item.textContent);
    expect(names.indexOf('Apply for an organization')).toBe(names.indexOf('Ask AI') + 1);
  });

  it('stays for a student who already applied, so they can follow it', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue({ data: { can_apply: false, applications: [{ id: 3, status: 'pending_dean' }] } });
    renderSidebar('STUDENT');

    expect(await screen.findByRole('link', { name: 'Apply for an organization' })).toBeInTheDocument();
  });

  it('is highlighted on the page of one of their applications', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue({ data: { can_apply: false, applications: [{ id: 3, status: 'returned' }] } });
    renderSidebar('STUDENT', '/dashboard/student/organization-applications/3');

    expect(await screen.findByRole('link', { name: 'Apply for an organization' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not appear for a student with no permission and no application', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue({ data: { can_apply: false, applications: [] } });
    renderSidebar('STUDENT');

    await waitFor(() => expect(mocks.getMyOrganizationApplications).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Apply for an organization' })).not.toBeInTheDocument();
  });

  it('stays hidden, without breaking the menu, when the check fails', async () => {
    mocks.getMyOrganizationApplications.mockRejectedValue({ response: { status: 500 } });
    renderSidebar('STUDENT');

    await waitFor(() => expect(mocks.getMyOrganizationApplications).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Ask AI' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Apply for an organization' })).not.toBeInTheDocument();
  });

  it('is never asked for by roles other than the student', async () => {
    renderSidebar('ADMIN', '/dashboard/admin');

    expect(screen.queryByRole('link', { name: 'Apply for an organization' })).not.toBeInTheDocument();
    expect(mocks.getMyOrganizationApplications).not.toHaveBeenCalled();
  });
});
