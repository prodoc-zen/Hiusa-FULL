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

  it('opens the financial tab of the compliance home from the report actions', async () => {
    render(<MemoryRouter><SuperAdminHomePage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: /4 financial report\(s\) need SAO review/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=financial');
    expect(screen.getByRole('link', { name: /Review received reports/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=financial');
  });
});
