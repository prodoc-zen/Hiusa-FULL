import { render, screen, within } from '@testing-library/react';
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

const paginator = (data) => ({ data: { data, current_page: 1, last_page: 1, per_page: 100, total: data.length } });
const org = (id, lifecycle_status) => ({ id, name: `Org ${id}`, college: 'College of Engineering', lifecycle_status });

function renderPage() {
  return render(<MemoryRouter><DepartmentHeadHomePage /></MemoryRouter>);
}

describe('DepartmentHeadHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('does not highlight Returned when nothing is returned', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([org(1, 'active')]));
    renderPage();

    const heading = await screen.findByRole('heading', { name: 'College of Engineering organizations' });
    const returned = within(heading.closest('section')).getByRole('link', { name: /^Returned/ });
    expect(returned).not.toHaveClass('bg-danger-tint');
    expect(within(returned).queryByText('Action needed')).not.toBeInTheDocument();
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
});
