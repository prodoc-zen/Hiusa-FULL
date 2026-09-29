import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemOrganizationsPage from './SystemOrganizationsPage';

const mocks = vi.hoisted(() => ({
  getSystemOrganizations: vi.fn(), getSystemColleges: vi.fn(), createSystemOrganization: vi.fn(), updateSystemOrganization: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);

describe('SystemOrganizationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 1, name: 'College of Arts', is_active: true }]);
    mocks.getSystemOrganizations.mockResolvedValue({ data: [{ id: 3, name: 'Main SBO', acronym: 'SBO', college: 'College of Arts', is_active: true, users_count: 0, administrators: [] }], current_page: 1, last_page: 1 });
  });

  it('offers catalog colleges when adding an organization', async () => {
    mocks.createSystemOrganization.mockResolvedValue({ id: 4 });
    render(<SystemOrganizationsPage />);
    await screen.findByText('Main SBO');
    fireEvent.click(screen.getByRole('button', { name: 'Add organization' }));
    const dialog = screen.getByRole('dialog', { name: 'Add organization' });
    expect(within(dialog).getByRole('option', { name: 'College of Arts' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Organization name'), { target: { value: 'New Club' } });
    fireEvent.change(within(dialog).getByLabelText('Organization code'), { target: { value: 'NC' } });
    fireEvent.change(within(dialog).getByLabelText('Department / college'), { target: { value: 'College of Arts' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save organization' }));
    await waitFor(() => expect(mocks.createSystemOrganization).toHaveBeenCalledWith(expect.objectContaining({ college: 'College of Arts' })));
  });
});
