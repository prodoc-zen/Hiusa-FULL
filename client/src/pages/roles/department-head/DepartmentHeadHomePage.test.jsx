import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentHeadHomePage from './DepartmentHeadHomePage';

const mocks = vi.hoisted(() => ({
  getElections: vi.fn(),
  getEvents: vi.fn(),
  getAnnouncements: vi.fn(),
  getApprovalRequests: vi.fn(),
  getCollegeOrganizations: vi.fn(),
}));
vi.mock('../../../services/electionService', () => ({ getElections: mocks.getElections }));
vi.mock('../../../services/eventService', () => ({ getEvents: mocks.getEvents }));
vi.mock('../../../services/announcementService', () => ({ getAnnouncements: mocks.getAnnouncements }));
vi.mock('../../../services/approvalService', () => ({ getApprovalRequests: mocks.getApprovalRequests }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: mocks.getCollegeOrganizations }));
vi.mock('../../../components/dashboard', () => ({ RoleBriefing: () => null }));
const refetchHook = vi.hoisted(() => ({ current: null }));
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: (refetch) => { refetchHook.current = refetch; } }));

const paginator = (data) => ({ data: { data, current_page: 1, last_page: 1, per_page: 100, total: data.length } });
const org = (id, lifecycle_status) => ({ id, name: `Org ${id}`, college: 'College of Engineering', lifecycle_status });

function renderPage() {
  return render(<MemoryRouter><DepartmentHeadHomePage /></MemoryRouter>);
}

describe('DepartmentHeadHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Eduardo', last_name: 'Ramos', organization: { id: 9, name: 'College of Engineering', college: 'College of Engineering', college_id: 5, organization_type: 'COLLEGE' } }));
    mocks.getElections.mockResolvedValue([]);
    mocks.getEvents.mockResolvedValue(paginator([]));
    mocks.getAnnouncements.mockResolvedValue({ data: [] });
    mocks.getApprovalRequests.mockResolvedValue(paginator([]));
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([org(1, 'active'), org(2, 'active'), org(3, 'pending'), org(4, 'returned')]));
  });

  it('summarises the college organizations by status and links to the organizations page', async () => {
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    const section = heading.closest('section');
    const tiles = within(section).getAllByRole('link').filter((link) => link.getAttribute('href').includes('?status='));
    expect(tiles.map((tile) => tile.textContent)).toEqual(['ReturnedAction needed1', 'Pending review1', 'Active2', 'Archived0']);
    expect(tiles.map((tile) => tile.getAttribute('href'))).toEqual([
      '/dashboard/department-head/organizations?status=returned',
      '/dashboard/department-head/organizations?status=pending',
      '/dashboard/department-head/organizations?status=active',
      '/dashboard/department-head/organizations?status=archived',
    ]);
    expect(tiles[0]).toHaveClass('bg-danger-tint');
    expect(tiles[1]).not.toHaveClass('bg-danger-tint');
    expect(within(section).getByRole('link', { name: 'Manage organizations' })).toHaveAttribute('href', '/dashboard/department-head/organizations');
  });

  it('lets the dashboard columns shrink to a phone width, with the empty election card inside them', async () => {
    renderPage();

    const empty = (await screen.findByText('No Active Election')).closest('section');
    expect(empty.parentElement).toHaveClass('min-w-0');
    expect(empty.parentElement.parentElement).toHaveClass('grid-cols-1');
  });

  it('does not highlight Returned when nothing is returned', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([org(1, 'active')]));
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    const returned = within(heading.closest('section')).getByRole('link', { name: /^Returned/ });
    expect(returned).not.toHaveClass('bg-danger-tint');
    expect(within(returned).queryByText('Action needed')).not.toBeInTheDocument();
  });

  it('puts the college organizations before the oversight snapshot', async () => {
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    const snapshot = await screen.findByText('Oversight snapshot');
    expect(heading.compareDocumentPosition(snapshot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the first action when the college has no organization yet', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([]));
    renderPage();

    expect(await screen.findByText('No student organizations yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review applications' })).toHaveAttribute('href', '/dashboard/organization-applications');
    expect(screen.queryByRole('link', { name: 'Register an organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Returned/ })).not.toBeInTheDocument();
  });

  it('does not call a failed load an empty college', async () => {
    mocks.getCollegeOrganizations.mockRejectedValue(new Error('network'));
    renderPage();

    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText('No student organizations yet')).not.toBeInTheDocument();
  });

  it('keeps the existing oversight snapshot', async () => {
    renderPage();

    expect(await screen.findByText('Oversight snapshot')).toBeInTheDocument();
    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
  });

  it('shows an error with a retry when the data cannot load', async () => {
    mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('network'));
    renderPage();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.click();

    expect(await screen.findByRole('heading', { name: 'College of Engineering organizations' })).toBeInTheDocument();
    expect(mocks.getCollegeOrganizations).toHaveBeenCalledTimes(2);
  });

  it('names the head college from the account, not from the first organization row', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([{ id: 1, name: 'PSITS', college: 'College of Business Education', lifecycle_status: 'active' }]));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'College of Engineering organizations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /PSITS|Business/ })).not.toBeInTheDocument();
  });

  it('falls back to a plain heading when the account carries no college', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Eduardo', last_name: 'Ramos' }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'College organizations' })).toBeInTheDocument();
  });

  describe('silent refresh while the tab stays open', () => {
    const returnedTile = () => within(screen.getByRole('heading', { name: 'College of Engineering organizations' }).closest('section')).getByRole('link', { name: /^Returned/ });

    it('updates the status tiles without a loading state', async () => {
      renderPage();
      await screen.findByRole('heading', { name: 'College of Engineering organizations' });
      expect(returnedTile()).toHaveTextContent('1');

      let release;
      mocks.getCollegeOrganizations.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      expect(document.querySelector('.animate-pulse')).toBeNull();
      expect(returnedTile()).toHaveTextContent('1');

      await act(async () => {
        release(paginator([org(1, 'returned'), org(2, 'returned'), org(3, 'returned'), org(4, 'returned')]));
        await refresh;
      });

      expect(returnedTile()).toHaveTextContent('4');
      expect(document.querySelector('.animate-pulse')).toBeNull();
      expect(returnedTile()).not.toHaveTextContent('-');
    });

    it('keeps the figures and shows no error when the silent refresh fails', async () => {
      renderPage();
      await screen.findByRole('heading', { name: 'College of Engineering organizations' });

      mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await refetchHook.current(); });

      expect(returnedTile()).toHaveTextContent('1');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(document.querySelector('.animate-pulse')).toBeNull();
    });

    it('clears a load error once a silent refresh succeeds', async () => {
      mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('network'));
      renderPage();
      await screen.findByRole('button', { name: 'Try again' });

      await act(async () => { await refetchHook.current(); });

      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(returnedTile()).toHaveTextContent('1');
    });

    it('drops a silent response that arrives after a newer full load', async () => {
      mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('network'));
      renderPage();
      const retry = await screen.findByRole('button', { name: 'Try again' });

      let releaseSilent;
      mocks.getCollegeOrganizations.mockReturnValueOnce(new Promise((resolve) => { releaseSilent = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      mocks.getCollegeOrganizations.mockResolvedValueOnce(paginator([org(1, 'returned'), org(2, 'returned')]));
      await act(async () => { retry.click(); });
      expect(await screen.findByRole('heading', { name: 'College of Engineering organizations' })).toBeInTheDocument();
      expect(returnedTile()).toHaveTextContent('2');

      await act(async () => {
        releaseSilent(paginator([org(1, 'returned'), org(2, 'returned'), org(3, 'returned'), org(4, 'returned'), org(5, 'returned')]));
        await refresh;
      });

      expect(returnedTile()).toHaveTextContent('2');
    });
  });
});
