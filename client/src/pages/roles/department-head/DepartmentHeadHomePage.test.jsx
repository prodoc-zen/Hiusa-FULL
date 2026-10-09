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
    const count = (label) => within(section).getByText(label).closest('div').querySelector('dd').textContent;
    expect(count('Active')).toBe('2');
    expect(count('Pending review')).toBe('1');
    expect(count('Returned')).toBe('1');
    expect(count('Archived')).toBe('0');
    expect(within(section).getByRole('link', { name: 'Manage organizations' })).toHaveAttribute('href', '/dashboard/department-head/organizations');
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
