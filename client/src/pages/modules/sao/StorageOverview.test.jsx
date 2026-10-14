import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StorageOverview from './StorageOverview';

const mocks = vi.hoisted(() => ({ getFileStorage: vi.fn(), updateFileStorage: vi.fn() }));
vi.mock('../../../services/complianceService', () => mocks);
const data = { settings: { max_file_mb: 10, max_organization_mb: 200 }, stored_bytes: 10485760, stored_files: 2, disk_free_bytes: 104857600, disk_total_bytes: 209715200, organizations: [
  { id: 7, name: 'Computing Society', acronym: 'CS', stored_bytes: 10485760 },
  { id: 8, name: 'Arts Guild', acronym: 'AG', stored_bytes: 1048576 },
] };

describe('Storage overview', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getFileStorage.mockResolvedValue({ data }); });
  it('finds an organization and links directly to its submitted files', async () => {
    render(<MemoryRouter><StorageOverview /></MemoryRouter>);
    await screen.findAllByText('Computing Society');
    fireEvent.change(screen.getByLabelText('Search storage organizations'), { target: { value: 'CS' } });
    expect(screen.queryByText('Arts Guild')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Computing Society' })[0]);
    expect(screen.getByRole('menuitem', { name: 'View submitted files' })).toHaveAttribute('href', '/dashboard/super-admin/documents?organization=7&name=Computing%20Society');
  });
  it('edits limits in a separate form and keeps a server failure visible', async () => {
    mocks.updateFileStorage.mockRejectedValue({ response: { data: { message: 'The maximum per file is 10 MB.' } } });
    render(<MemoryRouter><StorageOverview /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Storage limits' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit upload limits' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload limits' });
    fireEvent.change(within(dialog).getByLabelText('Maximum per file (MB)'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(mocks.updateFileStorage).toHaveBeenCalledWith({ max_file_mb: 5, max_organization_mb: 200 }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('10 MB');
    expect(within(dialog).getByLabelText('Maximum per file (MB)')).toHaveValue(5);
  });
});
