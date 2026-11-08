import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CollegeOrganizationsPage from './CollegeOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getCollegeOrganizations: vi.fn(),
  getCollegeOverview: vi.fn(),
  getCollegeStaff: vi.fn(),
  addCollegeStaff: vi.fn(),
  removeCollegeStaff: vi.fn(),
  getRegistrationRequirements: vi.fn(),
  registerOrganization: vi.fn(),
  resubmitOrganization: vi.fn(),
  withdrawOrganization: vi.fn(),
}));

vi.mock('../../../services/collegeOrganizationService', () => mocks);
const people = vi.hoisted(() => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/peopleService', () => people);
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
    mocks.addCollegeStaff.mockResolvedValue({
      data: {
        school_id: 20262288,
        name: 'Alex Assistant',
        position_title: 'Dean Assistant',
        role: 'ADMIN',
        is_lead_head: false,
      },
    });
    mocks.removeCollegeStaff.mockResolvedValue({ data: { message: 'Removed' } });
    people.searchPeople.mockResolvedValue([{ school_id: 20262288, name: 'Alex Rivera Assistant', email: 'alex@univ.edu.ph', program: 'BSIT', role: 'STUDENT', organizations: [] }]);
  });

  it('renders the Dean’s Office Staff & Secretary button and opens the modal', async () => {
    render(
      <MemoryRouter>
        <CollegeOrganizationsPage />
      </MemoryRouter>
    );

    const staffBtn = await screen.findByRole('button', { name: /Dean’s Office Staff & Secretary/i });
    expect(staffBtn).toBeInTheDocument();

    fireEvent.click(staffBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Dean’s Office Staff & Delegation')).toBeInTheDocument();
    expect(await screen.findByText('Clara Secretary')).toBeInTheDocument();
    expect(screen.getByText('Lead Head')).toBeInTheDocument();
    expect(screen.getByText('Delegate')).toBeInTheDocument();
  });

  it('can open the form to assign a new delegate', async () => {
    render(
      <MemoryRouter>
        <CollegeOrganizationsPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /Dean’s Office Staff & Secretary/i }));
    expect(await screen.findByText('Clara Secretary')).toBeInTheDocument();

    const addBtn = screen.getByRole('button', { name: /Add Delegate \/ Secretary/i });
    fireEvent.click(addBtn);

    expect(screen.getByText('New Delegate Information')).toBeInTheDocument();
    expect(screen.queryByLabelText(/School ID/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/First Name/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Position Title/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Delegate' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Person' }), { target: { value: 'alex' } });
    fireEvent.click(await screen.findByRole('option', { name: /Alex Rivera Assistant/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign Delegate' }));

    await waitFor(() => {
      expect(mocks.addCollegeStaff).toHaveBeenCalledWith({
        school_id: 20262288,
        first_name: 'Alex Rivera',
        last_name: 'Assistant',
        email: 'alex@univ.edu.ph',
        position_title: 'Department Secretary',
        role: 'ADMIN',
      });
    });
  });

  it('opens the organization space from the organization row', async () => {
    render(
      <MemoryRouter>
        <CollegeOrganizationsPage />
        <LocationProbe />
      </MemoryRouter>
    );

    await screen.findAllByText('Philippine IT Society');
    const actionsBtn = (await screen.findAllByRole('button', { name: /Actions for Philippine IT Society/i }))[0];
    fireEvent.click(actionsBtn);

    const overseeBtn = await screen.findByRole('menuitem', { name: /Open organization space/i });
    expect(overseeBtn).toBeInTheDocument();

    fireEvent.click(overseeBtn);

    expect(sessionStorage.getItem('hiusa_active_subaccount')).toContain('Philippine IT Society');
    expect(screen.getByTestId('route')).toHaveTextContent('/dashboard/department-head/org/1');
  });
});
