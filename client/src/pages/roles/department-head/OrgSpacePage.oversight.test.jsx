import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgSpacePage from './OrgSpacePage';
import { SUB_ACCOUNT_KEY } from '../../../utils/subAccountStore';

const mocks = vi.hoisted(() => ({ getOrganizationSpace: vi.fn(), getOrganizationTransactions: vi.fn() }));

vi.mock('../../../services/orgSpaceService', () => ({
  getOrganizationSpace: mocks.getOrganizationSpace,
  getOrganizationTransactions: mocks.getOrganizationTransactions,
}));
vi.mock('../../../components/org/OrgAccessPanel', () => ({
  default: () => <p data-testid="org-access">access panel</p>,
}));

const space = {
  organization: { id: 12, name: 'Computing Society', acronym: 'CS', college: 'College of Computing', lifecycle_status: 'active' },
  lifecycle: { status: 'active', review_remarks: null, reviewed_at: null },
  counts: { members: 2, officers: 1, upcoming_events: 0, pending_documents: 0 },
  members: [
    { profile_id: 1, school_id: 20240001, name: 'Ana Reyes', email: 'ana@school.edu', role: 'ADMIN', position_title: 'President' },
    { profile_id: 2, school_id: 20240002, name: 'Ben Cruz', email: 'ben@school.edu', role: 'STUDENT', position_title: null },
  ],
  events: { upcoming: [], recent: [] },
  finance: { approved_budget_count: 0, allocated: 0, income: 0, spent: 0, remaining: 0, budgets: [] },
  documents: [],
};

function renderPage(path = '/dashboard/super-admin/org/12') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/super-admin/org/:orgId" element={<OrgSpacePage oversight />} />
        <Route path="/dashboard/super-admin/colleges" element={<p>Colleges</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrgSpacePage as SAO oversight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.getOrganizationSpace.mockResolvedValue({ data: space });
    mocks.getOrganizationTransactions.mockResolvedValue({ data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 15, total: 0 }, summary: { income: 0, expense: 0 } } });
  });

  it('opens the organization without entering a Department Head workspace', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Computing Society' })).toBeInTheDocument();
    expect(mocks.getOrganizationSpace).toHaveBeenCalledWith('12');
    expect(sessionStorage.getItem(SUB_ACCOUNT_KEY)).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to colleges' })).toHaveAttribute('href', '/dashboard/super-admin/colleges');
    expect(screen.getByRole('link', { name: 'Registration details' })).toHaveAttribute('href', '/dashboard/super-admin/organizations/12');
  });

  it('lists people read only, never the access panel that gives or removes access', async () => {
    renderPage('/dashboard/super-admin/org/12?tab=people');

    const table = await screen.findByRole('table', { name: 'Organization members' });
    expect(within(table).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(table).getByText('President')).toBeInTheDocument();
    expect(within(table).getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByTestId('org-access')).not.toBeInTheDocument();
  });

  it('has a transactions tab that loads the ledger of this organization', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Computing Society' });

    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(mocks.getOrganizationTransactions).toHaveBeenCalledWith(12, { page: 1 });
  });

  it('explains a 403 as a non-student organization', async () => {
    mocks.getOrganizationSpace.mockRejectedValueOnce({ response: { status: 403 } });
    renderPage('/dashboard/super-admin/org/99');

    expect(await screen.findByText('This is not a student organization.')).toBeInTheDocument();
  });
});
