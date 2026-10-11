import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentsTab from './DocumentsTab';

const complianceMocks = vi.hoisted(() => ({ getComplianceDocuments: vi.fn() }));
const systemMocks = vi.hoisted(() => ({ getSystemOrganizations: vi.fn(), getAcademicPeriods: vi.fn() }));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));

vi.mock('../../../services/complianceService', () => complianceMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);
vi.mock('../../../utils/openProtectedFile', () => openMocks);

const organization = { id: 7, name: 'Computing Society', acronym: 'CCS' };
const summaries = [
  { organization: { ...organization, college: 'College of Computing' }, file_count: 5, latest_submitted_at: '2026-09-12T08:00:00Z' },
  { organization: { id: 8, name: 'Drama Guild', acronym: 'DG', college: null }, file_count: 1, latest_submitted_at: '2026-09-01T08:00:00Z' },
];
const row = (overrides) => ({ source: 'compliance', family: 'semester_renewal', organization, organization_lifecycle_status: 'active', item: 'Officer Roster', parent_title: null, status: 'approved', stage: null, submitted_at: '2026-09-10T08:00:00Z', submitted_by_name: 'Ana Cruz', reviewed_at: null, file_name: 'bylaws.pdf', open_url: '/compliance/submissions/1/document', academic_semester_id: 3, ...overrides });
const files = [
  row({}),
  row({ family: 'semestral_report', item: 'Semestral Accomplishment Report', open_url: '/compliance/submissions/2/document' }),
  row({ source: 'event_requirement', family: 'event_requirement', item: 'Event Proposal', parent_title: 'Foundation Day', status: 'under_review', stage: 'department_head', submitted_by_name: 'Ben Reyes', open_url: '/events/9/submission/files/2' }),
  row({ source: 'financial_report', family: 'financial_report', item: 'September Income Statement', status: 'returned', stage: null, submitted_at: null, submitted_by_name: null, file_name: null, open_url: '/financial-reports/8/pdf?inline=1' }),
  row({ source: 'financial_supporting_document', family: 'financial_supporting_document', item: 'Receipts.pdf', parent_title: 'September Income Statement', status: 'under_review', stage: 'sao', file_name: 'Receipts.pdf', open_url: '/financial-reports/8/documents/0' }),
  row({ family: 'registration', organization_lifecycle_status: 'pending', item: 'Letter of Intent', status: 'under_review', stage: 'sao', open_url: '/compliance/submissions/3/document' }),
  row({ family: 'registration', organization_lifecycle_status: 'returned', item: 'Constitution', status: 'returned', stage: 'sao', open_url: '/compliance/submissions/4/document' }),
];

const page = (data, extra = {}) => ({ data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length, ...extra } });

function serve({ summaryPage = page(summaries), filesPage = (params) => page(files, { per_page: params.per_page }) } = {}) {
  complianceMocks.getComplianceDocuments.mockImplementation((params) => Promise.resolve(params.group === 'organization' ? summaryPage : filesPage(params)));
}

function renderTab() {
  return render(<MemoryRouter><DocumentsTab /></MemoryRouter>);
}

async function expandFirst() {
  renderTab();
  fireEvent.click(await screen.findByRole('button', { name: /CCS - Computing Society/ }));
  await screen.findByRole('heading', { name: 'Event requirements' });
}

describe('DocumentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemMocks.getSystemOrganizations.mockResolvedValue({ data: [organization, { id: 8, name: 'Old Club', acronym: 'OC', lifecycle_status: 'archived' }], current_page: 1, last_page: 1 });
    systemMocks.getAcademicPeriods.mockResolvedValue([{ id: 3, number: 1, status: 'active', academic_year: { label: '2026-2027' } }]);
    serve();
  });

  it('lists one row per organization with its college, file count and latest submission', async () => {
    renderTab();

    const first = await screen.findByRole('button', { name: /CCS - Computing Society/ });
    expect(first).toHaveTextContent('College of Computing');
    expect(first).toHaveTextContent('5 files');
    expect(first).toHaveTextContent('Latest');
    expect(screen.getByRole('button', { name: /DG - Drama Guild/ })).toHaveTextContent('No college assigned');
    expect(screen.getByRole('button', { name: /DG - Drama Guild/ })).toHaveTextContent('1 file');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(complianceMocks.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ group: 'organization', page: 1, per_page: 20 }));
    expect(screen.queryByText('Event Proposal')).not.toBeInTheDocument();
  });

  it('expands an organization into its files grouped by family with a status on every row', async () => {
    await expandFirst();

    expect(screen.getByRole('button', { name: /CCS - Computing Society/ })).toHaveAttribute('aria-expanded', 'true');
    expect(complianceMocks.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 7, per_page: 50, page: 1 }));
    for (const heading of ['Event requirements', 'Semestral report', 'Semester renewal', 'Financial reports', 'Financial report supporting documents', 'Registration documents']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    const events = screen.getByRole('heading', { name: 'Event requirements' }).closest('section');
    expect(within(events).getByText('Event Proposal')).toBeInTheDocument();
    expect(within(events).getByText(/Foundation Day/)).toBeInTheDocument();
    expect(within(events).getByText('Under Review')).toBeInTheDocument();
    expect(within(events).getByText('With the Department Head')).toBeInTheDocument();
    expect(within(events).getByText(/by Ben Reyes/)).toBeInTheDocument();
    const supporting = screen.getByRole('heading', { name: 'Financial report supporting documents' }).closest('section');
    expect(within(supporting).getByText('With the SAO')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Semestral report' }).closest('section')).getByText('Approved')).toBeInTheDocument();
    const reports = screen.getByRole('heading', { name: 'Financial reports' }).closest('section');
    expect(within(reports).getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('Showing 7 of 7 files')).toBeInTheDocument();
  });

  it('links a pending registration document to the organization review and a returned one to nothing', async () => {
    await expandFirst();

    const registration = screen.getByRole('heading', { name: 'Registration documents' }).closest('section');
    const links = within(registration).getAllByRole('link', { name: 'Open organization review' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending&review=7');
    expect(within(registration).getByText('Returned by the SAO')).toBeInTheDocument();
  });

  it('collapses an organization again', async () => {
    await expandFirst();

    fireEvent.click(screen.getByRole('button', { name: /CCS - Computing Society/ }));
    expect(screen.queryByText('Event Proposal')).not.toBeInTheDocument();
  });

  it('sends the chosen filters, searches by organization name and returns to the first page', async () => {
    renderTab();
    await screen.findByRole('button', { name: /CCS - Computing Society/ });

    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'registration' } });
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: ' Drama ' } });

    await waitFor(() => expect(complianceMocks.getComplianceDocuments).toHaveBeenLastCalledWith({
      group: 'organization',
      page: 1,
      per_page: 20,
      organization_id: '7',
      academic_semester_id: '3',
      family: 'registration',
      search: 'Drama',
    }));
  });

  it('lists every student organization, including archived ones, and every semester', async () => {
    renderTab();
    await screen.findByRole('button', { name: /CCS - Computing Society/ });

    const organizationSelect = screen.getByLabelText('Organization');
    expect(within(organizationSelect).getByRole('option', { name: 'All organizations' })).toBeInTheDocument();
    expect(within(organizationSelect).getByRole('option', { name: 'CCS - Computing Society' })).toBeInTheDocument();
    expect(within(organizationSelect).getByRole('option', { name: 'OC - Old Club (Archived)' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Semester')).getByRole('option', { name: 'AY 2026-2027 · 1st Semester · Active' })).toBeInTheDocument();
  });

  it('pages through organizations and says how many there are', async () => {
    serve({ summaryPage: page(summaries, { last_page: 2, total: 40 }) });
    renderTab();
    await screen.findByRole('button', { name: /CCS - Computing Society/ });

    expect(screen.getByText(/of/, { selector: 'p' })).toHaveTextContent('Showing 1-20 of 40 organizations');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(complianceMocks.getComplianceDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'organization', page: 2 })));
  });

  it('pages the files of one organization with Load more until the last one is shown', async () => {
    const total = 120;
    serve({
      filesPage: (params) => {
        const start = (params.page - 1) * params.per_page;
        const items = Array.from({ length: Math.min(params.per_page, total - start) }, (_, index) => row({ item: `Requirement ${start + index + 1}`, open_url: `/compliance/submissions/${start + index + 1}/document` }));
        return page(items, { current_page: params.page, last_page: Math.ceil(total / params.per_page), per_page: params.per_page, total });
      },
    });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /CCS - Computing Society/ }));

    expect(await screen.findByText('Showing 50 of 120 files')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more files' }));
    expect(await screen.findByText('Showing 100 of 120 files')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more files' }));

    expect(await screen.findByText('Showing 120 of 120 files')).toBeInTheDocument();
    expect(screen.getByText('Requirement 120')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more files' })).not.toBeInTheDocument();
  });

  it('opens a document through the authenticated helper', async () => {
    openMocks.openProtectedFile.mockResolvedValue();
    await expandFirst();

    fireEvent.click(screen.getByRole('button', { name: 'View Event Proposal' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/events/9/submission/files/2'));
  });

  it('shows why a document could not be opened', async () => {
    openMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    await expandFirst();

    fireEvent.click(screen.getByRole('button', { name: 'View Event Proposal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow pop-ups to open this file.');
  });

  it('shows the empty state', async () => {
    serve({ summaryPage: page([]) });
    renderTab();
    expect(await screen.findByText('No documents submitted yet.')).toBeInTheDocument();
  });

  it('uses the filtered empty state when a filter hides every document', async () => {
    renderTab();
    await screen.findByRole('button', { name: /CCS - Computing Society/ });

    serve({ summaryPage: page([]) });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'semestral_report' } });

    expect(await screen.findByText('No documents match these filters')).toBeInTheDocument();
    expect(screen.queryByText('No documents submitted yet.')).not.toBeInTheDocument();
    serve();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByRole('button', { name: /CCS - Computing Society/ })).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    complianceMocks.getComplianceDocuments.mockRejectedValueOnce({ response: { status: 403, data: { message: 'That organization is outside your scope.' } } });
    renderTab();

    expect(await screen.findByText('That organization is outside your scope.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /CCS - Computing Society/ })).toBeInTheDocument();
  });

  it('shows an error inside an organization and retries just that list', async () => {
    complianceMocks.getComplianceDocuments.mockImplementation((params) => (params.group === 'organization'
      ? Promise.resolve(page(summaries))
      : Promise.reject({ response: { status: 403, data: { message: 'Files are unavailable.' } } })));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /CCS - Computing Society/ }));

    expect(await screen.findByText('Files are unavailable.')).toBeInTheDocument();
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Event requirements' })).toBeInTheDocument();
  });
});
