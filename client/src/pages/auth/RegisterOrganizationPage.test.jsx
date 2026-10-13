import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';
import RegisterOrganizationPage from './RegisterOrganizationPage';
import { getRegistrationColleges, submitOrganizationApplication } from '../../services/organizationApplicationService';

vi.mock('../../services/organizationApplicationService', () => ({ getRegistrationColleges: vi.fn(), submitOrganizationApplication: vi.fn() }));

describe('Public organization onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegistrationColleges.mockResolvedValue({ data: [{ id: 2, name: 'College of Computing' }] });
  });

  it('offers registration and login from the landing page', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Register an organization' })).toHaveAttribute('href', '/register-organization');
    expect(screen.getAllByRole('link', { name: 'Log in' })).toHaveLength(2);
    expect(screen.queryByText(/study objectives/i)).not.toBeInTheDocument();
  });

  it('submits applicant name email and position and explains verification', async () => {
    submitOrganizationApplication.mockResolvedValue({ data: { message: 'Check your email to verify the application.' } });
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    await screen.findByRole('option', { name: 'College of Computing' });
    for (const [label, value] of [['Organization name', 'Computing Council'], ['Organization code', 'CC'], ['First name', 'Alex'], ['Last name', 'Rivera'], ['School ID', '12345678'], ['Email', 'alex@example.test'], ['Position', 'President'], ['College', '2']]) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(submitOrganizationApplication).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.test', position_title: 'President', college_id: '2' })));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
  });

  it('shows Laravel validation errors and leaves the form available for correction', async () => {
    submitOrganizationApplication.mockRejectedValue({ response: { status: 422, data: { message: 'Application invalid.', errors: { email: ['Use the applicant email.'] } } } });
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    await screen.findByRole('option', { name: 'College of Computing' });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit application' }).closest('form'));
    expect((await screen.findAllByText('Use the applicant email.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
  });
});
