import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ApplyOrganizationPage from './ApplyOrganizationPage';

const mocks = vi.hoisted(() => ({
  getMyOrganizationApplications: vi.fn(),
  submitOrganizationApplication: vi.fn(),
}));
vi.mock('../../../services/organizationApplicationService', () => mocks);
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn(), openRequirementSample: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: openMocks.openProtectedFile }));
vi.mock('../../../utils/requirementSample', () => ({ openRequirementSample: openMocks.openRequirementSample }));

const requirements = [
  { id: 1, name: 'Constitution', description: 'Signed copy', allowed_extensions: ['pdf'], template_original_name: 'constitution-sample.pdf' },
  { id: 2, name: 'Officer list', description: null, allowed_extensions: ['pdf', 'png'], template_url: 'https://example.edu/officers' },
];

const open = (extra = {}) => ({
  data: {
    can_apply: true,
    college: { id: 5, name: 'College of Engineering' },
    academic_semester: { id: 1, number: 1, academic_year: '2026-2027' },
    requirements,
    applications: [],
    ...extra,
  },
});

const pdf = (name = 'doc.pdf') => new File(['pdf'], name, { type: 'application/pdf' });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/student/apply-organization']}>
      <Routes>
        <Route path="/dashboard/student/apply-organization" element={<ApplyOrganizationPage />} />
        <Route path="/dashboard/student/organization-applications/:applicationId" element={<p>Application page 77</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ApplyOrganizationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMyOrganizationApplications.mockResolvedValue(open());
  });

  it('shows a loading state, then the form with the college and semester from the permission', async () => {
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading card' })).toBeInTheDocument();

    expect(await screen.findByText(/College of Engineering\. Academic year 2026-2027, semester 1\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/Organization name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Constitution/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^College/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Send application' })).toHaveLength(1);
  });

  it('tells a student without permission how to get it', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue(open({ can_apply: false, college: null, requirements: [], academic_semester: null }));
    renderPage();

    expect(await screen.findByText('You cannot apply yet')).toBeInTheDocument();
    expect(screen.getByText('Ask your Department Head to allow you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send application' })).not.toBeInTheDocument();
  });

  it('says applications are closed when the SAO has no open semester', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue(open({ academic_semester: null, requirements: [] }));
    renderPage();

    expect(await screen.findByText('Applications are closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send application' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    mocks.getMyOrganizationApplications.mockRejectedValueOnce({ response: { status: 500 } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText(/Organization name/)).toBeInTheDocument();
    expect(mocks.getMyOrganizationApplications).toHaveBeenCalledTimes(2);
  });

  it('lists earlier applications with their status and links to each', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue(open({
      can_apply: false,
      applications: [{ id: 77, name: 'Chess Club', acronym: 'CHESS', status: 'returned', submitted_at: '2026-10-01T08:00:00+08:00' }],
    }));
    renderPage();

    const link = await screen.findByRole('link', { name: /Chess Club/ });
    expect(link).toHaveAttribute('href', '/dashboard/student/organization-applications/77');
    expect(within(link).getByText('Returned')).toBeInTheDocument();
    expect(screen.queryByText('You cannot apply yet')).not.toBeInTheDocument();
  });

  it('says an applicant with earlier applications cannot apply for another yet', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue(open({
      can_apply: false,
      applications: [{ id: 77, name: 'Chess Club', acronym: 'CHESS', status: 'returned', submitted_at: null }],
    }));
    renderPage();

    expect(await screen.findByText('You cannot apply for another organization yet. Ask your Department Head to allow you.')).toBeInTheDocument();
  });

  it('keeps the earlier applications above the form when the student may apply again', async () => {
    mocks.getMyOrganizationApplications.mockResolvedValue(open({
      applications: [{ id: 77, name: 'Chess Club', acronym: 'CHESS', status: 'approved', submitted_at: null }],
    }));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Apply for another organization' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chess Club/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Send application' })).toHaveLength(1);
  });

  it('refuses a file of the wrong type before anything is sent', async () => {
    renderPage();
    await screen.findByLabelText(/Organization name/);

    fireEvent.change(screen.getByLabelText(/Constitution/), { target: { files: [new File(['x'], 'constitution.docx')] } });

    expect(await screen.findByText(/Accepted file types: PDF\./)).toBeInTheDocument();
    expect(mocks.submitOrganizationApplication).not.toHaveBeenCalled();
  });

  it('opens the sample format of a requirement', async () => {
    openMocks.openRequirementSample.mockResolvedValue();
    renderPage();
    await screen.findByLabelText(/Organization name/);

    fireEvent.click(screen.getAllByRole('button', { name: 'View sample format' })[0]);

    await waitFor(() => expect(openMocks.openRequirementSample).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), { forApplication: true }));
  });

  it('sends the details and one file per requirement, then opens the new application', async () => {
    mocks.submitOrganizationApplication.mockResolvedValue({ data: { id: 77 } });
    renderPage();
    await screen.findByLabelText(/Organization name/);

    fireEvent.change(screen.getByLabelText(/Organization name/), { target: { value: ' Chess Club ' } });
    fireEvent.change(screen.getByLabelText(/Acronym/), { target: { value: 'CHESS' } });
    const constitution = pdf('constitution.pdf');
    const officers = pdf('officers.pdf');
    fireEvent.change(screen.getByLabelText(/Constitution/), { target: { files: [constitution] } });
    fireEvent.change(screen.getByLabelText(/Officer list/), { target: { files: [officers] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send application' }).closest('form'));

    await waitFor(() => expect(mocks.submitOrganizationApplication).toHaveBeenCalledTimes(1));
    expect(mocks.submitOrganizationApplication).toHaveBeenCalledWith(
      { name: 'Chess Club', acronym: 'CHESS', position_title: 'President', description: '' },
      { 1: constitution, 2: officers },
    );
    expect(await screen.findByText('Application page 77')).toBeInTheDocument();
  });

  it('shows the field errors the server returns and stays on the form', async () => {
    mocks.submitOrganizationApplication.mockRejectedValue({ response: { status: 422, data: { message: 'The name has already been taken.', errors: { name: ['The name has already been taken.'], 'files.1': ['The constitution must be a PDF.'] } } } });
    renderPage();
    await screen.findByLabelText(/Organization name/);
    fireEvent.change(screen.getByLabelText(/Organization name/), { target: { value: 'Chess Club' } });
    fireEvent.change(screen.getByLabelText(/Acronym/), { target: { value: 'CHESS' } });
    fireEvent.change(screen.getByLabelText(/Constitution/), { target: { files: [pdf()] } });
    fireEvent.change(screen.getByLabelText(/Officer list/), { target: { files: [pdf('o.pdf')] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send application' }).closest('form'));

    expect((await screen.findAllByText('The name has already been taken.')).length).toBeGreaterThan(0);
    expect(screen.getByText('The constitution must be a PDF.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send application' })).toBeEnabled();
  });
});
