import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CollegeOrganizationsPage from './CollegeOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getCollegeOrganizations: vi.fn(),
  getCollegeOverview: vi.fn(),
  getCollegeStaff: vi.fn(),
  getStaffRecords: vi.fn(),
  inviteCollegeStaff: vi.fn(),
  getStaffInvitations: vi.fn(),
  relinkStaffInvitation: vi.fn(),
  revokeStaffInvitation: vi.fn(),
  removeCollegeStaff: vi.fn(),
  getRegistrationRequirements: vi.fn(),
  registerOrganization: vi.fn(),
  resubmitOrganization: vi.fn(),
  withdrawOrganization: vi.fn(),
}));

vi.mock('../../../services/collegeOrganizationService', () => mocks);
vi.mock('../../../hooks/useRefetchOnReturn', () => ({ useRefetchOnReturn: vi.fn() }));

function LocationProbe() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}

const mockStaff = [
  {
    school_id: 10001,
    name: 'Dr. John Dean',
    first_name: 'John',
    last_name: 'Dean',
    email: 'john.dean@university.edu.ph',
    position_title: 'Dean of Computing',
    role: 'DEPARTMENT_HEAD',
    is_lead_head: true,
  },
  {
    school_id: 20261199,
    name: 'Clara Secretary',
    first_name: 'Clara',
    last_name: 'Secretary',
    email: 'clara.sec@university.edu.ph',
    position_title: 'Department Secretary',
    role: 'ADMIN',
    is_lead_head: false,
  },
];

const mockOrganizations = [
  {
    id: 1,
    name: 'Philippine IT Society',
    acronym: 'PITS',
    description: 'Tech society',
    color: '#0878B7',
    college: 'College of Computer Studies',
    lifecycle_status: 'active',
    members_count: 45,
    administrators_count: 3,
    registration_requirements: [],
  },
];

describe('CollegeOrganizationsPage Staff Delegation and Sub-Account Oversight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({
      school_id: 10001,
      role: 'DEPARTMENT_HEAD',
      first_name: 'John',
      last_name: 'Dean',
      department: 'College of Computer Studies',
    }));

    mocks.getCollegeOverview.mockResolvedValue({
      data: {
        college: { id: 10, name: 'College of Computer Studies', code: 'CCS' },
        head: { name: 'Dr. John Dean' },
      },
    });

    mocks.getCollegeOrganizations.mockResolvedValue({
      data: {
        data: mockOrganizations,
        current_page: 1,
        last_page: 1,
        per_page: 50,
        total: 1,
      },
    });

    mocks.getCollegeStaff.mockResolvedValue({ data: mockStaff });
    mocks.getStaffRecords.mockResolvedValue({ data: { data: [{ school_id: 7100101, name: 'Marites Dizon', position: 'Department Secretary', has_account: false }], has_records: true } });
    mocks.getStaffInvitations.mockResolvedValue({ data: { data: [] } });
    mocks.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=abc' } });
    mocks.removeCollegeStaff.mockResolvedValue({ data: { message: 'Removed' } });
  });

  it('renders the Office staff button and opens the modal', async () => {
    render(
      <MemoryRouter>
        <CollegeOrganizationsPage />
      </MemoryRouter>
    );

    const staffBtn = await screen.findByRole('button', { name: /^Office staff$/i });
    expect(staffBtn).toBeInTheDocument();

    fireEvent.click(staffBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Faculty or other staff you trust to work on every organization/)).toBeInTheDocument();
    expect(await screen.findByText('Clara Secretary')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText(/^Department Head/)).toBeInTheDocument();
    expect(screen.queryByText('Delegate')).not.toBeInTheDocument();
  });

  it('adds office staff by link from the employee records and never by instant assignment', async () => {
    render(
      <MemoryRouter>
        <CollegeOrganizationsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Office staff$/i }));
    expect(await screen.findByText('Clara Secretary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Add staff$/i }));

    fireEvent.change(await screen.findByRole('combobox', { name: /find in the employee records/i }), { target: { value: 'mar' } });
    fireEvent.click(await screen.findByRole('option', { name: /Marites Dizon/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(mocks.inviteCollegeStaff).toHaveBeenCalledWith({ registry_school_id: 7100101, position_title: 'Department Secretary' }));
    expect(await screen.findByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
  });

  it('opens the organization space from the organization row', async () => {
    render(
      <MemoryRouter>
        <CollegeOrganizationsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await screen.findAllByText('Philippine IT Society');
    const overseeBtn = (await screen.findAllByRole('button', { name: /Open organization space for Philippine IT Society/i }))[0];
    expect(overseeBtn).toBeInTheDocument();

    fireEvent.click(overseeBtn);

    expect(sessionStorage.getItem('hiusa_active_subaccount')).toContain('Philippine IT Society');
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/department-head/org/1');
  });
});
