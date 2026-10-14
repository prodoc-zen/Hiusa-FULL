import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentsTab from './DocumentsTab';

const compliance = vi.hoisted(() => ({ getComplianceDocuments: vi.fn(), deleteComplianceFile: vi.fn() }));
const system = vi.hoisted(() => ({ getAcademicPeriods: vi.fn() }));
const file = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../services/complianceService', () => compliance);
vi.mock('../../../services/systemAdministrationService', () => system);
vi.mock('../../../utils/openProtectedFile', () => file);

const organization = { id: 7, name: 'Computing Society', acronym: 'CCS', college: 'College of Computing' };
const folders = [{ organization, file_count: 2, latest_submitted_at: '2026-09-12T08:00:00Z' }];
const documents = [
  { id: 1, source: 'compliance', family: 'semester_renewal', item: 'Officer Roster', file_name: 'bylaws.pdf', status: 'approved', submitted_at: '2026-09-10T08:00:00Z', open_url: '/compliance/submissions/1/document', organization_lifecycle_status: 'active' },
  { id: 2, source: 'event_requirement', family: 'event_requirement', item: 'Event Proposal', file_name: 'proposal.pdf', status: 'under_review', open_url: '/events/9/submission/files/2' },
];
const page = (items, extra = {}) => ({ data: { data: items, current_page: 1, last_page: 1, per_page: 20, total: items.length, ...extra } });
const renderPage = () => render(<MemoryRouter><DocumentsTab /></MemoryRouter>);
async function openFolder() {
  fireEvent.click(await screen.findByRole('button', { name: /Computing Society/ }));
  await screen.findByRole('table', { name: 'Files submitted by Computing Society' });
}
async function chooseAction(subject, action) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${subject}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

describe('SAO submitted files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compliance.getComplianceDocuments.mockImplementation((params) => Promise.resolve(page(params.group === 'organization' ? folders : documents)));
    system.getAcademicPeriods.mockResolvedValue([{ id: 3, number: 1, academic_year: { label: '2026-2027' } }]);
    file.openProtectedFile.mockResolvedValue();
  });

  it('opens organization folders, switches views, and returns with the breadcrumb', async () => {
    renderPage();
    const folder = await screen.findByRole('button', { name: /Computing Society/ });
    expect(folder).toHaveTextContent('College of Computing');
    expect(folder).toHaveTextContent('2 files');
    expect(compliance.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ group: 'organization', per_page: 18 }));
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(folder).toHaveClass('px-4');
    await openFolder();
    expect(screen.getByRole('row', { name: /bylaws.pdf/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All organizations' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('filters files, pages organizations, and opens protected documents', async () => {
    compliance.getComplianceDocuments.mockImplementation((params) => Promise.resolve(params.group === 'organization'
      ? page(folders, { total: 36, last_page: 2, per_page: 18, current_page: params.page })
      : page(documents)));
    renderPage();
    await screen.findByRole('button', { name: /Computing Society/ });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(compliance.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ group: 'organization', page: 2 })));
    await openFolder();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'event_requirement' } });
    fireEvent.change(screen.getByLabelText('Semester'), { target: { value: '3' } });
    await waitFor(() => expect(compliance.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 7, family: 'event_requirement', academic_semester_id: '3' })));
    await chooseAction('proposal.pdf', 'View file');
    expect(file.openProtectedFile).toHaveBeenCalledWith('/events/9/submission/files/2');
  });

  it('deletes an eligible compliance file only after confirmation', async () => {
    compliance.deleteComplianceFile.mockResolvedValue({});
    renderPage();
    await openFolder();
    await chooseAction('bylaws.pdf', 'Delete file');
    const dialog = screen.getByRole('dialog', { name: 'Delete submitted file?' });
    expect(within(dialog).getByText(/file and submission will be removed/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(compliance.deleteComplianceFile).toHaveBeenCalledWith(1, '2026-09-10T08:00:00Z'));
  });

  it('shows a retryable load error', async () => {
    compliance.getComplianceDocuments.mockRejectedValueOnce({ response: { data: { message: 'Files unavailable.' } } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Files unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Computing Society/ })).toBeInTheDocument();
  });

  it('searches files inside a folder and keeps Department Head files read only', async () => {
    render(<MemoryRouter><DocumentsTab role="DEPARTMENT_HEAD" /></MemoryRouter>);
    await openFolder();
    fireEvent.change(screen.getByLabelText('Find a file'), { target: { value: 'bylaws' } });
    await waitFor(() => expect(compliance.getComplianceDocuments).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 7, search: 'bylaws', page: 1 })));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for bylaws.pdf' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete file' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'View file' })).toBeInTheDocument();
  });
});
