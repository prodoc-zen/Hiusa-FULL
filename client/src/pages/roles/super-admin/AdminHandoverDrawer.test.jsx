import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHandoverDrawer from './AdminHandoverDrawer';
import { handoverSystemAdmin } from '../../../services/systemAdministrationService';
import { searchPeople } from '../../../services/peopleService';

vi.mock('../../../services/systemAdministrationService', () => ({ handoverSystemAdmin: vi.fn() }));
vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const admin = { school_id: 900001, first_name: 'Marco', last_name: 'Dela Cruz', position_title: 'President', organization_id: 1, organization: { id: 1, name: 'Computer Science Society' } };
const juan = { school_id: 2100142, name: 'Juan Dela Vega', email: 'juan@example.edu', program: 'BSCS', role: 'SBO_OFFICER', organizations: [] };

async function pick(text, person) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Who takes over?' }), { target: { value: text } });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(person.name) }));
}

describe('AdminHandoverDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchPeople).mockResolvedValue([juan]);
  });

  it('hands the role to a member found by name, scoped to that organization', async () => {
    const onDone = vi.fn();
    vi.mocked(handoverSystemAdmin).mockResolvedValue({ successor: { first_name: 'Juan', last_name: 'Dela Vega' } });
    render(<AdminHandoverDrawer admin={admin} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByText(/deactivated, not deleted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand over' })).toBeDisabled();
    await pick('juan', juan);
    expect(searchPeople).toHaveBeenCalledWith({ q: 'juan', scope: 'organization', organization_id: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(handoverSystemAdmin).toHaveBeenCalledWith(900001, { mode: 'existing', successor_school_id: 2100142 });
  });

  it('no longer asks for a school ID or an initial password', () => {
    render(<AdminHandoverDrawer admin={admin} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.queryByLabelText(/school id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'New account' })).not.toBeInTheDocument();
  });

  it('keeps the drawer open with the server reason when a successor is refused', async () => {
    vi.mocked(handoverSystemAdmin).mockRejectedValue({ response: { status: 422, data: { message: 'The successor account is not active.' } } });
    render(<AdminHandoverDrawer admin={admin} onClose={vi.fn()} onDone={vi.fn()} />);

    await pick('juan', juan);
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The successor account is not active.');
  });
});
