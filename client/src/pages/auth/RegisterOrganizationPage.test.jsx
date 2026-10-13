import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';
import RegisterOrganizationPage from './RegisterOrganizationPage';
import { getApplicationRequirements, getRegistrationColleges, submitOrganizationApplication } from '../../services/organizationApplicationService';

vi.mock('../../services/organizationApplicationService', () => ({ getRegistrationColleges: vi.fn(), getApplicationRequirements: vi.fn(), submitOrganizationApplication: vi.fn() }));

describe('Public organization onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegistrationColleges.mockResolvedValue({ data: [{ id: 2, name: 'College of Computing' }] });
    getApplicationRequirements.mockResolvedValue({ data: { academic_semester: { academic_year: '2026-2027', number: 1 }, requirements: [{ id: 7, name: 'Constitution' }] } });
  });

  it('offers registration and login from the landing page', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Register an organization' })).toHaveAttribute('href', '/register-organization');
    expect(screen.getAllByRole('link', { name: 'Log in' })).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('From your first application to everyday campus work.');
    expect(screen.getByRole('img', { name: 'Students together outside a university building' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Two students reviewing a document together' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How registration works' })).toBeInTheDocument();
    expect(screen.queryByText(/study objectives/i)).not.toBeInTheDocument();
  });

  it.each([
    ['Register an organization', 'Registration form'],
    ['Log in', 'Login form'],
  ])('opens %s from the landing page', (label, destination) => {
    render(<MemoryRouter initialEntries={['/']}><Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/register-organization" element={<p>Registration form</p>} />
      <Route path="/login" element={<p>Login form</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getAllByRole('link', { name: label })[0]);
    expect(screen.getByText(destination)).toBeInTheDocument();
  });

  it('submits applicant name email and position and explains verification', async () => {
    submitOrganizationApplication.mockResolvedValue({ data: { message: 'Check your email to verify the application.' } });
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    await screen.findByRole('option', { name: 'College of Computing' });
    for (const [label, value] of [['Organization name', 'Computing Council'], ['Organization code', 'CC'], ['First name', 'Alex'], ['Last name', 'Rivera'], ['School ID', '12345678'], ['Email', 'alex@example.test'], ['Position', 'President'], ['College', '2']]) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    }
    const document = new File(['%PDF-1.4'], 'constitution.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/^Constitution/), { target: { files: [document] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit application' }).closest('form'));
    await waitFor(() => expect(submitOrganizationApplication).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Alex', last_name: 'Rivera', email: 'alex@example.test', position_title: 'President', college_id: '2' }), { 7: document }));
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

  it('does not offer submission until the SAO opens requirements', async () => {
    getApplicationRequirements.mockResolvedValue({ data: { academic_semester: null, requirements: [] } });
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    expect(await screen.findByText('No registration requirements are open. The SAO must activate a semester first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument();
  });
});
