import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentsTab from './DocumentsTab';

const complianceMocks = vi.hoisted(() => ({ getComplianceDocuments: vi.fn() }));
const systemMocks = vi.hoisted(() => ({ getSystemOrganizations: vi.fn(), getAcademicPeriods: vi.fn() }));
const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));

vi.mock('../../../services/complianceService', () => complianceMocks);
vi.mock('../../../services/systemAdministrationService', () => systemMocks);
vi.mock('../../../utils/openProtectedFile', () => openMocks);

const organization = { id: 7, name: 'Computing Society', acronym: 'CCS' };
const rows = [
  { source: 'compliance', organization, item: 'Officer Roster', parent_title: null, status: 'approved', submitted_at: '2026-09-10T08:00:00Z', submitted_by_name: 'Ana Cruz', reviewed_at: null, file_name: 'bylaws.pdf', open_url: '/compliance/submissions/1/document', academic_semester_id: 3 },
  { source: 'event_requirement', organization, item: 'Event Proposal', parent_title: 'Foundation Day', status: 'submitted', submitted_at: '2026-09-11T08:00:00Z', submitted_by_name: 'Ben Reyes', reviewed_at: null, file_name: 'proposal.pdf', open_url: '/events/9/requirement-files/2', academic_semester_id: 3 },
  { source: 'financial_report', organization, item: 'September Income Statement', parent_title: null, status: 'returned', submitted_at: null, submitted_by_name: null, reviewed_at: null, file_name: null, open_url: '/financial-reports/8/pdf', academic_semester_id: 3 },
  { source: 'financial_supporting_document', organization, item: 'Receipts.pdf', parent_title: 'September Income Statement', status: 'draft', submitted_at: '2026-09-12T08:00:00Z', submitted_by_name: 'Ana Cruz', reviewed_at: null, file_name: 'Receipts.pdf', open_url: '/financial-reports/8/documents/0', academic_semester_id: 3 },
];

const page = (data, extra = {}) => ({ data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length, ...extra } });

describe('DocumentsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemMocks.getSystemOrganizations.mockResolvedValue({ data: [organization, { id: 8, name: 'Old Club', acronym: 'OC', lifecycle_status: 'archived' }], current_page: 1, last_page: 1 });
    systemMocks.getAcademicPeriods.mockResolvedValue([{ id: 3, number: 1, status: 'active', academic_year: { label: '2026-2027' } }]);
    complianceMocks.getComplianceDocuments.mockResolvedValue(page(rows));
  });

  it('groups documents under a heading per source with a text status', async () => {
    render(<DocumentsTab />);

    for (const heading of ['Renewal and semestral documents', 'Event requirement files', 'Financial reports', 'Financial supporting documents']) {
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    }
    const events = screen.getByRole('heading', { name: 'Event requirement files' }).closest('section');
    expect(within(events).getByText('Event Proposal')).toBeInTheDocument();
    expect(within(events).getByText(/Foundation Day/)).toBeInTheDocument();
    expect(within(events).getByText('Submitted')).toBeInTheDocument();
    expect(within(events).getByText(/by Ben Reyes/)).toBeInTheDocument();
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('lists every student organization, including archived ones, and every semester', async () => {
    render(<DocumentsTab />);
    await screen.findByText('Event Proposal');

    const organizationSelect = screen.getByLabelText('Organization');
    expect(within(organizationSelect).getByRole('option', { name: 'All organizations' })).toBeInTheDocument();
    expect(within(organizationSelect).getByRole('option', { name: 'CCS - Computing Society' })).toBeInTheDocument();
    expect(within(organizationSelect).getByRole('option', { name: 'OC - Old Club (archived)' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Semester')).getByRole('option', { name: 'AY 2026-2027 · 1st Semester · active' })).toBeInTheDocument();
  });

  it('sends the chosen filters and returns to the first page', async () => {
    render(<DocumentsTab />);
    await screen.findByText('Event Proposal');

    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'financial_report' } });

    await waitFor(() => expect(complianceMocks.getComplianceDocuments).toHaveBeenLastCalledWith({
      page: 1,
      per_page: 20,
      organization_id: '7',
      academic_semester_id: '3',
      source: 'financial_report',
    }));
  });

  it('pages through results', async () => {
    complianceMocks.getComplianceDocuments.mockResolvedValue(page(rows, { last_page: 2, total: 40 }));
    render(<DocumentsTab />);
    await screen.findByText('Event Proposal');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(complianceMocks.getComplianceDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('opens a document through the authenticated helper', async () => {
    openMocks.openProtectedFile.mockResolvedValue();
    render(<DocumentsTab />);
    await screen.findByText('Event Proposal');

    fireEvent.click(screen.getByRole('button', { name: 'Open Event Proposal' }));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/events/9/requirement-files/2'));
  });

  it('shows why a document could not be opened', async () => {
    openMocks.openProtectedFile.mockRejectedValue({ userMessage: 'Allow pop-ups to open this file.' });
    render(<DocumentsTab />);
    await screen.findByText('Event Proposal');

    fireEvent.click(screen.getByRole('button', { name: 'Open Event Proposal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow pop-ups to open this file.');
  });

  it('shows the empty state', async () => {
    complianceMocks.getComplianceDocuments.mockResolvedValue(page([]));
    render(<DocumentsTab />);
    expect(await screen.findByText('No documents submitted yet.')).toBeInTheDocument();
  });

  it('shows a load error and retries', async () => {
    complianceMocks.getComplianceDocuments.mockRejectedValueOnce({ response: { status: 403, data: { message: 'That organization is outside your scope.' } } });
    render(<DocumentsTab />);

    expect(await screen.findByText('That organization is outside your scope.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Event Proposal')).toBeInTheDocument();
  });
});
