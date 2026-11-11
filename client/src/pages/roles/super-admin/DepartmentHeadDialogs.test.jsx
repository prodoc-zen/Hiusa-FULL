import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ManageDepartmentHeadModal } from './DepartmentHeadDialogs';

vi.mock('../../../services/systemAdministrationService', () => ({
  inviteDepartmentHead: vi.fn(),
  resetDepartmentHeadPassword: vi.fn(),
  updateDepartmentHead: vi.fn(),
}));

const head = { school_id: 940001, name: 'Dr. Lena Ortiz', first_name: 'Lena', last_name: 'Ortiz', email: 'lena@example.test', account_status: 'active' };

describe('Department Head reset confirmation', () => {
  it('describes a one-time link and does not promise an email while mail is off', () => {
    render(<ManageDepartmentHeadModal college={{ name: 'College of Computing' }} head={head} onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send password reset' }));

    const dialog = screen.getByRole('dialog', { name: 'Send password reset' });
    expect(within(dialog).getByText(/one-time reset link/i)).toHaveTextContent(/shown to you once to hand over/i);
    expect(within(dialog).getByText(/one-time reset link/i)).toHaveTextContent(/emailed only when email is turned on/i);
    expect(within(dialog).queryByText(/will be sent/i)).not.toBeInTheDocument();
  });
});
