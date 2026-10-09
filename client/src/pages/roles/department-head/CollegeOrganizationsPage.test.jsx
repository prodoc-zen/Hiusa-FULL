import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CollegeOrganizationsPage from './CollegeOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getCollegeOrganizations: vi.fn(),
  getRegistrationRequirements: vi.fn(),
  registerOrganization: vi.fn(),
  resubmitOrganization: vi.fn(),
}));
vi.mock('../../../services/collegeOrganizationService', () => mocks);

const checklist = (status = 'submitted') => [
  { requirement_type_id: 1, requirement_name: 'Constitution', file_name: 'constitution.pdf', status, submission_id: 11 },
  { requirement_type_id: 2, requirement_name: 'Officer list', file_name: 'officers.pdf', status: 'approved', submission_id: 12 },
];

const organization = (overrides) => ({
  id: 1, name: 'Robotics Society', acronym: 'ROBO', description: 'Builds robots', color: '#0B8ED0', college: 'College of Engineering', lifecycle_status: 'active',
  review_remarks: null, submitted_at: '2026-09-01T08:00:00+08:00', members_count: 12, administrators_count: 2, registration_requirements: null, ...overrides,
});

const organizations = [
  organization(),
  organization({ id: 2, name: 'Chess Club', acronym: 'CHESS', lifecycle_status: 'pending', registration_requirements: checklist() }),
  organization({ id: 3, name: 'Drama Guild', acronym: 'DRAMA', lifecycle_status: 'returned', review_remarks: 'The constitution is missing signatures.', registration_requirements: checklist('returned') }),
  organization({ id: 4, name: 'Old Band', acronym: 'BAND', lifecycle_status: 'archived' }),
];

const paginator = (data) => ({ data: { data, current_page: 1, last_page: 1, per_page: 100, total: data.length } });

const requirements = {
  academic_semester: { id: 1, number: 1, academic_year: '2026-2027' },
  requirements: [
    { id: 1, name: 'Constitution', description: 'Signed copy of the constitution', deadline_at: '2026-12-01T00:00:00+08:00' },
    { id: 2, name: 'Officer list', description: null, deadline_at: '2026-12-01T00:00:00+08:00' },
  ],
};

const pdf = (name = 'doc.pdf') => new File(['pdf'], name, { type: 'application/pdf' });

function chooseFile(label, file) {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

async function openRegisterForm() {
  render(<CollegeOrganizationsPage />);
  await screen.findAllByText('Robotics Society');
  fireEvent.click(screen.getByRole('button', { name: 'Register an organization' }));
  return screen.findByRole('dialog');
}

describe('CollegeOrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCollegeOrganizations.mockResolvedValue(paginator(organizations));
    mocks.getRegistrationRequirements.mockResolvedValue({ data: requirements });
  });

  it('lists the college organizations with a status badge in text and the college name', async () => {
    render(<CollegeOrganizationsPage />);

    expect((await screen.findAllByText('Robotics Society')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Organizations' })).toBeInTheDocument();
    expect(screen.getByText(/College of Engineering/)).toBeInTheDocument();
    const table = screen.getAllByRole('table')[0];
    ['Pending review', 'Returned', 'Active', 'Archived'].forEach((label) => expect(within(table).getAllByText(label).length).toBeGreaterThan(0));
    expect(screen.getAllByText('Archived by the SAO. Read only.').length).toBeGreaterThan(0);
  });

  it('filters by lifecycle status with the tabs', async () => {
    render(<CollegeOrganizationsPage />);
    await screen.findAllByText('Robotics Society');

    expect(screen.getByRole('tab', { name: 'Returned (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Returned (1)' }));

    expect(screen.getAllByText('Drama Guild').length).toBeGreaterThan(0);
    expect(screen.queryByText('Robotics Society')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Active (1)' }));
    expect(screen.getAllByText('Robotics Society').length).toBeGreaterThan(0);
    expect(screen.queryByText('Drama Guild')).not.toBeInTheDocument();
  });

  it('shows an error with a retry and then the rows', async () => {
    mocks.getCollegeOrganizations.mockRejectedValueOnce(new Error('network'));
    render(<CollegeOrganizationsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect((await screen.findAllByText('Robotics Society')).length).toBeGreaterThan(0);
    expect(mocks.getCollegeOrganizations).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when the college has no organizations', async () => {
    mocks.getCollegeOrganizations.mockResolvedValue(paginator([]));
    render(<CollegeOrganizationsPage />);

    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
  });

  it('shows the checklist of a pending registration in a drawer', async () => {
    render(<CollegeOrganizationsPage />);
    await screen.findAllByText('Chess Club');

    fireEvent.click(screen.getAllByRole('button', { name: 'View checklist' })[0]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Waiting for SAO review')).toBeInTheDocument();
    expect(within(drawer).getByText('constitution.pdf')).toBeInTheDocument();
    expect(within(drawer).getByText('Submitted')).toBeInTheDocument();
    expect(within(drawer).getByText('Approved')).toBeInTheDocument();
  });

  it('shows the SAO remarks of a returned registration beside the row', async () => {
    render(<CollegeOrganizationsPage />);

    expect((await screen.findAllByText(/The constitution is missing signatures\./)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Edit and resubmit' }).length).toBeGreaterThan(0);
  });

  it('tells the head the SAO must activate a semester when no requirements are open', async () => {
    mocks.getRegistrationRequirements.mockResolvedValue({ data: { academic_semester: null, requirements: [] } });
    const dialog = await openRegisterForm();

    expect(await within(dialog).findByText('No registration requirements are open. The SAO must activate a semester first.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Organization name/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
  });

  it('retries loading the requirements when they fail to load', async () => {
    mocks.getRegistrationRequirements.mockRejectedValueOnce(new Error('network'));
    const dialog = await openRegisterForm();

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Try again' }));

    expect(await within(dialog).findByLabelText(/Constitution/)).toBeInTheDocument();
  });

  it('validates the registration before sending anything', async () => {
    const dialog = await openRegisterForm();
    await within(dialog).findByLabelText(/Constitution/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));

    expect(await within(dialog).findByText('Enter the organization name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the acronym.')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Attach a PDF for this requirement.')).toHaveLength(2);
    expect(mocks.registerOrganization).not.toHaveBeenCalled();
  });

  it('rejects a file that is not a PDF or is over 10 MB and a malformed color', async () => {
    const dialog = await openRegisterForm();
    await within(dialog).findByLabelText(/Constitution/);

    chooseFile(/Constitution/, new File(['x'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const big = pdf('big.pdf');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    chooseFile(/Officer list/, big);
    fireEvent.change(within(dialog).getByPlaceholderText('#0B8ED0'), { target: { value: 'blue' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));

    expect(await within(dialog).findByText('Only PDF files are accepted.')).toBeInTheDocument();
    expect(within(dialog).getByText('This file is larger than 10 MB. Choose a smaller file.')).toBeInTheDocument();
    expect(within(dialog).getByText('Use a color like #0B8ED0.')).toBeInTheDocument();
    expect(mocks.registerOrganization).not.toHaveBeenCalled();
  });

  it('submits the details and one PDF per requirement', async () => {
    mocks.registerOrganization.mockResolvedValue({ data: organization({ id: 9 }) });
    const dialog = await openRegisterForm();
    await within(dialog).findByLabelText(/Constitution/);
    expect(within(dialog).getByText('Signed copy of the constitution')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Organization name/), { target: { value: ' Debate Society ' } });
    fireEvent.change(within(dialog).getByLabelText(/Acronym/), { target: { value: 'DEBATE' } });
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: 'Argues for fun' } });
    fireEvent.change(within(dialog).getByPlaceholderText('#0B8ED0'), { target: { value: '#112233' } });
    const constitution = pdf('constitution.pdf');
    const officers = pdf('officers.pdf');
    chooseFile(/Constitution/, constitution);
    chooseFile(/Officer list/, officers);
    expect(within(dialog).getByText(/Selected: constitution\.pdf/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => expect(mocks.registerOrganization).toHaveBeenCalledTimes(1));
    expect(mocks.registerOrganization).toHaveBeenCalledWith(
      { name: 'Debate Society', acronym: 'DEBATE', description: 'Argues for fun', color: '#112233' },
      { 1: constitution, 2: officers },
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.getCollegeOrganizations).toHaveBeenCalledTimes(2);
  });

  it('shows server validation errors beside the matching field', async () => {
    mocks.registerOrganization.mockRejectedValue({ response: { status: 422, data: { message: 'invalid', errors: { name: ['The name has already been taken.'], 'files.2': ['The files.2 must be a file of type: pdf.'] } } } });
    const dialog = await openRegisterForm();
    await within(dialog).findByLabelText(/Constitution/);

    fireEvent.change(within(dialog).getByLabelText(/Organization name/), { target: { value: 'Chess Club' } });
    fireEvent.change(within(dialog).getByLabelText(/Acronym/), { target: { value: 'CC' } });
    chooseFile(/Constitution/, pdf());
    chooseFile(/Officer list/, pdf());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));

    const nameError = await within(dialog).findByText('The name has already been taken.');
    expect(nameError).toHaveAttribute('id', within(dialog).getByLabelText(/Organization name/).getAttribute('aria-describedby'));
    expect(within(dialog).getByText('The files.2 must be a file of type: pdf.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('prefills a returned registration and sends only the replaced files', async () => {
    mocks.resubmitOrganization.mockResolvedValue({ data: organization({ id: 3, lifecycle_status: 'pending' }) });
    render(<CollegeOrganizationsPage />);
    await screen.findAllByText('Chess Club');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit and resubmit' })[0]);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText(/Organization name/)).toHaveValue('Drama Guild');
    expect(within(dialog).getByText(/The constitution is missing signatures\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Current file: constitution\.pdf \(Returned\)/)).toBeInTheDocument();
    expect(mocks.getRegistrationRequirements).not.toHaveBeenCalled();

    const replacement = pdf('constitution-v2.pdf');
    chooseFile(/Constitution/, replacement);
    fireEvent.change(within(dialog).getByLabelText(/Acronym/), { target: { value: 'DRAMA2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resubmit to SAO' }));

    await waitFor(() => expect(mocks.resubmitOrganization).toHaveBeenCalledTimes(1));
    expect(mocks.resubmitOrganization).toHaveBeenCalledWith(
      3,
      { name: 'Drama Guild', acronym: 'DRAMA2', description: 'Builds robots', color: '#0B8ED0' },
      { 1: replacement },
    );
  });

  it('lets a returned registration resubmit with no replacement files', async () => {
    mocks.resubmitOrganization.mockResolvedValue({ data: organization({ id: 3 }) });
    render(<CollegeOrganizationsPage />);
    await screen.findAllByText('Chess Club');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit and resubmit' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resubmit to SAO' }));

    await waitFor(() => expect(mocks.resubmitOrganization).toHaveBeenCalledWith(3, expect.objectContaining({ name: 'Drama Guild' }), {}));
  });
});
