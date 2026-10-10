import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemCollegesPage from './SystemCollegesPage';

const mocks = vi.hoisted(() => ({
  getSystemColleges: vi.fn(), uploadSystemCollegeLogo: vi.fn(),
  createDepartmentHead: vi.fn(), updateDepartmentHead: vi.fn(), resetDepartmentHeadPassword: vi.fn(),
}));
vi.mock('../../../services/systemAdministrationService', () => mocks);

const renderPage = () => render(<MemoryRouter initialEntries={['/dashboard/super-admin/colleges']}><SystemCollegesPage /></MemoryRouter>);

describe('SystemCollegesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemColleges.mockResolvedValue([{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2 }]);
  });

  it('is view-only: no add, edit or delete controls', async () => {
    renderPage();
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
    expect(screen.getByText(/COA · 2 organizations/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add college/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByText("Assign each college's Department Head, open its organizations and update its logo.")).toBeInTheDocument();
  });

  it('has one h1, from the shared header, with a breadcrumb', async () => {
    renderPage();
    await screen.findByText('College of Arts');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Colleges');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('links each college to its organizations', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'View organizations of College of Arts' });
    expect(link).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=active&search=College%20of%20Arts');
  });

  it('uploads a logo and shows it', async () => {
    mocks.uploadSystemCollegeLogo.mockResolvedValue({ id: 3, logo_url: 'https://cdn.test/logo.png' });
    const { container } = renderPage();
    await screen.findByText('College of Arts');
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.uploadSystemCollegeLogo).toHaveBeenCalledWith(3, file));
    expect(await screen.findByRole('status')).toHaveTextContent('Logo updated');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/logo.png');
  });

  it('shows the upload error', async () => {
    mocks.uploadSystemCollegeLogo.mockRejectedValue({ response: { status: 422, data: { message: 'The logo must be an image.' } } });
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Logo file for College of Arts'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The logo must be an image.');
  });

  it('shows an error with retry', async () => {
    mocks.getSystemColleges.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('College of Arts')).toBeInTheDocument();
  });

  it('shows empty and filtered states', async () => {
    mocks.getSystemColleges.mockResolvedValueOnce([]);
    const { unmount } = renderPage();
    expect(await screen.findByText('No colleges found')).toBeInTheDocument();
    unmount();
    renderPage();
    await screen.findByText('College of Arts');
    fireEvent.change(screen.getByLabelText('Search colleges'), { target: { value: 'zzz' } });
    expect(screen.getByText('No colleges match your search.')).toBeInTheDocument();
  });

  it('labels the search field with visible text', async () => {
    renderPage();
    await screen.findByText('College of Arts');
    expect(screen.getByLabelText('Search colleges').labels[0]).toHaveTextContent('Search colleges');
  });

  describe('Department Head', () => {
    const head = (overrides = {}) => ({ school_id: 940001, name: 'Ramon Castillo', first_name: 'Ramon', last_name: 'Castillo', email: 'dean@example.edu', account_status: 'active', ...overrides });
    const college = (department_head) => [{ id: 3, name: 'College of Arts', code: 'COA', is_active: true, organizations_count: 2, department_head }];
    const withHead = (overrides) => mocks.getSystemColleges.mockResolvedValue(college(head(overrides)));
    const withoutHead = () => mocks.getSystemColleges.mockResolvedValue(college(null));
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const fillAssignment = (overrides = {}) => {
      const values = { school_id: '20269001', first_name: 'Ramon', last_name: 'Castillo', email: 'Ramon@Example.edu ', password: 'Dean2026!Pass', password_confirmation: 'Dean2026!Pass', ...overrides };
      type(/School ID/, values.school_id);
      type(/First name/, values.first_name);
      type(/Last name/, values.last_name);
      type(/^Email/, values.email);
      type(/^Password/, values.password);
      type(/Confirm password/, values.password_confirmation);
    };
    const openAssignment = async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Assign Department Head/ }));
      return screen.findByRole('dialog', { name: 'Assign Department Head' });
    };
    const openManagement = async () => {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Manage Department Head/ }));
      return screen.findByRole('dialog', { name: 'Manage Department Head' });
    };

    it('says so when a college has no Department Head and offers the single primary action', async () => {
      withoutHead();
      renderPage();

      expect(await screen.findByText('No Department Head yet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Assign Department Head/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Manage Department Head/ })).not.toBeInTheDocument();
    });

    it('shows the head with a text status badge and a Manage action', async () => {
      withHead();
      renderPage();

      expect(await screen.findByText('Ramon Castillo')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('dean@example.edu')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Manage Department Head/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Assign Department Head/ })).not.toBeInTheDocument();
    });

    it('offers a replacement when the only head is inactive, and keeps Manage for reactivation', async () => {
      withHead({ account_status: 'inactive' });
      renderPage();

      expect(await screen.findByText('Inactive')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Assign Department Head/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Manage Department Head/ })).toBeInTheDocument();
    });

    it('validates the assignment per field and focuses the first invalid control', async () => {
      withoutHead();
      const dialog = await openAssignment();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      expect(await within(dialog).findByText('Enter the School ID.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter the first name.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter the last name.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter the email address.')).toBeInTheDocument();
      expect(within(dialog).getByText('Enter an initial password.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/School ID/)).toHaveFocus());
      expect(mocks.createDepartmentHead).not.toHaveBeenCalled();

      fillAssignment({ password_confirmation: 'different' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      expect(await within(dialog).findByText('The password confirmation does not match.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/Confirm password/)).toHaveFocus());
      expect(mocks.createDepartmentHead).not.toHaveBeenCalled();
    });

    it('assigns a head and shows them on the card', async () => {
      withoutHead();
      mocks.createDepartmentHead.mockResolvedValue({ school_id: 20269001, first_name: 'Ramon', last_name: 'Castillo', email: 'ramon@example.edu', account_status: 'active' });
      const dialog = await openAssignment();
      fillAssignment();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));

      await waitFor(() => expect(mocks.createDepartmentHead).toHaveBeenCalledWith(3, {
        school_id: 20269001, first_name: 'Ramon', last_name: 'Castillo', email: 'ramon@example.edu', password: 'Dean2026!Pass', password_confirmation: 'Dean2026!Pass',
      }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('status')).toHaveTextContent('Ramon Castillo is now the Department Head of College of Arts.');
      expect(screen.getByText('ramon@example.edu')).toBeInTheDocument();
      expect(screen.queryByText('No Department Head yet')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Manage Department Head/ })).toBeInTheDocument();
    });

    it('shows server field errors under the field and a conflict as a form message', async () => {
      withoutHead();
      const dialog = await openAssignment();
      fillAssignment();

      mocks.createDepartmentHead.mockRejectedValueOnce({ response: { status: 422, data: { message: 'invalid', errors: { email: ['The email has already been taken.'] } } } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));
      expect(await within(dialog).findByText('The email has already been taken.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/^Email/)).toHaveFocus());

      mocks.createDepartmentHead.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Assign Department Head' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This college already has an active Department Head. Deactivate the current one first.');
      expect(screen.getByRole('dialog', { name: 'Assign Department Head' })).toBeInTheDocument();
    });

    it('edits the head details and only enables Save once something changed', async () => {
      withHead();
      mocks.updateDepartmentHead.mockResolvedValue({ school_id: 940001, first_name: 'Ramon', last_name: 'Castillo', email: 'new@example.edu', account_status: 'active' });
      const dialog = await openManagement();
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();

      type(/^Email/, ' New@Example.edu ');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mocks.updateDepartmentHead).toHaveBeenCalledWith(940001, { first_name: 'Ramon', last_name: 'Castillo', email: 'new@example.edu' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('new@example.edu')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Department Head details updated.');
    });

    it('deactivates only after a confirmation that states the consequence', async () => {
      withHead();
      mocks.updateDepartmentHead.mockResolvedValue({ school_id: 940001, first_name: 'Ramon', last_name: 'Castillo', email: 'dean@example.edu', account_status: 'inactive' });
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

      const confirmation = await screen.findByRole('dialog', { name: 'Deactivate Department Head' });
      expect(within(confirmation).getByText(/They will no longer be able to sign in/)).toBeInTheDocument();
      expect(mocks.updateDepartmentHead).not.toHaveBeenCalled();
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Deactivate' }));

      await waitFor(() => expect(mocks.updateDepartmentHead).toHaveBeenCalledWith(940001, { account_status: 'inactive' }));
      expect(await screen.findByText('Inactive')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Assign Department Head/ })).toBeInTheDocument();
    });

    it('returns to the details when the confirmation is cancelled', async () => {
      withHead();
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Deactivate Department Head' });

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));

      expect(await screen.findByRole('dialog', { name: 'Manage Department Head' })).toBeInTheDocument();
      expect(mocks.updateDepartmentHead).not.toHaveBeenCalled();
    });

    it('reactivates an inactive head and shows the conflict when another head is active', async () => {
      withHead({ account_status: 'inactive' });
      mocks.updateDepartmentHead.mockRejectedValueOnce({ response: { status: 409, data: { message: 'This college already has an active Department Head. Deactivate the current one first.' } } });
      await openManagement();
      expect(screen.getByRole('button', { name: 'Send password reset' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Reactivate Department Head' });
      expect(within(confirmation).getByText(/They will be able to sign in again/)).toBeInTheDocument();

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Reactivate' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('This college already has an active Department Head. Deactivate the current one first.');
      expect(screen.getByRole('dialog', { name: 'Manage Department Head' })).toBeInTheDocument();
    });

    it('sends a password reset after a confirmation', async () => {
      withHead();
      mocks.resetDepartmentHeadPassword.mockResolvedValue({ message: 'Password reset instructions were sent to the Department Head email address.' });
      await openManagement();
      fireEvent.click(screen.getByRole('button', { name: 'Send password reset' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Send password reset' });
      expect(mocks.resetDepartmentHeadPassword).not.toHaveBeenCalled();

      fireEvent.click(within(confirmation).getByRole('button', { name: 'Send reset link' }));

      await waitFor(() => expect(mocks.resetDepartmentHeadPassword).toHaveBeenCalledWith(940001));
      expect(await screen.findByRole('status')).toHaveTextContent('Password reset instructions were sent');
    });
  });
});
