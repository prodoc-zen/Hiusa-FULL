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

  it('says in the form when a title is too short instead of leaving it to the browser tooltip', async () => {
    render(<ManageSboPositionsPage />);
    await screen.findAllByText('Treasurer');
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));
    const dialog = screen.getByRole('dialog', { name: 'Add position' });
    fireEvent.change(within(dialog).getByLabelText('Account role'), { target: { value: 'SBO_OFFICER' } });
    fireEvent.change(within(dialog).getByLabelText(/position title/i), { target: { value: 'A' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save position' }));

    expect(dialog.querySelector('form')).toHaveAttribute('novalidate');
    expect(await within(dialog).findByText('Position title must contain at least 2 characters.')).toBeInTheDocument();
    expect(service.createSboPosition).not.toHaveBeenCalled();
  });

  it('keeps responsibilities and the inactive flag in the position cell and hides an unneeded role column', async () => {
    service.getSboPositions.mockResolvedValue([
      { id: 8, role: 'ADMIN', title: 'Treasurer', description: 'Handles funds', is_active: true },
      { id: 9, role: 'ADMIN', title: 'Auditor', description: '', is_active: false },
    ]);
    render(<ManageSboPositionsPage />);
    await screen.findAllByText('Treasurer');
    const table = tableView();
    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Position', 'Actions']);
    expect(table.getByText('Handles funds')).toBeInTheDocument();
    expect(table.getAllByText('Inactive')).toHaveLength(1);
  });

  it('lets an Admin switch venue booking per officer position and saves just that switch', async () => {
    service.getSboPositions.mockResolvedValue([
      { id: 8, role: 'SBO_OFFICER', title: 'Treasurer', description: '', is_active: true, can_book_venues: false },
      { id: 9, role: 'SBO_OFFICER', title: 'Secretary', description: '', is_active: true, can_book_venues: true },
    ]);
    render(<ManageSboPositionsPage />);
    await screen.findAllByText('Treasurer');
    const table = tableView();
    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Position', 'Can book venues', 'Actions']);
    const switches = table.getAllByRole('switch', { name: /can book venues/i });
    expect(switches.map((toggle) => toggle.getAttribute('aria-checked'))).toEqual(['false', 'true']);

    fireEvent.click(switches[0]);

    await waitFor(() => expect(service.updateSboPosition).toHaveBeenCalledWith(8, { can_book_venues: true }));
    await waitFor(() => expect(tableView().getAllByRole('switch', { name: /can book venues/i })[0]).toHaveAttribute('aria-checked', 'true'));
  });

  it('keeps the switch where it was and says so when saving it fails', async () => {
    service.getSboPositions.mockResolvedValue([{ id: 8, role: 'SBO_OFFICER', title: 'Treasurer', description: '', is_active: true, can_book_venues: false }]);
    service.updateSboPosition.mockRejectedValue({ response: { data: { message: 'Could not save.' } } });
    render(<ManageSboPositionsPage />);
    await screen.findAllByText('Treasurer');

    fireEvent.click(tableView().getByRole('switch', { name: /can book venues/i }));

    expect(await screen.findByText('Could not save.')).toBeInTheDocument();
    expect(tableView().getByRole('switch', { name: /can book venues/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows no booking switch for Admin positions because an Admin can always book', async () => {
    service.getSboPositions.mockResolvedValue([{ id: 8, role: 'ADMIN', title: 'President', description: '', is_active: true, can_book_venues: true }]);
    render(<ManageSboPositionsPage />);
    await screen.findAllByText('President');
    expect(tableView().queryByRole('switch')).not.toBeInTheDocument();
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
