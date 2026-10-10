import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdminHomePage from './SuperAdminHomePage';

const mocks = vi.hoisted(() => ({ getSystemOrganizations: vi.fn(), getSystemOverview: vi.fn() }));

vi.mock('../../../services/systemAdministrationService', () => mocks);
vi.mock('../../../components/dashboard', () => ({ RoleBriefing: () => <div>Role briefing</div> }));

describe('SuperAdminHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemOrganizations.mockResolvedValue({ data: [] });
    mocks.getSystemOverview.mockResolvedValue({
      organizations: { total: 3, active: 2, inactive: 1 },
      operations: { pending_approvals: 4 },
      notifications: { unread: 0, recent: [] },
    });
  });

  it('counts organizations and reports in plain words, with one SAO name and no SBO jargon', async () => {
    render(<MemoryRouter><SuperAdminHomePage /></MemoryRouter>);

    expect(await screen.findByText('Registered organizations')).toBeInTheDocument();
    expect(screen.getByText('Financial reports to review').closest('div')).toHaveTextContent('4');
    expect(screen.queryByText(/SBOs/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pending SAO Approvals')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'SAO actions' })).toBeInTheDocument();
    expect(screen.queryByText(/Super Admin/)).not.toBeInTheDocument();
  });

  it('leaves the review counts to the inbox instead of repeating one queue in a banner', async () => {
    render(<MemoryRouter><SuperAdminHomePage /></MemoryRouter>);

    await screen.findByText('Registered organizations');
    expect(screen.queryByRole('link', { name: /need SAO review/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrations and organizations' })).toHaveAttribute('href', '/dashboard/super-admin/organizations');
    expect(screen.getByRole('link', { name: 'Colleges and Department Heads' })).toHaveAttribute('href', '/dashboard/super-admin/colleges');
  });

  it('names the first action when no organization is registered yet', async () => {
    mocks.getSystemOverview.mockResolvedValue({ organizations: { total: 0, active: 0, inactive: 0 }, operations: { pending_approvals: 0 }, notifications: { unread: 0, recent: [] } });
    render(<MemoryRouter><SuperAdminHomePage /></MemoryRouter>);

    expect(await screen.findByText('No student organizations registered yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open colleges' })).toHaveAttribute('href', '/dashboard/super-admin/colleges');
    expect(screen.queryByText('Registered organizations')).not.toBeInTheDocument();
  });
});
