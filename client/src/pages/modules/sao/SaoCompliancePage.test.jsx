import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoCompliancePage from './SaoCompliancePage';

const mocks = vi.hoisted(() => ({
  getComplianceStatus: vi.fn(),
  getRequirementTypes: vi.fn(),
  createRequirementType: vi.fn(),
  updateRequirementType: vi.fn(),
  deleteRequirementType: vi.fn(),
  getSubmissions: vi.fn(),
  reviewSubmission: vi.fn(),
  downloadSubmissionDocument: vi.fn(),
  getAcademicYears: vi.fn(),
  getSystemOrganizations: vi.fn(),
}));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../../services/complianceService', () => mocks);
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicYears: mocks.getAcademicYears, getSystemOrganizations: mocks.getSystemOrganizations }));
vi.mock('../../../utils/openProtectedFile', () => openMocks);
vi.mock('../../../lib/notify', () => ({ default: toasts }));
vi.mock('./EventRequirementsTab', () => ({ default: () => <p>Event requirements content</p> }));
vi.mock('./FinancialReportsTab', () => ({ default: () => <p>Financial reports content</p> }));
vi.mock('./DocumentsTab', () => ({ default: () => <p>Track documents content</p> }));

const status = {
  academic_year: '2026-2027',
  organizations: [
    { organization_id: 7, organization_name: 'Computing Society', accreditation_status: 'pending_review', requirements: [{ status: 'submitted', deadline_at: null }, { status: 'approved', deadline_at: null }] },
    { organization_id: 8, organization_name: 'Arts Guild', accreditation_status: 'accredited', requirements: [{ status: 'approved', deadline_at: null }] },
  ],
};
const requirementType = { id: 4, name: 'Officer Roster', academic_year: '2026-2027', deadline_at: '2026-10-01', description: '', is_active: true };
const submission = {
  id: 12,
  status: 'submitted',
  submitted_at: '2026-09-10T08:00:00Z',
  organization: { id: 7, name: 'Computing Society' },
  requirement_type: { id: 4, name: 'Semestral Accomplishment Report' },
  submitter: { first_name: 'Ana', last_name: 'Cruz' },
};

function Probe() {
  const location = useLocation();
  return <p data-testid="search">{location.search}</p>;
}

function renderPage(entry = '/dashboard/super-admin/compliance') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SaoCompliancePage />
      <Probe />
    </MemoryRouter>,
  );
}

async function chooseAction(subject, action) {
  fireEvent.click((await screen.findAllByRole('button', { name: `Actions for ${subject}` }))[0]);
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

describe('SaoCompliancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    mocks.getComplianceStatus.mockResolvedValue({ data: status });
    mocks.getRequirementTypes.mockResolvedValue({ data: { data: [requirementType] } });
    mocks.getSubmissions.mockResolvedValue({ data: { data: [submission], current_page: 1, last_page: 1, per_page: 20, total: 1 } });
    mocks.getAcademicYears.mockResolvedValue([{ id: 1, label: '2026-2027', is_current: true }]);
    mocks.getSystemOrganizations.mockResolvedValue({ data: [], current_page: 1, last_page: 1 });
    openMocks.openProtectedFile.mockResolvedValue();
    mocks.reviewSubmission.mockResolvedValue({ data: {} });
    mocks.deleteRequirementType.mockResolvedValue({ status: 204 });
  });

  it('blocks everyone but the SAO', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    renderPage();
    expect(screen.getByText('SAO access only')).toBeInTheDocument();
    expect(mocks.getComplianceStatus).not.toHaveBeenCalled();
  });

  it('defaults to the accreditation tab and falls back from unknown values', async () => {
    renderPage('/dashboard/super-admin/compliance?tab=nonsense');
    expect((await screen.findAllByText('Computing Society')).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'Progress by organization' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Progress by organization' })).toBeInTheDocument();
  });

  it.each([
    ['events', 'Event requirements', 'Event requirements content'],
    ['financial', 'Financial reports', 'Financial reports content'],
    ['documents', 'Documents', 'Track documents content'],
  ])('opens the %s tab from the query', async (key, label, content) => {
    renderPage(`/dashboard/super-admin/compliance?tab=${key}`);
    expect(await screen.findByText(content)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  });

  it('separates review work from requirement settings and keeps the active route', async () => {
    renderPage();
    await screen.findAllByText('Computing Society');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Organizations', 'Event reviews', 'Financial reports', 'Requirement settings', 'Documents', 'Progress by organization', 'Review submissions (1)',
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect((await screen.findAllByText('Track documents content')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=documents');
  });

  it('shows the accreditation status tones from the shared map', async () => {
    renderPage();
    const pending = (await screen.findAllByText('Pending review'))[0];
    expect(pending).toHaveClass('bg-brand-50');
    expect(screen.getAllByText('Accredited')[0]).toHaveClass('bg-success-tint');
  });

  it('puts overdue and pending-review organizations ahead of accredited ones', async () => {
    mocks.getComplianceStatus.mockResolvedValue({ data: { academic_year: '2026-2027', organizations: [
      { organization_id: 1, organization_name: 'Alpha Club', accreditation_status: 'accredited', requirements: [{ status: 'approved', deadline_at: null }] },
      { organization_id: 2, organization_name: 'Beta Club', accreditation_status: 'incomplete', requirements: [{ status: 'draft', deadline_at: null }] },
      { organization_id: 3, organization_name: 'Gamma Club', accreditation_status: 'returned', requirements: [{ status: 'returned', deadline_at: null }] },
      { organization_id: 4, organization_name: 'Delta Club', accreditation_status: 'pending_review', requirements: [{ status: 'submitted', deadline_at: null }] },
      { organization_id: 5, organization_name: 'Epsilon Club', accreditation_status: 'incomplete', requirements: [{ status: 'draft', deadline_at: '2020-01-01' }] },
    ] } });
    renderPage();
    await screen.findAllByText('Alpha Club');
    const order = Array.from(document.querySelectorAll('[data-view="table"] tbody tr')).map((row) => row.querySelector('td').textContent);
    expect(order).toEqual(['Epsilon Club', 'Delta Club', 'Gamma Club', 'Beta Club', 'Alpha Club']);
  });

  it('leaves the review queue count off when nothing is waiting', async () => {
    mocks.getComplianceStatus.mockResolvedValue({ data: { academic_year: '2026-2027', organizations: [status.organizations[1]] } });
    renderPage();
    await screen.findAllByText('Arts Guild');
    expect(screen.getByRole('tab', { name: 'Review submissions' })).toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    renderPage();
    await screen.findAllByText('Computing Society');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Progress by organization' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Review submissions (1)' })).toHaveFocus();
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=review');
    expect((await screen.findAllByText('Semestral Accomplishment Report')).length).toBeGreaterThan(0);
  });

  it('shows an accreditation error and retries', async () => {
    mocks.getComplianceStatus.mockRejectedValueOnce(new Error('offline'));
    renderPage();

    expect((await screen.findAllByText('Could not load accreditation status.')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Computing Society')).length).toBeGreaterThan(0);
  });

  it('jumps from an organization to its pending submissions', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Computing Society' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Review 1 submission' }));

    expect((await screen.findAllByText('Semestral Accomplishment Report')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=review');
    await waitFor(() => expect(mocks.getSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({ organization_id: '7', status: 'submitted' })));
  });

  it('shows every requirement in a table and opens an existing file from its row action', async () => {
    mocks.getComplianceStatus.mockResolvedValue({ data: { academic_year: '2026-2027', organizations: [{
      organization_id: 7, organization_name: 'Computing Society', accreditation_status: 'returned', requirements: [
        { requirement_type_id: 4, requirement_name: 'Constitution', status: 'returned', submission_id: 12, file_name: 'constitution.pdf', submitted_at: '2026-09-10T08:00:00Z', remarks: 'Missing signature.' },
        { requirement_type_id: 5, requirement_name: 'Officer Roster', status: 'not_submitted', submission_id: null, file_name: null },
      ],
    }] } });
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Computing Society' }))[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View requirements' }));

    const dialog = await screen.findByRole('dialog', { name: 'Computing Society' });
    expect(within(dialog).getByRole('table', { name: 'Requirements for Computing Society' })).toBeInTheDocument();
    expect(within(dialog).getAllByText('constitution.pdf').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('No file').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('SAO: Missing signature.').length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Actions for Constitution' })[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View file' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/12/document'));
  });

  describe('requirements tab', () => {
    it('deletes a requirement after confirmation and refreshes the list', async () => {
      renderPage('/dashboard/super-admin/compliance?tab=requirements');
      await chooseAction('Officer Roster', 'Delete requirement');
      mocks.getRequirementTypes.mockResolvedValue({ data: { data: [] } });
      fireEvent.click(await screen.findByRole('button', { name: 'Delete requirement' }));

      await waitFor(() => expect(mocks.deleteRequirementType).toHaveBeenCalledWith(4));
      expect((await screen.findAllByText('No requirements defined yet')).length).toBeGreaterThan(0);
    });

    it('shows the server message inline when submissions block the delete', async () => {
      mocks.deleteRequirementType.mockRejectedValue({ response: { status: 409, data: { message: 'This requirement cannot be deleted because it has submissions.' } } });
      renderPage('/dashboard/super-admin/compliance?tab=requirements');
      await chooseAction('Officer Roster', 'Delete requirement');
      fireEvent.click(await screen.findByRole('button', { name: 'Delete requirement' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('This requirement cannot be deleted because it has submissions.');
      expect(screen.getAllByText('Officer Roster').length).toBeGreaterThan(0);
    });

    it('creates a requirement from the catalog', async () => {
      mocks.createRequirementType.mockResolvedValue({ data: {} });
      renderPage('/dashboard/super-admin/compliance?tab=requirements');
      await screen.findAllByText('Officer Roster');

      fireEvent.click(screen.getAllByRole('button', { name: 'New requirement' })[0]);
      fireEvent.change(screen.getByPlaceholderText('e.g. Accomplishment report'), { target: { value: 'Officer list' } });
      fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: '2026-11-01' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'PNG' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));

      await waitFor(() => expect(mocks.createRequirementType).toHaveBeenCalledWith(expect.objectContaining({
        academic_year: '2026-2027', name: 'Officer list', deadline_at: '2026-11-01', allowed_extensions: ['pdf', 'png'],
      })));
    });

    it('asks before marking a requirement inactive and says what it changes', async () => {
      mocks.updateRequirementType.mockResolvedValue({ data: {} });
      renderPage('/dashboard/super-admin/compliance?tab=requirements');
      await chooseAction('Officer Roster', 'Mark inactive');
      expect(mocks.updateRequirementType).not.toHaveBeenCalled();
      expect(await screen.findByText(/accreditation status is recalculated/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mark inactive' }));
      await waitFor(() => expect(mocks.updateRequirementType).toHaveBeenCalledWith(4, { is_active: false }));
    });

    it('marks an inactive requirement active without a confirmation', async () => {
      mocks.updateRequirementType.mockResolvedValue({ data: {} });
      mocks.getRequirementTypes.mockResolvedValue({ data: { data: [{ ...requirementType, is_active: false }] } });
      renderPage('/dashboard/super-admin/compliance?tab=requirements');
      await chooseAction('Officer Roster', 'Mark active');
      await waitFor(() => expect(mocks.updateRequirementType).toHaveBeenCalledWith(4, { is_active: true }));
    });

    it('flags each missing field and focuses the first one', async () => {
      renderPage('/dashboard/super-admin/compliance?tab=requirements');
      await screen.findAllByText('Officer Roster');

      fireEvent.click(screen.getAllByRole('button', { name: 'New requirement' })[0]);
      fireEvent.change(screen.getByLabelText(/Academic year/), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add requirement' }));

      expect(screen.getByText('Choose the academic year this requirement applies to.')).toBeInTheDocument();
      expect(screen.getByText('Set the deadline for organizations.')).toBeInTheDocument();
      expect(screen.getByText('Enter a name for this requirement.')).toBeInTheDocument();
      expect(screen.getByLabelText(/Academic year/)).toHaveFocus();
      expect(mocks.createRequirementType).not.toHaveBeenCalled();

      fireEvent.change(screen.getByPlaceholderText('e.g. Accomplishment report'), { target: { value: 'Officer list' } });
      expect(screen.queryByText('Enter a name for this requirement.')).not.toBeInTheDocument();
    });

    it('shows a load error and retries', async () => {
      mocks.getRequirementTypes.mockRejectedValueOnce(new Error('offline'));
      renderPage('/dashboard/super-admin/compliance?tab=requirements');

      expect((await screen.findAllByText('Could not load requirement types.')).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect((await screen.findAllByText('Officer Roster')).length).toBeGreaterThan(0);
    });
  });

  describe('review queue tab', () => {
    it('labels the kind of document and approves a submission', async () => {
      renderPage('/dashboard/super-admin/compliance?tab=review');
      expect((await screen.findAllByText('Semestral report')).length).toBeGreaterThan(0);

      await chooseAction('Semestral Accomplishment Report for Computing Society', 'Approve');
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

      await waitFor(() => expect(mocks.reviewSubmission).toHaveBeenCalledWith(12, { status: 'approved', submitted_at: submission.submitted_at }));
    });

    it('labels non-semestral requirements as renewal documents', async () => {
      mocks.getSubmissions.mockResolvedValue({ data: { data: [{ ...submission, requirement_type: { id: 5, name: 'Officer Roster' } }], current_page: 1, last_page: 1, per_page: 20, total: 1 } });
      renderPage('/dashboard/super-admin/compliance?tab=review');
      expect((await screen.findAllByText('Renewal document')).length).toBeGreaterThan(0);
    });

    it('names the organization on the row action menu', async () => {
      renderPage('/dashboard/super-admin/compliance?tab=review');
      expect((await screen.findAllByRole('button', { name: 'Actions for Semestral Accomplishment Report for Computing Society' })).length).toBeGreaterThan(0);
    });

    it('opens a submission document in a new tab through the shared helper', async () => {
      renderPage('/dashboard/super-admin/compliance?tab=review');
      await chooseAction('Semestral Accomplishment Report for Computing Society', 'View document');

      await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/compliance/submissions/12/document'));
      expect(mocks.downloadSubmissionDocument).not.toHaveBeenCalled();
    });

    it('says the registration was withdrawn when its file is gone, closes the record and refreshes the queue', async () => {
      const registration = { ...submission, is_registration: true, organization: { id: 21, name: 'Robotics Guild', lifecycle_status: 'pending' }, requirement_type: { id: 5, name: 'Letter of Intent' } };
      mocks.getSubmissions.mockResolvedValue({ data: { data: [registration], current_page: 1, last_page: 1, per_page: 20, total: 1 } });
      openMocks.openProtectedFile.mockRejectedValue({ response: { status: 404, data: new Blob(['{"message":"No query results for model"}']) } });
      renderPage('/dashboard/super-admin/compliance?tab=review&record=12');
      fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));

      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('This registration was withdrawn')));
      expect(toasts.error).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(mocks.getSubmissions.mock.calls.length).toBeGreaterThan(1));
      await waitFor(() => expect(screen.getByTestId('search')).not.toHaveTextContent('record=12'));
    });

    it('sends a pending registration document to the organization review instead of offering a decision', async () => {
      mocks.getSubmissions.mockResolvedValue({ data: { data: [{ ...submission, is_registration: true, organization: { id: 21, name: 'Robotics Guild', lifecycle_status: 'pending' }, requirement_type: { id: 5, name: 'Letter of Intent' } }], current_page: 1, last_page: 1, per_page: 20, total: 1 } });
      renderPage('/dashboard/super-admin/compliance?tab=review');

      expect((await screen.findAllByText('Registration document')).length).toBeGreaterThan(0);
      expect((await screen.findAllByText('Decided in the organization review')).length).toBeGreaterThan(0);
      fireEvent.click((await screen.findAllByRole('button', { name: 'Actions for Letter of Intent for Robotics Guild' }))[0]);
      expect(screen.getByRole('menuitem', { name: 'Open organization review' })).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending&review=21');
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
    });

    it('says a returned registration waits for the Department Head and offers no link', async () => {
      mocks.getSubmissions.mockResolvedValue({ data: { data: [{ ...submission, is_registration: true, organization: { id: 22, name: 'Chess Club', lifecycle_status: 'returned' }, requirement_type: { id: 5, name: 'Letter of Intent' } }], current_page: 1, last_page: 1, per_page: 20, total: 1 } });
      renderPage('/dashboard/super-admin/compliance?tab=review');

      expect((await screen.findAllByText('Registration returned, waiting for the Department Head')).length).toBeGreaterThan(0);
      expect(screen.queryByRole('link', { name: 'Open organization review' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('lets the queue be filtered to an organization still waiting for registration approval', async () => {
      mocks.getSystemOrganizations.mockImplementation((params) => Promise.resolve({
        data: params.lifecycle_status === 'pending' ? [{ id: 21, name: 'Robotics Guild' }] : [],
        current_page: 1,
        last_page: 1,
      }));
      renderPage('/dashboard/super-admin/compliance?tab=review');

      expect(await screen.findByRole('option', { name: 'Robotics Guild (registration)' })).toBeInTheDocument();
      expect(mocks.getSystemOrganizations).toHaveBeenCalledWith(expect.objectContaining({ lifecycle_status: 'pending' }));
    });

    it('also lets the queue be filtered to an organization whose registration was returned', async () => {
      mocks.getSystemOrganizations.mockImplementation((params) => Promise.resolve({
        data: { pending: [{ id: 21, name: 'Robotics Guild' }], returned: [{ id: 22, name: 'Chess Club' }] }[params.lifecycle_status] ?? [],
        current_page: 1,
        last_page: 1,
      }));
      renderPage('/dashboard/super-admin/compliance?tab=review');

      expect(await screen.findByRole('option', { name: 'Chess Club (registration)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Robotics Guild (registration)' })).toBeInTheDocument();
      expect(mocks.getSystemOrganizations).toHaveBeenCalledWith(expect.objectContaining({ lifecycle_status: 'returned' }));
    });

    it('requires remarks to return a submission, with a field error instead of a disabled button', async () => {
      renderPage('/dashboard/super-admin/compliance?tab=review');
      await chooseAction('Semestral Accomplishment Report for Computing Society', 'Return');

      const confirm = await screen.findByRole('button', { name: 'Return to organization' });
      expect(confirm).toBeEnabled();
      expect(confirm).not.toHaveClass('bg-danger');
      fireEvent.click(confirm);
      expect(await screen.findByText(/Write what the organization needs to correct/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Remarks/)).toHaveFocus();
      expect(mocks.reviewSubmission).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: 'Unsigned' } });
      fireEvent.click(confirm);

      await waitFor(() => expect(mocks.reviewSubmission).toHaveBeenCalledWith(12, { status: 'returned', remarks: 'Unsigned', submitted_at: submission.submitted_at }));
    });

    it('shows the archived-organization message inline', async () => {
      mocks.reviewSubmission.mockRejectedValue({ response: { status: 409, data: { message: 'This organization is archived and its documents are read only.' } } });
      renderPage('/dashboard/super-admin/compliance?tab=review');
      await chooseAction('Semestral Accomplishment Report for Computing Society', 'Approve');
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('This organization is archived and its documents are read only.');
    });

    it('shows the registration message inline when returning', async () => {
      mocks.reviewSubmission.mockRejectedValue({ response: { status: 409, data: { message: 'Registration documents are reviewed through the organization review.' } } });
      renderPage('/dashboard/super-admin/compliance?tab=review');
      await chooseAction('Semestral Accomplishment Report for Computing Society', 'Return');
      fireEvent.change(await screen.findByLabelText(/Remarks/), { target: { value: 'Unsigned' } });
      fireEvent.click(screen.getByRole('button', { name: 'Return to organization' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Registration documents are reviewed through the organization review.');
    });

    it('shows the empty state and a load error with retry', async () => {
      mocks.getSubmissions.mockRejectedValueOnce(new Error('offline'));
      mocks.getSubmissions.mockResolvedValueOnce({ data: { data: [], current_page: 1, last_page: 1, per_page: 20, total: 0 } });
      renderPage('/dashboard/super-admin/compliance?tab=review');

      expect((await screen.findAllByText('Could not load the review queue.')).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect((await screen.findAllByText('Nothing to review')).length).toBeGreaterThan(0);
    });
  });
});
