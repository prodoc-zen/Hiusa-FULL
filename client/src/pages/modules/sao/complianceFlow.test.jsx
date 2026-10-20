import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationCompliancePage from './OrganizationCompliancePage';
import SaoCompliancePage from './SaoCompliancePage';
import { complianceStageText } from './complianceStage';

const mocks = vi.hoisted(() => ({
  getComplianceStatus: vi.fn(),
  getRequirementTypes: vi.fn(),
  getSubmissions: vi.fn(),
  submitComplianceDocument: vi.fn(),
  reviewSubmission: vi.fn(),
  downloadSubmissionDocument: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));

vi.mock('../../../services/complianceService', () => ({
  getComplianceStatus: mocks.getComplianceStatus,
  getRequirementTypes: mocks.getRequirementTypes,
  getSubmissions: mocks.getSubmissions,
  submitComplianceDocument: mocks.submitComplianceDocument,
  reviewSubmission: mocks.reviewSubmission,
  downloadSubmissionDocument: mocks.downloadSubmissionDocument,
}));
vi.mock('../../../utils/openProtectedFile', () => openMocks);
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicYears: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../lib/notify', () => ({ default: { success: mocks.notifySuccess, error: mocks.notifyError } }));
vi.mock('./EventRequirementsTab', () => ({ default: () => <p>Event requirements content</p> }));
vi.mock('./FinancialReportsTab', () => ({ default: () => <p>Financial reports content</p> }));
vi.mock('./DocumentsTab', () => ({ default: () => <p>Track documents content</p> }));
vi.mock('./RequirementsTab', () => ({ default: () => <p>Requirements content</p> }));

function renderAt(entry, element) {
  if (entry === '/dashboard/super-admin/compliance?tab=review') entry += '&organization=7';
  return render(<MemoryRouter initialEntries={[entry]}>{element}</MemoryRouter>);
}

function requirement(status, extra = {}) {
  return { requirement_type_id: 4, requirement_name: 'Officer Roster', status, deadline_at: '2026-12-01', ...extra };
}

function adminStatus(accreditation, requirements) {
  return { data: { academic_year: '2026-2027', organizations: { organization_id: 7, accreditation_status: accreditation, requirements } } };
}

const SUBMISSION = {
  id: 12,
  status: 'submitted',
  remarks: null,
  submitted_at: '2026-09-10T08:00:00Z',
  organization: { id: 7, name: 'Computing Society' },
  requirement_type: { id: 4, name: 'Officer Roster' },
  submitter: { first_name: 'Ana', last_name: 'Cruz' },
};

function queue(items, extra = {}) {
  return { data: { data: items, current_page: 1, last_page: 1, per_page: 20, total: items.length, ...extra } };
}

describe('compliance stage text', () => {
  it('names the renewal stage for each requirement status', () => {
    expect(complianceStageText({ status: 'not_submitted', requirement_name: 'Roster' })).toBe('Not submitted');
    expect(complianceStageText({ status: 'submitted', requirement_name: 'Roster' })).toBe('Waiting for SAO review');
    expect(complianceStageText({ status: 'returned', requirement_name: 'Roster' })).toBe('Returned: replace the file');
    expect(complianceStageText({ status: 'approved', requirement_name: 'Roster' })).toBe('Approved');
  });

  it('reads the remarks from the submission on a requirement row', () => {
    expect(complianceStageText({ status: 'returned', submission: { remarks: 'Wrong year.' } })).toBe('Returned: replace the file');
  });
});

describe('OrganizationCompliancePage', () => {
  it('ignores an older category response after switching to semestral reports', async () => {
    let finishOrganization;
    const organization = new Promise((resolve) => { finishOrganization = resolve; });
    mocks.getComplianceStatus.mockImplementation((params) => params?.category === 'semestral_report'
      ? Promise.resolve(adminStatus('incomplete', [requirement('not_submitted', { requirement_name: 'Current semester evidence' })]))
      : organization);
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Semestral report' }));
    await screen.findAllByText('Current semester evidence');
    await act(async () => { finishOrganization(adminStatus('incomplete', [requirement('not_submitted', { requirement_name: 'Older organization response' })])); });
    expect(screen.queryByText('Older organization response')).not.toBeInTheDocument();
    expect(screen.getAllByText('Current semester evidence').length).toBeGreaterThan(0);
  });
  it('loads the separate semestral report requirements and keeps upload actions available', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getComplianceStatus.mockImplementation((params) => Promise.resolve(adminStatus('incomplete', [requirement('not_submitted', { requirement_name: params?.category === 'semestral_report' ? 'Semester narrative' : 'Constitution' })])));
    mocks.getRequirementTypes.mockResolvedValue({ data: [] });
    mocks.getSubmissions.mockResolvedValue(queue([]));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    await screen.findAllByText('Constitution');
    fireEvent.click(screen.getByRole('tab', { name: 'Semestral report' }));
    await screen.findAllByText('Semester narrative');
    expect(mocks.getRequirementTypes).toHaveBeenCalledWith(expect.objectContaining({ category: 'semestral_report' }));
    expect(mocks.getSubmissions).toHaveBeenCalledWith(expect.objectContaining({ category: 'semestral_report' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Semester narrative' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Upload document' }));
    expect(screen.getByRole('dialog', { name: 'Semester narrative' })).toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [] } });
    mocks.getSubmissions.mockResolvedValue(queue([]));
  });

  it.each([
    ['not_submitted', 'Not submitted'],
    ['submitted', 'Waiting for SAO review'],
    ['returned', 'Returned: replace the file'],
    ['approved', 'Approved'],
  ])('shows the %s requirement with the stage sentence %s', async (status, text) => {
    mocks.getComplianceStatus.mockResolvedValue(adminStatus('incomplete', [requirement(status)]));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    const row = (await screen.findAllByText('Officer Roster')).map((node) => node.closest('tr')).find(Boolean);
    expect(within(row).getAllByText(text).length).toBeGreaterThan(0);
  });

  it.each([
    ['incomplete', 'Submit the missing requirements', 'Owner: Admin'],
    ['returned', 'Replace the returned files', 'Owner: Admin'],
    ['pending_review', 'Waiting for SAO review', 'Owner: SAO'],
    ['accredited', 'Accredited', null],
  ])('shows the %s accreditation stepper and callout in the header', async (accreditation, title, owner) => {
    mocks.getComplianceStatus.mockResolvedValue(adminStatus(accreditation, [requirement('approved')]));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    const stepper = await screen.findByRole('list', { name: 'Accreditation progress' });
    expect(within(stepper).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    if (owner) expect(screen.getByText(owner)).toBeInTheDocument();
  });

  it('puts no button in the callout, since the requirement rows hold the actions', async () => {
    mocks.getComplianceStatus.mockResolvedValue(adminStatus('incomplete', [requirement('not_submitted')]));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    await screen.findByRole('list', { name: 'Accreditation progress' });
    expect(screen.queryByRole('button', { name: 'Open compliance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open compliance' })).not.toBeInTheDocument();
  });

  it('lets an admin view and replace the returned file from the requirement row', async () => {
    mocks.getComplianceStatus.mockResolvedValue(adminStatus('returned', [requirement('returned', {
      submission_id: 12, file_name: 'old.pdf', submitted_at: '2026-09-10T08:00:00Z', remarks: 'Update the signatures.',
    })]));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Officer Roster' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View file' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/12/document'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Officer Roster' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Replace document' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('button', { name: /View current file/ })).toBeInTheDocument();
    expect(within(drawer).getByText('Update the signatures.')).toBeInTheDocument();
  });

  it('offers the SAO sample beside a returned compliance upload', async () => {
    mocks.getComplianceStatus.mockResolvedValue(adminStatus('returned', [requirement('returned')]));
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [{ id: 4, template_original_name: 'sample.pdf' }] } });
    openMocks.openProtectedFile.mockResolvedValue();
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Officer Roster' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Replace document' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'View sample format' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/requirement-types/4/template'));
  });

  it('names who publishes requirements when none exist, under one h1', async () => {
    mocks.getComplianceStatus.mockResolvedValue(adminStatus('not_applicable', []));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    expect(await screen.findByText('No requirements assigned yet')).toBeInTheDocument();
    expect(screen.getByText(/The SAO publishes the compliance requirements/)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('is restricted for other roles, under one h1', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    renderAt('/dashboard/compliance', <OrganizationCompliancePage />);
    expect(screen.getByText('Admin access only')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('SaoCompliancePage review queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    mocks.getComplianceStatus.mockResolvedValue({ data: {
      academic_year: '2026-2027',
      organizations: [{ organization_id: 7, organization_name: 'Computing Society', accreditation_status: 'pending_review', requirements: [{ status: 'submitted', deadline_at: null }, { status: 'approved', deadline_at: null }] }],
    } });
    mocks.getSubmissions.mockResolvedValue(queue([SUBMISSION]));
  });

  it('prints the same stage sentence the organization sees for a submitted requirement', async () => {
    renderAt('/dashboard/super-admin/compliance?tab=review', <SaoCompliancePage />);
    const row = (await screen.findAllByText('Computing Society')).map((node) => node.closest('tr')).find(Boolean);
    expect(within(row).getAllByText('Waiting for SAO review').length).toBeGreaterThan(0);
  });

  it('prints the returned stage on a returned submission', async () => {
    mocks.getSubmissions.mockResolvedValue(queue([{ ...SUBMISSION, status: 'returned', remarks: 'Wrong year.' }]));
    renderAt('/dashboard/super-admin/compliance?tab=review', <SaoCompliancePage />);
    expect((await screen.findAllByText('Returned: replace the file')).length).toBeGreaterThan(0);
  });

  it('opens the review queue and the submission drawer from ?record= alone, across every status', async () => {
    renderAt('/dashboard/super-admin/compliance?record=12', <SaoCompliancePage />);
    const drawer = await screen.findByRole('dialog', { name: 'Officer Roster' });
    expect(screen.getByRole('tab', { name: /Review submissions/ })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.getSubmissions).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    expect(within(drawer).getByRole('list', { name: 'Compliance submission progress' })).toBeInTheDocument();
    expect(within(drawer).getByText('Review the submission')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('opens the drawer from a row, and shows an approved submission as done with no review buttons', async () => {
    mocks.getSubmissions.mockResolvedValue(queue([{ ...SUBMISSION, status: 'approved' }]));
    renderAt('/dashboard/super-admin/compliance?tab=review', <SaoCompliancePage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Computing Society' }))[0]);
    const drawer = await screen.findByRole('dialog', { name: 'Officer Roster' });
    expect(within(drawer).getAllByText('Approved').length).toBeGreaterThan(0);
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('keeps the drawer on the submission after approving it', async () => {
    mocks.reviewSubmission.mockResolvedValue({ data: {} });
    renderAt('/dashboard/super-admin/compliance?record=12', <SaoCompliancePage />);
    const drawer = await screen.findByRole('dialog', { name: 'Officer Roster' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this submission?' });
    mocks.getSubmissions.mockResolvedValue(queue([]));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.reviewSubmission).toHaveBeenCalledWith(12, expect.objectContaining({ status: 'approved' })));
    expect(await screen.findByRole('dialog', { name: 'Officer Roster' })).toBeInTheDocument();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('shows the decision toast at the bottom so it never covers the drawer header', async () => {
    mocks.reviewSubmission.mockResolvedValue({ data: {} });
    renderAt('/dashboard/super-admin/compliance?record=12', <SaoCompliancePage />);
    const drawer = await screen.findByRole('dialog', { name: 'Officer Roster' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this submission?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.notifySuccess).toHaveBeenCalledWith(expect.any(String), { position: 'bottom-center' }));
  });

  it('walks to a later page to find the submission named by ?record=', async () => {
    mocks.getSubmissions.mockImplementation(({ page }) => Promise.resolve(page === 2
      ? queue([SUBMISSION], { current_page: 2, last_page: 2, total: 21 })
      : queue([{ ...SUBMISSION, id: 1 }], { current_page: 1, last_page: 2, total: 21 })));
    renderAt('/dashboard/super-admin/compliance?record=12', <SaoCompliancePage />);
    expect(await screen.findByRole('dialog', { name: 'Officer Roster' })).toBeInTheDocument();
  });

  it('says so when ?record= names a submission that is not in the queue', async () => {
    renderAt('/dashboard/super-admin/compliance?record=999', <SaoCompliancePage />);
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith('That submission is not in the review queue.'));
  });

  it('names who sends submissions on the empty queue', async () => {
    mocks.getSubmissions.mockResolvedValue(queue([]));
    renderAt('/dashboard/super-admin/compliance?tab=review', <SaoCompliancePage />);
    expect(await screen.findByText('No submissions match these filters')).toBeInTheDocument();
    expect(screen.getByText(/Try a different status or organization/)).toBeInTheDocument();
  });

  it('keeps ?tab= working and shows a compact accreditation stepper on each organization row', async () => {
    renderAt('/dashboard/super-admin/compliance', <SaoCompliancePage />);
    expect((await screen.findAllByRole('progressbar', { name: 'Accreditation progress for Computing Society' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'Organization accreditation' })).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['/dashboard/super-admin/compliance'],
    ['/dashboard/super-admin/compliance?tab=review'],
  ])('renders exactly one h1 at %s', async (entry) => {
    renderAt(entry, <SaoCompliancePage />);
    await screen.findAllByText('Computing Society');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
