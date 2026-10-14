import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';
import RegisterOrganizationPage from './RegisterOrganizationPage';
import { getApplicationRequirements, getRegistrationColleges, getRejectedApplication, requestApplicationEditLink, requestApplicationTrackingLink, resubmitRejectedApplication, submitOrganizationApplication } from '../../services/organizationApplicationService';
import RequestApplicationEditLinkPage from './RequestApplicationEditLinkPage';

const sampleMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../utils/openProtectedFile', () => sampleMocks);

vi.mock('../../services/organizationApplicationService', () => ({ getRegistrationColleges: vi.fn(), getApplicationRequirements: vi.fn(), getRejectedApplication: vi.fn(), requestApplicationEditLink: vi.fn(), requestApplicationTrackingLink: vi.fn(), resubmitRejectedApplication: vi.fn(), submitOrganizationApplication: vi.fn() }));

describe('Public organization onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegistrationColleges.mockResolvedValue({ data: [{ id: 2, name: 'College of Computing' }] });
    getApplicationRequirements.mockResolvedValue({ data: { academic_semester: { academic_year: '2026-2027', number: 1 }, requirements: [{ id: 7, name: 'Constitution' }] } });
  });

  it('offers registration and login from the landing page', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Register an organization' })).toHaveAttribute('href', '/register-organization');
    expect(screen.getByRole('link', { name: /Already applied\? Track your application/ })).toHaveAttribute('href', '/track-organization');
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

  it('shows and checks the SAO file type for each registration document', async () => {
    getApplicationRequirements.mockResolvedValue({ data: { academic_semester: { academic_year: '2026-2027', number: 1 }, requirements: [{ id: 7, name: 'Portrait', allowed_extensions: ['png'] }] } });
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    const input = await screen.findByLabelText(/^Portrait/);
    expect(input).toHaveAttribute('accept', '.png');
    expect(screen.getByText('Accepted: PNG')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'portrait.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText('Accepted file types: PNG.')).toBeInTheDocument();
  });

  it('opens an attached sample from a public registration requirement', async () => {
    getApplicationRequirements.mockResolvedValue({ data: { academic_semester: { academic_year: '2026-2027', number: 1 }, requirements: [{ id: 7, name: 'Constitution', template_original_name: 'sample.pdf' }] } });
    sampleMocks.openProtectedFile.mockResolvedValue();
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'View sample format' }));
    await waitFor(() => expect(sampleMocks.openProtectedFile).toHaveBeenCalledWith('/organization-applications/requirements/7/template'));
  });

  it('does not offer submission until the SAO opens requirements', async () => {
    getApplicationRequirements.mockResolvedValue({ data: { academic_semester: null, requirements: [] } });
    render(<MemoryRouter><RegisterOrganizationPage /></MemoryRouter>);
    expect(await screen.findByText('No registration requirements are open. The SAO must activate a semester first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument();
  });

  it('opens the emailed edit link with existing details and keeps unchanged documents', async () => {
    getRejectedApplication.mockResolvedValue({ data: {
      application: { id: 8, college_id: 2, name: 'Computing Council', acronym: 'CC', first_name: 'Alex', last_name: 'Rivera', school_id: 12345678, email: 'alex@example.test', position_title: 'President', remarks: 'Replace the wrong format.' },
      academic_semester: { academic_year: '2026-2027', number: 1 },
      requirements: [{ id: 7, name: 'Constitution', current_file: { name: 'constitution.pdf', view_url: '/organization-applications/8/edit/documents/3?signature=example' } }],
    } });
    resubmitRejectedApplication.mockResolvedValue({ data: { message: 'Application resubmitted for Department Head endorsement.' } });
    sampleMocks.openProtectedFile.mockResolvedValue();
    render(<MemoryRouter initialEntries={['/register-organization/edit/8?expires=123&signature=abc&token=private']}><Routes>
      <Route path="/register-organization/edit/:applicationId" element={<RegisterOrganizationPage />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Edit your application' })).toBeInTheDocument();
    expect(screen.getByText('Replace the wrong format.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Organization name/)).toHaveValue('Computing Council');
    expect(screen.getByText('alex@example.test')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Constitution/)).not.toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: 'View constitution.pdf' }));
    expect(sampleMocks.openProtectedFile).toHaveBeenCalledWith('/organization-applications/8/edit/documents/3?signature=example');
    fireEvent.change(screen.getByLabelText(/^Organization name/), { target: { value: 'Computing and Design Council' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Resubmit application' }).closest('form'));

    await waitFor(() => expect(resubmitRejectedApplication).toHaveBeenCalledWith('8', 'expires=123&signature=abc&token=private', expect.objectContaining({ name: 'Computing and Design Council', college_id: 2 }), {}));
    expect(await screen.findByRole('status')).toHaveTextContent('Application resubmitted for Department Head endorsement.');
  });

  it('lets a rejected applicant request a fresh link using their original details', async () => {
    requestApplicationEditLink.mockResolvedValue({ data: { message: 'If those details match a rejected application, we will email a private edit link.' } });
    render(<MemoryRouter><RequestApplicationEditLinkPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/^School ID/), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'alex@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Organization name/), { target: { value: 'Computing Council' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Email edit link' }).closest('form'));
    await waitFor(() => expect(requestApplicationEditLink).toHaveBeenCalledWith({ school_id: '12345678', email: 'alex@example.test', organization_name: 'Computing Council' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If those details match a rejected application');
  });

  it('lets an applicant request a private status link from the public tracker', async () => {
    requestApplicationTrackingLink.mockResolvedValue({ data: { message: 'If those details match an application, we will email a private tracking link.' } });
    render(<MemoryRouter><RequestApplicationEditLinkPage tracking /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/^School ID/), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'alex@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Organization name/), { target: { value: 'Computing Council' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Email tracking link' }).closest('form'));
    await waitFor(() => expect(requestApplicationTrackingLink).toHaveBeenCalledWith({ school_id: '12345678', email: 'alex@example.test', organization_name: 'Computing Council' }));
    expect(await screen.findByRole('status')).toHaveTextContent('private tracking link');
  });
});
