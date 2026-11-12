import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddStaffModal from './AddStaffModal';
import notifyMock from '../../lib/notify';

const college = vi.hoisted(() => ({
  getStaffRecords: vi.fn(),
  inviteCollegeStaff: vi.fn(),
  getStaffInvitations: vi.fn(),
  relinkStaffInvitation: vi.fn(),
  revokeStaffInvitation: vi.fn(),
}));
vi.mock('../../services/collegeOrganizationService', () => college);
vi.mock('../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const MARITES = { school_id: 7100101, name: 'Marites Dizon', position: 'Department Secretary', has_account: false };
const PENDING = { id: 5, name: 'Ramon Cruz', position_title: 'Lab Technician', email: 'ramon@example.edu', expires_at: '2026-11-11T08:00:00Z' };
const OPEN = { id: 6, name: 'Open link', position_title: null, email: null, expires_at: '2026-11-11T08:00:00Z' };

const reply = (data, has_records = true) => Promise.resolve({ data: { data, has_records } });

function renderModal() {
  const onClose = vi.fn();
  render(<AddStaffModal open onClose={onClose} />);
  return onClose;
}

const find = async (text) => {
  fireEvent.change(await screen.findByRole('combobox', { name: /find in the employee records/i }), { target: { value: text } });
  return screen.findByRole('option', { name: /Marites Dizon/ });
};

describe('AddStaffModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    college.getStaffRecords.mockImplementation(() => reply([MARITES]));
    college.getStaffInvitations.mockResolvedValue({ data: { data: [] } });
    college.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=abc' } });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } });
  });

  it('shows a loading state while the employee records load', () => {
    college.getStaffRecords.mockReturnValueOnce(new Promise(() => {}));
    renderModal();
    expect(screen.getByRole('status', { name: 'Loading employee records' })).toBeInTheDocument();
  });

  it('picks an employee, shows the ID number read only, and creates the link from the record', async () => {
    renderModal();
    fireEvent.click(await find('mar'));

    expect(college.getStaffRecords).toHaveBeenCalledWith({ q: 'mar' });
    const idField = screen.getByLabelText('ID number');
    expect(idField).toHaveValue('7100101');
    expect(idField).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/^Position/)).toHaveValue('Department Secretary');
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ registry_school_id: 7100101, position_title: 'Department Secretary' }));
    expect(await screen.findByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was emailed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('offers the records and a link with nothing required: no name, no email, no position to fill in', async () => {
    renderModal();
    await screen.findByRole('combobox', { name: /find in the employee records/i });

    expect(screen.queryByLabelText(/First name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Last name/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).not.toBeRequired();
    expect(screen.getByLabelText(/^Position/)).not.toBeRequired();
    expect(screen.getByRole('button', { name: 'Create invite link' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({}));
    expect(await screen.findByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was emailed/)).toBeInTheDocument();
    expect(screen.getByText(/expires in 48 hours. Copy it and share it yourself/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('lets the dean change the position of a picked employee', async () => {
    renderModal();
    fireEvent.click(await find('mar'));
    fireEvent.change(screen.getByLabelText(/^Position/), { target: { value: 'Registrar Aide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ registry_school_id: 7100101, position_title: 'Registrar Aide' }));
  });

  it('tells the dean an employee with an account signs in to accept', async () => {
    college.getStaffRecords.mockImplementation(() => reply([{ ...MARITES, has_account: true }]));
    renderModal();
    fireEvent.click(await find('mar'));
    expect(screen.getByText(/already have an account. They sign in and accept the link/)).toBeInTheDocument();
  });

  it('shows the server reason, such as the student refusal, when the link cannot be made', async () => {
    college.inviteCollegeStaff.mockRejectedValueOnce({ response: { data: { message: 'Students cannot be office staff. Pick someone from the employee records.' } } });
    renderModal();
    fireEvent.click(await find('mar'));
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(await screen.findByText('Students cannot be office staff. Pick someone from the employee records.')).toBeInTheDocument();
  });

  it('ties the link to an optional email and optional position, and says it was emailed only when it was', async () => {
    college.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=abc', emailed: true, mail_is_off: false } });
    renderModal();
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: ' Ramon@Example.edu ' } });
    fireEvent.change(screen.getByLabelText(/^Position/), { target: { value: 'Lab Technician' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ email: 'ramon@example.edu', position_title: 'Lab Technician' }));
    expect(await screen.findByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
    expect(screen.getByText('We also emailed it to ramon@example.edu.')).toBeInTheDocument();
  });

  it('says nothing was sent when email is switched off, and still shows the link to copy', async () => {
    college.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=abc', emailed: false, mail_is_off: true } });
    renderModal();
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'ramon@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(await screen.findByText(/Email is switched off, so nothing was sent to ramon@example.edu/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://localhost/accept-invitation?token=abc')).toBeInTheDocument();
    expect(screen.queryByText(/We also emailed/)).not.toBeInTheDocument();
  });

  it('says so when the email could not be sent', async () => {
    college.inviteCollegeStaff.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=abc', emailed: false, mail_is_off: false } });
    renderModal();
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'ramon@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(await screen.findByText(/The email could not be sent/)).toBeInTheDocument();
  });

  it('refuses a malformed email before asking the server', async () => {
    renderModal();
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(await screen.findByText('That email does not look right. Fix it or leave it empty.')).toBeInTheDocument();
    expect(college.inviteCollegeStaff).not.toHaveBeenCalled();
  });

  it('drops the email once an employee is picked, because the link is made for that record', async () => {
    renderModal();
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'ramon@example.edu' } });
    fireEvent.click(await find('mar'));

    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({ registry_school_id: 7100101, position_title: 'Department Secretary' }));
  });

  it('shows only the email and position when the college has no employee records', async () => {
    college.getStaffRecords.mockReturnValue(reply([], false));
    renderModal();

    expect(await screen.findByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create invite link' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(college.inviteCollegeStaff).toHaveBeenCalledWith({}));
  });

  it('shows an error with a retry when the records cannot be loaded', async () => {
    college.getStaffRecords.mockRejectedValueOnce({ response: { data: { message: 'Records are unavailable.' } } });
    renderModal();

    expect(await screen.findByText('Records are unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('combobox', { name: /find in the employee records/i })).toBeInTheDocument();
  });

  it('closes from the cancel button', async () => {
    const onClose = renderModal();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lists pending links with Copy link and Revoke', async () => {
    college.getStaffInvitations.mockResolvedValue({ data: { data: [PENDING] } });
    college.relinkStaffInvitation.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=new' } });
    college.revokeStaffInvitation.mockResolvedValue({ data: { message: 'ok' } });
    renderModal();

    expect(await screen.findByText('Ramon Cruz')).toBeInTheDocument();
    expect(screen.getByText(/Lab Technician/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link for Ramon Cruz' }));
    await waitFor(() => expect(college.relinkStaffInvitation).toHaveBeenCalledWith(5));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/accept-invitation?token=new'));

    college.getStaffInvitations.mockResolvedValue({ data: { data: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link for Ramon Cruz' }));
    await waitFor(() => expect(college.revokeStaffInvitation).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByText('Ramon Cruz')).not.toBeInTheDocument());
  });

  it('lists an open link as Open link with the default position', async () => {
    college.getStaffInvitations.mockResolvedValue({ data: { data: [OPEN] } });
    renderModal();

    expect(await screen.findByText('Open link')).toBeInTheDocument();
    expect(screen.getByText(/^Office staff · Expires/)).toBeInTheDocument();
  });

  it('still shows the new link to copy by hand when the clipboard refuses it', async () => {
    college.getStaffInvitations.mockResolvedValue({ data: { data: [PENDING] } });
    college.relinkStaffInvitation.mockResolvedValue({ data: { magic_link: 'http://localhost/accept-invitation?token=new' } });
    navigator.clipboard.writeText.mockRejectedValue(new Error('NotAllowedError'));
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Copy link for Ramon Cruz' }));

    const shown = await screen.findByLabelText('New link for Ramon Cruz');
    expect(shown).toHaveValue('http://localhost/accept-invitation?token=new');
    expect(shown).toHaveAttribute('readonly');
    expect(notifyMock.error).toHaveBeenCalledWith('Could not copy the link. Select it and copy it by hand.');

    // A second try copies the same link; it does not make another and kill this one.
    navigator.clipboard.writeText.mockResolvedValue();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link for Ramon Cruz' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('http://localhost/accept-invitation?token=new'));
    expect(college.relinkStaffInvitation).toHaveBeenCalledTimes(1);
  });
});
