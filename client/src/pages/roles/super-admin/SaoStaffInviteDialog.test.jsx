import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaoStaffInviteDialog from './SaoStaffInviteDialog';

const service = vi.hoisted(() => ({
  createSaoStaffInvitation: vi.fn(),
  getSaoStaffInvitations: vi.fn(),
  relinkSaoStaffInvitation: vi.fn(),
  revokeSaoStaffInvitation: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => service);

const pending = { id: 4, name: 'Open link', email: null, position_title: 'SAO staff', expires_at: '2026-11-15T10:00:00Z' };

describe('Add SAO staff dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getSaoStaffInvitations.mockResolvedValue({ data: [] });
    service.createSaoStaffInvitation.mockResolvedValue({ magic_link: 'http://localhost/accept-invitation?token=sao1', emailed: false, mail_is_off: false });
    service.relinkSaoStaffInvitation.mockResolvedValue({ magic_link: 'http://localhost/accept-invitation?token=fresh' });
    service.revokeSaoStaffInvitation.mockResolvedValue({ message: 'The link no longer works.' });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } });
  });

  it('asks for nothing but an optional email and never for a name or a School ID', async () => {
    render(<SaoStaffInviteDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    expect(within(dialog).getByLabelText(/^Email/)).toBeInTheDocument();
    expect(within(dialog).getByText('(optional)')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/first name|last name|school id|password/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });

  it('makes a bare link, shows it to copy and says nothing was emailed', async () => {
    render(<SaoStaffInviteDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(service.createSaoStaffInvitation).toHaveBeenCalledWith({}));
    expect(await within(dialog).findByDisplayValue('http://localhost/accept-invitation?token=sao1')).toHaveAttribute('readonly');
    expect(within(dialog).getByText('Nothing was emailed.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/accept-invitation?token=sao1'));
    expect(await within(dialog).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await waitFor(() => expect(service.getSaoStaffInvitations).toHaveBeenCalledTimes(2));
  });

  it('ties the link to an email, lowercased, and says so when mail is on', async () => {
    service.createSaoStaffInvitation.mockResolvedValue({ magic_link: 'http://localhost/accept-invitation?token=sao2', emailed: true, mail_is_off: false });
    render(<SaoStaffInviteDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: ' Ford@Example.edu ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

    await waitFor(() => expect(service.createSaoStaffInvitation).toHaveBeenCalledWith({ email: 'ford@example.edu' }));
    expect(await within(dialog).findByText('We also emailed it to ford@example.edu.')).toBeInTheDocument();
  });

  it('says honestly that nothing was sent when email is switched off', async () => {
    service.createSaoStaffInvitation.mockResolvedValue({ magic_link: 'http://localhost/accept-invitation?token=sao3', emailed: false, mail_is_off: true });
    render(<SaoStaffInviteDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'ford@example.edu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));

    expect(await within(dialog).findByText(/Email is switched off, so nothing was sent to ford@example.edu/)).toBeInTheDocument();
  });

  it('refuses a malformed email before sending and shows the server sentence under the field', async () => {
    render(<SaoStaffInviteDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'not an email' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByText('Enter a valid email address, or leave it blank.')).toBeInTheDocument();
    expect(service.createSaoStaffInvitation).not.toHaveBeenCalled();

    service.createSaoStaffInvitation.mockRejectedValue({ response: { status: 422, data: { message: 'invalid', errors: { email: ['That email already has an account.'] } } } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'ana@example.edu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(await within(dialog).findByText('That email already has an account.')).toBeInTheDocument();
  });

  it('lists the pending links with Copy link and Revoke', async () => {
    service.getSaoStaffInvitations.mockResolvedValue({ data: [pending] });
    render(<SaoStaffInviteDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    expect(await within(dialog).findByText('Waiting for a reply (1)')).toBeInTheDocument();
    expect(within(dialog).getByText(/SAO staff · Expires/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link for Open link' }));
    await waitFor(() => expect(service.relinkSaoStaffInvitation).toHaveBeenCalledWith(4));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost/accept-invitation?token=fresh'));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke link for Open link' }));
    await waitFor(() => expect(service.revokeSaoStaffInvitation).toHaveBeenCalledWith(4));
  });

  it('closes from Cancel and, after a link is made, from Done', async () => {
    const onClose = vi.fn();
    render(<SaoStaffInviteDialog onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add SAO staff' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
