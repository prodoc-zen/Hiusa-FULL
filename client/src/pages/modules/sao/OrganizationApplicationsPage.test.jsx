import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationApplicationsPage from './OrganizationApplicationsPage';
import { getOrganizationApplications, reviewOrganizationApplication } from '../../../services/organizationApplicationService';
import { openProtectedFile } from '../../../utils/openProtectedFile';

vi.mock('../../../services/organizationApplicationService', () => ({ getOrganizationApplications: vi.fn(), reviewOrganizationApplication: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile: vi.fn() }));
const application = { id: 8, name: 'Computing Council', acronym: 'CC', first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.test', school_id: 12345678, position_title: 'President', college: { name: 'College of Computing' }, description: 'Student computing organization.', documents: [{ id: 10, requirement_type: { name: 'Constitution' }, file_original_name: 'constitution.pdf' }] };

describe('Organization application review', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it.each([['DEPARTMENT_HEAD', 'pending_endorsement', 'Endorse to SAO', 'endorse'], ['SUPER_ADMIN', 'endorsed', 'Approve registration', 'approve']])('shows the correct decision for %s and closes after saving', async (role, status, label, action) => {
    localStorage.setItem('user', JSON.stringify({ role }));
    getOrganizationApplications.mockResolvedValue({ data: { data: [{ ...application, status }], total: 1, current_page: 1, per_page: 10 } });
    reviewOrganizationApplication.mockResolvedValue({ data: { email_sent: true } });
    render(<OrganizationApplicationsPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'View application' }))[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('alex@example.test')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'View constitution.pdf' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'View constitution.pdf' }));
    expect(openProtectedFile).toHaveBeenCalledWith('/organization-applications/8/documents/10');
    expect(within(dialog).getByRole('button', { name: 'Reject application' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
    await waitFor(() => expect(reviewOrganizationApplication).toHaveBeenCalledWith(8, { action, remarks: null }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
