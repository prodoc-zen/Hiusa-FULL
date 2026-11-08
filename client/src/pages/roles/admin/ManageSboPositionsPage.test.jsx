import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageSboPositionsPage from './ManageSboPositionsPage';

const service = vi.hoisted(() => ({ getSboPositions: vi.fn(), createSboPosition: vi.fn(), updateSboPosition: vi.fn(), deleteSboPosition: vi.fn() }));
vi.mock('../../../services/userService', () => service);

// DataTable renders a table and a stacked list for small screens; the row menu is read from the table.
const tableView = () => within(document.querySelector('[data-view="table"]'));

describe('ManageSboPositionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSboPositions.mockResolvedValue([{ id: 8, role: 'SBO_OFFICER', title: 'Treasurer', description: 'Handles funds', is_active: true }]);
    service.createSboPosition.mockResolvedValue({});
    service.updateSboPosition.mockResolvedValue({});
    service.deleteSboPosition.mockResolvedValue({});
  });

  it('creates and edits positions in the side panel', async () => {
    render(<ManageSboPositionsPage />);
    expect((await screen.findAllByText('Treasurer')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    const createDialog = screen.getByRole('dialog', { name: 'Add position' });
    fireEvent.change(within(createDialog).getByLabelText(/position title/i), { target: { value: 'Secretary' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(service.createSboPosition).toHaveBeenCalledWith(expect.objectContaining({ title: 'Secretary' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(tableView().getByRole('button', { name: 'Actions for Treasurer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit position' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit position' });
    fireEvent.change(within(editDialog).getByLabelText(/position title/i), { target: { value: 'Finance Officer' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save position' }));
    await waitFor(() => expect(service.updateSboPosition).toHaveBeenCalledWith(8, expect.objectContaining({ title: 'Finance Officer' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('requires the position title before deletion', async () => {
    render(<ManageSboPositionsPage />);
    await screen.findAllByText('Treasurer');
    fireEvent.click(tableView().getByRole('button', { name: 'Actions for Treasurer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete position' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete position' });
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete position' });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/type treasurer to confirm/i), { target: { value: 'Treasurer' } });
    fireEvent.click(deleteButton);
    await waitFor(() => expect(service.deleteSboPosition).toHaveBeenCalledWith(8));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
