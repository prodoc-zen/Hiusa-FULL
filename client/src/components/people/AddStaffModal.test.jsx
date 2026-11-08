import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddStaffModal from './AddStaffModal';

const college = vi.hoisted(() => ({ getStaffRecords: vi.fn(), inviteCollegeStaff: vi.fn() }));
vi.mock('../../services/collegeOrganizationService', () => college);
vi.mock('../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const MARITES = { school_id: 7100101, name: 'Marites Dizon', position: 'Department Secretary' };

const reply = (data, has_records = true) => Promise.resolve({ data: { data, has_records } });

function renderModal() {
  const onClose = vi.fn();
  render(<AddStaffModal open onClose={onClose} />);
  return onClose;
}

const find = async (text) => {
  fireEvent.change(await screen.findByRole('combobox', { name: /find in the school records/i }), { target: { value: text } });
  return screen.findByRole('option', { name: /Marites Dizon/ });
};

describe('AddStaffModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    college.getStaffRecords.mockImplementation((params) => (params.q ? reply([MARITES]) : reply([MARITES])));
    college.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=abc' } });
  });

  it('shows a loading state, then the search over the school records', async () => {
    college.getStaffRecords.mockReturnValueOnce(new Promise(() => {}));
    renderModal();
    expect(screen.getByRole('status', { name: 'Loading school records' })).toBeInTheDocument();
  });

  it('picks a person from the records, shows the ID number and position read only, and creates the link from the record', async () => {
    renderModal();
    fireEvent.click(await find('mar'));

    expect(college.getStaffRecords).toHaveBeenCalledWith({ q: 'mar' });
    const idField = screen.getByLabelText('ID number');
    expect(idField).toHaveValue('7100101');
    expect(idField).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Position')).toHaveValue('Department Secretary');
    expect(screen.getByLabelText('Position')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText(/school id/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ registry_school_id: 7100101 }));
    expect(await screen.findByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('keeps the create button disabled until someone is picked and passes the optional email along', async () => {
    renderModal();
    await screen.findByRole('combobox', { name: /find in the school records/i });
    expect(screen.getByRole('button', { name: 'Create invite link' })).toBeDisabled();

    fireEvent.click(await find('mar'));
    fireEvent.change(screen.getByLabelText(/Send it to/), { target: { value: 'marites@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ registry_school_id: 7100101, email: 'marites@example.edu' }));
  });

  it('shows the server reason when the link cannot be made', async () => {
    college.inviteCollegeStaff.mockRejectedValueOnce({ response: { data: { message: 'That person already has an account.' } } });
    renderModal();
    fireEvent.click(await find('mar'));
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(await screen.findByText('That person already has an account.')).toBeInTheDocument();
  });

  it('falls back to a plain link, with a position, when the person is not in the records', async () => {
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: /Not in the school records\?/ }));

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create invite link' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Position/), { target: { value: 'College Secretary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ position_title: 'College Secretary' }));
    expect(await screen.findByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
  });

  it('can go back from the plain link to the school records', async () => {
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: /Not in the school records\?/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the school records' }));

    expect(await screen.findByRole('combobox', { name: /find in the school records/i })).toBeInTheDocument();
  });

  it('goes straight to the plain link when the college has no employee records', async () => {
    college.getStaffRecords.mockReturnValue(reply([], false));
    renderModal();

    expect(await screen.findByLabelText(/Position/)).toBeInTheDocument();
    expect(screen.getByText(/No office staff are in the school records/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to the school records' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the records cannot be loaded', async () => {
    college.getStaffRecords.mockRejectedValueOnce({ response: { data: { message: 'Records are unavailable.' } } });
    renderModal();

    expect(await screen.findByText('Records are unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('combobox', { name: /find in the school records/i })).toBeInTheDocument();
  });

  it('closes from the cancel button', async () => {
    const onClose = renderModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
