import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SubmittedFilesPage from './SubmittedFilesPage';

const mocks = vi.hoisted(() => ({ getComplianceDocuments: vi.fn(), replaceComplianceFile: vi.fn(), deleteComplianceFile: vi.fn(), openProtectedFile: vi.fn() }));
vi.mock('../../../services/complianceService', () => ({ getComplianceDocuments: mocks.getComplianceDocuments, replaceComplianceFile: mocks.replaceComplianceFile, deleteComplianceFile: mocks.deleteComplianceFile }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: mocks.openProtectedFile }));

const row = { id: 11, source: 'compliance', family: 'semester_renewal', organization: { id: 2, name: 'Computing Council' }, item: 'Constitution', file_name: 'constitution.pdf', submitted_at: '2026-10-14T08:00:00+08:00', status: 'returned', allowed_extensions: ['pdf'], open_url: '/compliance/submissions/11/document' };

describe('SubmittedFilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComplianceDocuments.mockResolvedValue({ data: { data: [row], total: 1, current_page: 1, per_page: 20 } });
  });

  it('lets the organization Admin view, replace, and delete a submission', async () => {
    mocks.openProtectedFile.mockResolvedValue();
    mocks.replaceComplianceFile.mockResolvedValue({ data: {} });
    mocks.deleteComplianceFile.mockResolvedValue({ data: {} });
    render(<MemoryRouter><SubmittedFilesPage role="ADMIN" /></MemoryRouter>);
    expect(await screen.findByText('constitution.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for constitution.pdf' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View file' }));
    await waitFor(() => expect(mocks.openProtectedFile).toHaveBeenCalledWith(row.open_url));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for constitution.pdf' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Replace file' }));
    fireEvent.change(screen.getByLabelText('New file'), { target: { files: [new File(['%PDF'], 'corrected.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit replacement' }));
    await waitFor(() => expect(mocks.replaceComplianceFile).toHaveBeenCalledWith(11, expect.any(File), row.submitted_at));

    fireEvent.click(screen.getByRole('button', { name: 'Actions for constitution.pdf' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => expect(mocks.deleteComplianceFile).toHaveBeenCalledWith(11, row.submitted_at));
  });

  it('keeps the college Head on protected view actions only', async () => {
    render(<MemoryRouter><SubmittedFilesPage role="DEPARTMENT_HEAD" /></MemoryRouter>);
    await screen.findByText('constitution.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for constitution.pdf' }));
    expect(await screen.findByRole('menuitem', { name: 'View file' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Replace file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete file' })).not.toBeInTheDocument();
  });
});
