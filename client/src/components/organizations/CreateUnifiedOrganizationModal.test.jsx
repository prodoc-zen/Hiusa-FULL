import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateUnifiedOrganizationModal from './CreateUnifiedOrganizationModal';
const api = vi.hoisted(() => ({ createUnifiedOrganization: vi.fn() }));
vi.mock('../../services/systemAdministrationService', () => api);
const fill = () => {
  fireEvent.change(screen.getByLabelText(/Organization name/), { target: { value: 'University Council' } });
  fireEvent.change(screen.getByLabelText(/Acronym/), { target: { value: 'UC' } });
};
describe('Create unified organization', () => {
  beforeEach(() => vi.clearAllMocks());
  it('creates a university-wide organization without a college or account payload', async () => {
    const onCreated = vi.fn();
    api.createUnifiedOrganization.mockResolvedValue({ id: 7, is_university_wide: true });
    render(<CreateUnifiedOrganizationModal onClose={vi.fn()} onCreated={onCreated} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => expect(api.createUnifiedOrganization).toHaveBeenCalledWith({ name: 'University Council', acronym: 'UC', description: null }));
    expect(onCreated).toHaveBeenCalledWith({ id: 7, is_university_wide: true });
  });
  it('keeps input after a server validation error', async () => {
    api.createUnifiedOrganization.mockRejectedValue({ response: { data: { message: 'Correct the form.', errors: { name: ['Name already exists.'] } } } });
    render(<CreateUnifiedOrganizationModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect((await screen.findAllByText('Name already exists.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Acronym/)).toHaveValue('UC');
  });
  it('blocks duplicate submits and dismissal while creating', async () => {
    let finish;
    api.createUnifiedOrganization.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    render(<CreateUnifiedOrganizationModal onClose={onClose} onCreated={vi.fn()} />);
    fill();
    const submit = screen.getByRole('button', { name: 'Create organization' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(api.createUnifiedOrganization).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    finish({ id: 7 });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});
