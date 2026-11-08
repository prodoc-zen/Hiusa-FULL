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
vi.mock('../../../components/process', () => ({ ProcessTracker: () => <div data-testid="process-tracker" /> }));
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

  it('shows three tiles, each a link, with older returned and pending filings as context', async () => {
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    const section = heading.closest('section');
    const tiles = within(section).getAllByRole('link');
    expect(tiles.map((tile) => tile.textContent)).toEqual(['Awaiting your approval0', 'Active organizations21 returned, 1 pending review', 'Upcoming events0']);
    expect(tiles.map((tile) => tile.getAttribute('href'))).toEqual([
      '/dashboard/department-head/approvals',
      '/dashboard/department-head/organizations?status=active',
      '/dashboard/events',
    ]);
  });

  it('counts every upcoming event, not only the four listed', async () => {
    const soon = (id) => ({ id, title: `Event ${id}`, status: 'upcoming', start_time: `2030-01-0${id}T08:00:00` });
    mocks.getEvents.mockResolvedValue(paginator([1, 2, 3, 4, 5, 6].map(soon)));
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    expect(within(heading.closest('section')).getByRole('link', { name: /^Upcoming events/ })).toHaveTextContent('6');
    expect(screen.getAllByText(/^Event \d$/)).toHaveLength(4);
  });

  it('adds no context to the Active tile when nothing is returned or pending', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([org(1, 'active')]));
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    expect(within(heading.closest('section')).getByRole('link', { name: /^Active organizations/ }).textContent).toBe('Active organizations1');
  });

  it('leaves out the active election card when none is running', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    expect(screen.queryByText('Active election')).not.toBeInTheDocument();
  });

  it('shows the active election when one is running', async () => {
    mocks.getElections.mockResolvedValue([{ id: 1, title: 'Officer Election 2026', status: 'active', start_time: '2026-11-01', end_time: '2026-11-03' }]);
    renderPage();
    expect(await screen.findByText('Officer Election 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View results' })).toHaveAttribute('href', '/dashboard/elections/election-results');
  });

  it('lets the dashboard columns shrink to a phone width', async () => {
    renderPage();

    const events = (await screen.findByText('No upcoming events.')).closest('section');
    expect(events).toHaveClass('min-w-0');
    expect(events.parentElement).toHaveClass('grid-cols-1');
  });

  it('names the first action when the college has no organization yet', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([]));
    renderPage();

    expect(await screen.findByText('No student organizations yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Allow a student to apply' })).toHaveAttribute('href', '/dashboard/department-head/people');
    expect(screen.queryByRole('link', { name: /^Active organizations/ })).not.toBeInTheDocument();
  });

  it('does not call a failed load an empty college', async () => {
    mocks.getCollegeOrganizations.mockRejectedValue(new Error('network'));
    renderPage();

    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText('No student organizations yet')).not.toBeInTheDocument();
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
    const returnedTile = () => within(screen.getByRole('heading', { name: 'College of Engineering organizations' }).closest('section')).getByRole('link', { name: /^Active organizations/ });

    it('updates the status tiles without a loading state', async () => {
      renderPage();
      await screen.findByRole('heading', { name: 'College of Engineering organizations' });
      expect(returnedTile()).toHaveTextContent('1 returned');

      let release;
      mocks.getCollegeOrganizations.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      let refresh;
      act(() => { refresh = refetchHook.current(); });
      expect(screen.queryByRole('status', { name: 'Loading stat' })).not.toBeInTheDocument();
      expect(returnedTile()).toHaveTextContent('1 returned');

      await act(async () => {
        release(paginator([org(1, 'returned'), org(2, 'returned'), org(3, 'returned'), org(4, 'returned')]));
        await refresh;
      });

      expect(returnedTile()).toHaveTextContent('4 returned');
      expect(screen.queryByRole('status', { name: 'Loading stat' })).not.toBeInTheDocument();
      expect(returnedTile()).not.toHaveTextContent('-');
    });

    it('keeps the figures and shows no error when the silent refresh fails', async () => {
      renderPage();
      await screen.findByRole('heading', { name: 'College of Engineering organizations' });

      mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('offline'));
      await act(async () => { await refetchHook.current(); });

      expect(returnedTile()).toHaveTextContent('1 returned');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Loading stat' })).not.toBeInTheDocument();
    });

    it('clears a load error once a silent refresh succeeds', async () => {
      mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('network'));
      renderPage();
      await screen.findByRole('button', { name: 'Try again' });

      await act(async () => { await refetchHook.current(); });

      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(returnedTile()).toHaveTextContent('1 returned');
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
      expect(returnedTile()).toHaveTextContent('2 returned');

      await act(async () => {
        releaseSilent(paginator([org(1, 'returned'), org(2, 'returned'), org(3, 'returned'), org(4, 'returned'), org(5, 'returned')]));
        await refresh;
      });

      expect(returnedTile()).toHaveTextContent('2 returned');
    });
  });

  it('opens with the process tracker above everything else', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    const tracker = screen.getByTestId('process-tracker');
    expect(tracker.parentElement.firstElementChild).toBe(tracker);
  });
});
