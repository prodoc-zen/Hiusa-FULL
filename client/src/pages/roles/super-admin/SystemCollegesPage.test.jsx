import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemCollegesPage from './SystemCollegesPage';

const mocks = vi.hoisted(() => ({
  getSystemColleges: vi.fn(), createSystemCollege: vi.fn(), updateSystemCollege: vi.fn(), deleteSystemCollege: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);

describe('SystemCollegesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 0 }]);
  });

  it('opens the reusable form from Add College and submits a new college', async () => {
    mocks.createSystemCollege.mockResolvedValue({ id: 4, name: 'College of Science' });
    render(<SystemCollegesPage />);
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add College' }));
    const dialog = screen.getByRole('dialog', { name: 'Add college' });
    fireEvent.change(within(dialog).getByLabelText('College name'), { target: { value: 'College of Science' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add college' }));
    await waitFor(() => expect(mocks.createSystemCollege).toHaveBeenCalledWith(expect.objectContaining({ name: 'College of Science' })));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the same form for editing an existing college', async () => {
    mocks.updateSystemCollege.mockResolvedValue({ id: 3, name: 'College of Fine Arts' });
    render(<SystemCollegesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit college' });
    expect(within(dialog).getByLabelText('College name')).toHaveValue('College of Arts');
    fireEvent.change(within(dialog).getByLabelText('College name'), { target: { value: 'College of Fine Arts' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.updateSystemCollege).toHaveBeenCalledWith(3, expect.objectContaining({ name: 'College of Fine Arts' })));
  });
});
