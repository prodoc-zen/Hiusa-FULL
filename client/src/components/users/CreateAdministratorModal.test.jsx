import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateAdministratorModal from './CreateAdministratorModal';

const mocks = vi.hoisted(() => ({ getProfileOrganizations: vi.fn(), createSystemAdmin: vi.fn() }));
vi.mock('../../services/authService', () => ({ getProfileOrganizations: mocks.getProfileOrganizations }));
vi.mock('../../services/systemAdministrationService', () => ({ createSystemAdmin: mocks.createSystemAdmin }));
const organization = { id: 7, name: 'Computing Council', college: 'College of Computing' };

function fillForm() {
  for (const [label, value] of [['School ID', '78123456'], ['First name', 'New'], ['Last name', 'Admin'], ['Email', 'NEW@example.test'], ['Initial password', 'Initial-Password-123!'], ['Confirm initial password', 'Initial-Password-123!']]) {
    fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
  }
}

describe('SAO administrator creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileOrganizations.mockResolvedValue({ data: [organization] });
    mocks.createSystemAdmin.mockResolvedValue({ school_id: 78123456, role: 'ADMIN' });
  });

  it('creates an account in the fixed organization and refreshes its parent', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreateAdministratorModal organization={organization} onCreated={onCreated} onClose={onClose} />);
    fillForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Create administrator' }).form);
    await waitFor(() => expect(mocks.createSystemAdmin).toHaveBeenCalledWith(expect.objectContaining({ school_id: 78123456, organization_id: 7, email: 'new@example.test', password: 'Initial-Password-123!' })));
    expect(mocks.getProfileOrganizations).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith({ school_id: 78123456, role: 'ADMIN' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('loads authorized destination organizations for the university directory', async () => {
    render(<CreateAdministratorModal onClose={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Computing Council' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create administrator' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Organization/), { target: { value: '7' } });
    expect(screen.getByRole('button', { name: 'Create administrator' })).not.toBeDisabled();
  });

  it('keeps creation unavailable when there are no active destinations and explains the next step', async () => {
    mocks.getProfileOrganizations.mockResolvedValue({ data: [] });
    render(<CreateAdministratorModal onClose={vi.fn()} />);
    expect(await screen.findByText(/Approve or restore an organization/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create administrator' })).toBeDisabled();
  });

  it('retries a failed organization lookup without enabling a save against an unavailable destination', async () => {
    mocks.getProfileOrganizations.mockRejectedValueOnce(new Error('offline'));
    render(<CreateAdministratorModal onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load organizations.');
    expect(screen.getByRole('button', { name: 'Create administrator' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: 'Computing Council' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Organization/), { target: { value: '7' } });
    expect(screen.getByRole('button', { name: 'Create administrator' })).not.toBeDisabled();
  });

  it('keeps server field errors visible without closing or losing entered names', async () => {
    mocks.createSystemAdmin.mockRejectedValue({ response: { status: 422, data: { message: 'Validation failed.', errors: { school_id: ['This school ID already has a login.'] } } } });
    const onClose = vi.fn();
    render(<CreateAdministratorModal organization={organization} onClose={onClose} />);
    fillForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Create administrator' }).form);
    expect((await screen.findAllByText('This school ID already has a login.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^First name/)).toHaveValue('New');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords before calling the API', () => {
    render(<CreateAdministratorModal organization={organization} onClose={vi.fn()} />);
    fillForm();
    fireEvent.change(screen.getByLabelText(/^Confirm initial password/), { target: { value: 'Different-Password-123!' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create administrator' }).form);
    expect(screen.getByText('Passwords must match.')).toBeInTheDocument();
    expect(mocks.createSystemAdmin).not.toHaveBeenCalled();
  });

  it('blocks duplicate submissions and closing while the request is pending', async () => {
    let finish;
    mocks.createSystemAdmin.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<CreateAdministratorModal organization={organization} onClose={vi.fn()} />);
    fillForm();
    const form = screen.getByRole('button', { name: 'Create administrator' }).form;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.createSystemAdmin).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument();
    finish({ school_id: 78123456 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled());
  });

  it('offers the existing-login workflow and explains the required password change', () => {
    const onUseExisting = vi.fn();
    render(<CreateAdministratorModal organization={organization} onClose={vi.fn()} onUseExisting={onUseExisting} />);
    expect(within(screen.getByRole('dialog')).getByText(/must change the initial password/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use existing user' }));
    expect(onUseExisting).toHaveBeenCalledOnce();
  });
});
