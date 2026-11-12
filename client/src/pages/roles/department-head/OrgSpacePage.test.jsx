import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgSpacePage from './OrgSpacePage';
import { SUB_ACCOUNT_KEY } from '../../../utils/subAccountStore';

const mocks = vi.hoisted(() => ({ getOrganizationSpace: vi.fn(), openProtectedFile: vi.fn() }));

vi.mock('../../../services/orgSpaceService', () => ({ getOrganizationSpace: mocks.getOrganizationSpace }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));
vi.mock('../../../components/org/OrgAccessPanel', () => ({
  default: ({ organizationId, actorRole }) => <p data-testid="org-access">{`access panel ${organizationId} as ${actorRole}`}</p>,
}));

const space = {
  organization: { id: 12, name: 'Computing Society', acronym: 'CS', college: 'College of Computing', lifecycle_status: 'active' },
  lifecycle: { status: 'active', review_remarks: null, reviewed_at: '2026-08-01T00:00:00Z' },
  counts: { members: 2, officers: 1, upcoming_events: 1, pending_documents: 1 },
  members: [
    { profile_id: 1, school_id: 20240001, name: 'Ana Reyes', email: 'ana@school.edu', role: 'ADMIN', position_title: 'President' },
    { profile_id: 2, school_id: 20240002, name: 'Ben Cruz', email: 'ben@school.edu', role: 'STUDENT', position_title: null },
  ],
  events: {
    upcoming: [{ id: 1, title: 'Hack Night', status: 'approved', start_time: '2027-01-10T10:00:00Z', location: 'Lab 2' }],
    recent: [{ id: 2, title: 'Orientation', status: 'completed', start_time: '2026-08-10T10:00:00Z', location: null }],
  },
  finance: {
    approved_budget_count: 1, allocated: 1000, income: 200, spent: 300, remaining: 900,
    budgets: [{ id: 5, title: 'Hack Night budget', allocated: 1000, spent: 300, remaining: 900 }],
  },
  documents: [
    { id: 8, requirement_name: 'By-laws', status: 'submitted', submitted_at: '2026-08-02T00:00:00Z', file_name: 'by-laws.pdf', open_url: '/compliance/submissions/8/document' },
    { id: 9, requirement_name: 'Roster', status: 'submitted', submitted_at: null, file_name: null, open_url: null },
  ],
};

function Where() {
  return <output data-testid="where">{useLocation().pathname}{useLocation().search}</output>;
}

function renderPage(path = '/dashboard/department-head/org/12') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/department-head/org/:orgId" element={<OrgSpacePage />} />
        <Route path="/dashboard/department-head" element={<p>College home</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('OrgSpacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Dana', last_name: 'Cruz' }));
    mocks.getOrganizationSpace.mockResolvedValue({ data: space });
  });

  it('shows a loading state, then the overview with counts and the open space remembered for the sidebar', async () => {
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading organization' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Computing Society' })).toBeInTheDocument();
    expect(mocks.getOrganizationSpace).toHaveBeenCalledWith('12');
    expect(screen.getByText('Documents to review').closest('a')).toHaveTextContent('1');
    expect(screen.getByText('Hack Night')).toBeInTheDocument();
    expect(screen.getByText(/left across 1 approved budget/)).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(SUB_ACCOUNT_KEY))).toMatchObject({ id: 12, name: 'Computing Society' }));
  });

  it('tells the dean on the overview to name the organization head when an active organization has no Admin, with a Give access link to People and access', async () => {
    mocks.getOrganizationSpace.mockResolvedValue({ data: { ...space, counts: { ...space.counts, administrators: 0 } } });
    renderPage();

    expect(await screen.findByText('Name the organization head')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Give access' })).toHaveAttribute('href', '/dashboard/department-head/org/12?tab=people');
  });

  it('says nothing about an organization head once the organization has an Admin', async () => {
    mocks.getOrganizationSpace.mockResolvedValue({ data: { ...space, counts: { ...space.counts, administrators: 1 } } });
    renderPage();

    await screen.findByRole('heading', { name: 'Computing Society' });
    expect(screen.queryByText('Name the organization head')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Give access' })).not.toBeInTheDocument();
  });

  it('makes each overview figure a link to the tab it counts', async () => {
    renderPage();

    fireEvent.click((await screen.findByText('Members')).closest('a'));

    expect(await screen.findByTestId('org-access')).toBeInTheDocument();
  });

  it('mounts the access panel for the dean on the people tab', async () => {
    renderPage('/dashboard/department-head/org/12?tab=people');

    expect(await screen.findByTestId('org-access')).toHaveTextContent('access panel 12 as DEPARTMENT_HEAD');
  });

  it('shows upcoming and recent events', async () => {
    renderPage('/dashboard/department-head/org/12?tab=events');

    expect(await screen.findByText('Orientation')).toBeInTheDocument();
    expect(screen.getByText('Hack Night')).toBeInTheDocument();
  });

  it('shows the money with only approved budgets counted', async () => {
    renderPage('/dashboard/department-head/org/12?tab=finance');

    expect(await screen.findByRole('heading', { name: 'Approved budgets' })).toBeInTheDocument();
    expect(screen.getAllByText('Hack Night budget').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₱900.00').length).toBeGreaterThan(0);
  });

  it('opens a submitted file through the protected route and links to records', async () => {
    renderPage('/dashboard/department-head/org/12?tab=documents');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Open By-laws' }))[0]);

    expect(mocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/8/document');
    expect(screen.queryAllByRole('button', { name: 'Open Roster' })).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Open records' })).toHaveAttribute('href', '/dashboard/records');
  });

  it('moves between tabs and keeps the choice in the address', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Computing Society' });

    fireEvent.click(screen.getByRole('tab', { name: 'People and access' }));

    expect(screen.getByTestId('where')).toHaveTextContent('?tab=people');
    expect(screen.getByRole('tab', { name: 'People and access' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says plainly when the organization is not in the college and offers the way back, not a retry that cannot work', async () => {
    mocks.getOrganizationSpace.mockRejectedValueOnce({ response: { status: 403 } });
    renderPage('/dashboard/department-head/org/99');

    expect(await screen.findByText('This organization is not in your college.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to organizations' })).toHaveAttribute('href', '/dashboard/department-head/organizations');
  });

  it('still offers a retry when the organization could not be loaded for another reason', async () => {
    mocks.getOrganizationSpace.mockRejectedValueOnce({ response: { status: 500 } });
    renderPage('/dashboard/department-head/org/12');

    const retry = await screen.findByRole('button', { name: 'Try again' });
    mocks.getOrganizationSpace.mockResolvedValueOnce({ data: space });
    fireEvent.click(retry);

    expect(await screen.findByRole('heading', { name: 'Computing Society' })).toBeInTheDocument();
  });

  it('shows empty states when there is nothing yet', async () => {
    mocks.getOrganizationSpace.mockResolvedValue({ data: { ...space, members: [], documents: [], finance: { ...space.finance, budgets: [], approved_budget_count: 0 } } });
    renderPage('/dashboard/department-head/org/12?tab=documents');

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Finance' }));
    expect(screen.getByText('No approved budget yet')).toBeInTheDocument();
  });

  it('leaves going back to the college to the sidebar and the Viewing strip', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Computing Society' });

    expect(screen.queryByRole('button', { name: /back to (my college|mine)/i })).not.toBeInTheDocument();
  });

  it('offers the same sections as a select on a phone, where the tab row does not fit', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Computing Society' });

    const section = screen.getByRole('combobox', { name: 'Section' });
    fireEvent.change(section, { target: { value: 'transactions' } });

    expect(screen.getByTestId('where')).toHaveTextContent('?tab=transactions');
  });
});
