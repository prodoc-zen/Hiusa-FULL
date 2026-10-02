import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHandoverDrawer from './AdminHandoverDrawer';
import { getSystemOrganizationMembers, handoverSystemAdmin } from '../../../services/systemAdministrationService';

vi.mock('../../../services/systemAdministrationService', () => ({ getSystemOrganizationMembers: vi.fn(), handoverSystemAdmin: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const admin = { school_id: 900001, first_name: 'Marco', last_name: 'Dela Cruz', position_title: 'President', organization_id: 1, organization: { id: 1, name: 'Computer Science Society' } };

describe('AdminHandoverDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands the role to a member found by search', async () => {
    const onDone = vi.fn();
    vi.mocked(getSystemOrganizationMembers).mockResolvedValue([
      { school_id: 900001, first_name: 'Marco', last_name: 'Dela Cruz', role: 'ADMIN' },
      { school_id: 2100142, first_name: 'Juan', last_name: 'Dela Vega', role: 'SBO_OFFICER', position_title: 'Treasurer' },
    ]);
    vi.mocked(handoverSystemAdmin).mockResolvedValue({ successor: { first_name: 'Juan', last_name: 'Dela Vega' } });
    render(<AdminHandoverDrawer admin={admin} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByText(/deactivated, not deleted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand over' })).toBeDisabled();
    const option = await screen.findByRole('radio', { name: /Juan Dela Vega/ });
    expect(screen.queryByRole('radio', { name: /Marco Dela Cruz/ })).not.toBeInTheDocument();
    expect(screen.getByText(/SBO Officer · Treasurer/)).toBeInTheDocument();
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(handoverSystemAdmin).toHaveBeenCalledWith(900001, { mode: 'existing', successor_school_id: 2100142 });
  });

  it('creates a new account as the successor', async () => {
    vi.mocked(getSystemOrganizationMembers).mockResolvedValue([]);
    vi.mocked(handoverSystemAdmin).mockResolvedValue({ successor: { first_name: 'Lia', last_name: 'Santos' } });
    render(<AdminHandoverDrawer admin={admin} onClose={vi.fn()} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'New account' }));
    const fill = (label, value) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    fill('School ID', '20269999');
    fill('First name', 'Lia');
    fill('Last name', 'Santos');
    fill('Email', 'lia.santos@example.edu');
    fill('Initial password', 'Turnover2026!');
    fill('Confirm password', 'Turnover2026!');
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));

    await waitFor(() => expect(handoverSystemAdmin).toHaveBeenCalledWith(900001, expect.objectContaining({ mode: 'new', school_id: '20269999', email: 'lia.santos@example.edu', contact_number: null })));
  });

  it('keeps the drawer open with the server reason when a successor is refused', async () => {
    vi.mocked(getSystemOrganizationMembers).mockResolvedValue([{ school_id: 3, first_name: 'Ana', last_name: 'Reyes', role: 'STUDENT' }]);
    vi.mocked(handoverSystemAdmin).mockRejectedValue({ response: { status: 422, data: { message: 'The successor account is not active.' } } });
    render(<AdminHandoverDrawer admin={admin} onClose={vi.fn()} onDone={vi.fn()} />);

    fireEvent.click(await screen.findByRole('radio', { name: /Ana Reyes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The successor account is not active.');
  });
});
