import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicantGrantModal from './ApplicantGrantModal';

const mocks = vi.hoisted(() => ({ allowStudentToApply: vi.fn(), searchPeople: vi.fn(), success: vi.fn() }));
vi.mock('../../services/applicantGrantService', () => ({ allowStudentToApply: mocks.allowStudentToApply }));
vi.mock('../../services/peopleService', () => ({ searchPeople: mocks.searchPeople }));
vi.mock('../../lib/notify', () => ({ default: { success: mocks.success, error: vi.fn() } }));

const ana = { school_id: 20260042, name: 'Ana Cruz', email: 'ana.cruz@example.test', role: 'STUDENT', program: 'BSIT', year_level: '3', college: 'College of Engineering', organizations: [] };

async function pickAna() {
  const dialog = await screen.findByRole('dialog', { name: 'Allow a student to apply' });
  fireEvent.change(within(dialog).getByRole('combobox', { name: /Student/ }), { target: { value: 'ana' } });
  fireEvent.click(await within(dialog).findByRole('option', { name: /Ana Cruz/ }));
  return dialog;
}

describe('ApplicantGrantModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchPeople.mockResolvedValue([ana]);
  });

  it('keeps the button off until a student is picked and searches the college for students', async () => {
    render(<ApplicantGrantModal open onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Allow a student to apply' });

    expect(within(dialog).getByRole('button', { name: 'Allow to apply' })).toBeDisabled();
    expect(within(dialog).queryByLabelText(/school id/i)).not.toBeInTheDocument();
    await pickAna();

    expect(mocks.searchPeople).toHaveBeenCalledWith({ q: 'ana', scope: 'college', role: 'STUDENT' });
    expect(within(dialog).getByRole('button', { name: 'Allow to apply' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana Cruz' }));
    expect(within(dialog).getByRole('button', { name: 'Allow to apply' })).toBeDisabled();
  });

  it('saves the permission with the picked school ID, tells the dean and closes', async () => {
    const onClose = vi.fn();
    const onGranted = vi.fn();
    const grant = { id: 1, state: 'open' };
    mocks.allowStudentToApply.mockResolvedValue({ data: grant });
    render(<ApplicantGrantModal open onClose={onClose} onGranted={onGranted} />);

    const dialog = await pickAna();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow to apply' }));

    await waitFor(() => expect(mocks.allowStudentToApply).toHaveBeenCalledWith(20260042));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onGranted).toHaveBeenCalledWith(grant);
    expect(mocks.success).toHaveBeenCalledWith('Ana Cruz can now apply for an organization.');
  });

  it('keeps the modal open and shows the server message when the student is already allowed', async () => {
    const onClose = vi.fn();
    mocks.allowStudentToApply.mockRejectedValue({ response: { status: 409, data: { message: 'Ana Cruz is already allowed to apply.' } } });
    render(<ApplicantGrantModal open onClose={onClose} />);

    const dialog = await pickAna();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow to apply' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ana Cruz is already allowed to apply.');
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Allow to apply' })).toBeEnabled();
  });

  it('shows why a student who already belongs to an organization cannot be allowed', async () => {
    mocks.searchPeople.mockResolvedValue([{ ...ana, organizations: [{ id: 7, name: 'Computing Council', position_title: null }] }]);
    render(<ApplicantGrantModal open onClose={() => {}} />);

    const dialog = await pickAna();

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Ana Cruz already belongs to Computing Council.');
    expect(within(dialog).getByRole('button', { name: 'Allow to apply' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Ana Cruz' }));
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('starts empty each time it opens', async () => {
    const { rerender } = render(<ApplicantGrantModal open onClose={() => {}} />);
    await pickAna();
    rerender(<ApplicantGrantModal open={false} onClose={() => {}} />);
    rerender(<ApplicantGrantModal open onClose={() => {}} />);

    const dialog = await screen.findByRole('dialog', { name: 'Allow a student to apply' });
    expect(within(dialog).getByRole('combobox', { name: /Student/ })).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Allow to apply' })).toBeDisabled();
  });
});
