import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManageAcademicStructurePage from './ManageAcademicStructurePage';

const service = vi.hoisted(() => ({ createAcademicProgram: vi.fn(), deleteAcademicProgram: vi.fn(), getAcademicStructure: vi.fn(), updateAcademicProgram: vi.fn() }));
vi.mock('../../../services/userService', () => service);
vi.mock('../../../components/users/ClassListImportPanel', () => ({ default: () => null }));

async function openAdd() {
  render(<ManageAcademicStructurePage />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Add program' }))[0]);
  return screen.getByRole('dialog', { name: 'Add program' });
}

describe('ManageAcademicStructurePage add program', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getAcademicStructure.mockResolvedValue({ department: 'College of Computing', programs: [] });
    service.createAcademicProgram.mockResolvedValue({});
  });

  it('says in the form when a year has more than 26 sections instead of leaving it to the browser tooltip', async () => {
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText('Program name'), { target: { value: 'BSIT' } });

    fireEvent.change(within(dialog).getByLabelText('1st Year sections'), { target: { value: '30' } });

    expect(within(dialog).getByText('Use a whole number from 0 to 26.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add program' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('1st Year sections'), { target: { value: '26' } });
    expect(within(dialog).queryByText('Use a whole number from 0 to 26.')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add program' })).toBeEnabled();
  });

  it('clears a refusal once the name is changed', async () => {
    service.createAcademicProgram.mockRejectedValueOnce({ response: { status: 422, data: { errors: { name: ['A program with this name already exists.'] } } } });
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText('Program name'), { target: { value: 'BSIT' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add program' }));
    expect(await within(dialog).findByText('A program with this name already exists.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Program name'), { target: { value: 'BSCS' } });

    await waitFor(() => expect(within(dialog).queryByText('A program with this name already exists.')).not.toBeInTheDocument());
  });
});
