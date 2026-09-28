import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageSboPositionsPage from './ManageSboPositionsPage';

const service = vi.hoisted(() => ({ getSboPositions: vi.fn(), createSboPosition: vi.fn(), updateSboPosition: vi.fn(), deleteSboPosition: vi.fn() }));
vi.mock('../../../services/userService', () => service);

describe('ManageSboPositionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSboPositions.mockResolvedValue([{ id: 8, role: 'SBO_OFFICER', title: 'Treasurer', description: 'Handles funds', is_active: true }]);
    service.createSboPosition.mockResolvedValue({});
    service.updateSboPosition.mockResolvedValue({});
    service.deleteSboPosition.mockResolvedValue({});
  });

  it('creates and edits positions through the shared modal', async () => {
    render(<ManageSboPositionsPage />);
    expect(await screen.findByText('Treasurer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Position' }));
    const createDialog = screen.getByRole('dialog', { name: 'Add Position' });
    fireEvent.change(within(createDialog).getByLabelText(/position title/i), { target: { value: 'Secretary' } });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Save Position' }));
    await waitFor(() => expect(service.createSboPosition).toHaveBeenCalledWith(expect.objectContaining({ title: 'Secretary' })));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Treasurer' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit Position' });
    fireEvent.change(within(editDialog).getByLabelText(/position title/i), { target: { value: 'Finance Officer' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Position' }));
    await waitFor(() => expect(service.updateSboPosition).toHaveBeenCalledWith(8, expect.objectContaining({ title: 'Finance Officer' })));
  });

  it('requires the position title before deletion', async () => {
    render(<ManageSboPositionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Treasurer' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Position' });
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete Position' });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/type treasurer to confirm/i), { target: { value: 'Treasurer' } });
    fireEvent.click(deleteButton);
    await waitFor(() => expect(service.deleteSboPosition).toHaveBeenCalledWith(8));
  });
});
