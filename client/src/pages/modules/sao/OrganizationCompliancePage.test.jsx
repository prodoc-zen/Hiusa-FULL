import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationCompliancePage from './OrganizationCompliancePage';

const { compliance, pagination } = vi.hoisted(() => ({
  compliance: { getComplianceStatus: vi.fn(), getRequirementTypes: vi.fn(), getSubmissions: vi.fn(), submitComplianceDocument: vi.fn() },
  pagination: { fetchAllPages: vi.fn() },
}));

vi.mock('../../../services/complianceService', () => compliance);
vi.mock('../../../services/pagination', () => pagination);
vi.mock('../../../components/ai/SemesterNarrativeDrawer', () => ({
  default: ({ open, semesterId }) => (open ? <div role="dialog" aria-label="Narrative drawer">Narrative for semester {semesterId}</div> : null),
}));

const requirement = (overrides) => ({
  requirement_type_id: 1, requirement_name: 'Accomplishment Report', status: 'not_submitted', deadline_at: '2026-12-20', submission_id: null, file_name: null, ...overrides,
});

function statusFor(requirements, semesterId = 7) {
  return { data: { academic_year: '2026-2027', academic_semester_id: semesterId, organizations: { accreditation_status: 'accredited', requirements } } };
}

function renderPage() {
  return render(<MemoryRouter><OrganizationCompliancePage /></MemoryRouter>);
}

async function openRowMenu(name) {
  fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${name}` }))[0]);
}

describe('OrganizationCompliancePage narrative action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    pagination.fetchAllPages.mockResolvedValue([]);
    compliance.getComplianceStatus.mockResolvedValue(statusFor([requirement({}), requirement({ requirement_type_id: 2, requirement_name: 'Action Plan', status: 'approved' })]));
  });

  it('offers Draft the narrative on an open row of the semestral report group and opens the drawer for that semester', async () => {
    renderPage();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Requirement group' }), { target: { value: 'semestral_report' } });

    await openRowMenu('Accomplishment Report');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Draft the narrative' }));

    expect(await screen.findByRole('dialog', { name: 'Narrative drawer' })).toHaveTextContent('Narrative for semester 7');
    expect(compliance.getComplianceStatus).toHaveBeenLastCalledWith({ category: 'semestral_report' });
  });

  it('does not offer it on a row that is already approved', async () => {
    renderPage();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Requirement group' }), { target: { value: 'semestral_report' } });

    await screen.findAllByRole('button', { name: 'Actions for Accomplishment Report' });

    expect(screen.queryByRole('button', { name: 'Actions for Action Plan' })).not.toBeInTheDocument();
  });

  it('does not offer it on the accreditation group', async () => {
    renderPage();

    await openRowMenu('Accomplishment Report');

    expect(screen.queryByRole('menuitem', { name: 'Draft the narrative' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Upload document' })).toBeInTheDocument();
  });

  it('does not offer it when no semester is selected', async () => {
    compliance.getComplianceStatus.mockResolvedValue(statusFor([requirement({})], null));
    renderPage();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Requirement group' }), { target: { value: 'semestral_report' } });

    await openRowMenu('Accomplishment Report');

    expect(screen.queryByRole('menuitem', { name: 'Draft the narrative' })).not.toBeInTheDocument();
  });
});
