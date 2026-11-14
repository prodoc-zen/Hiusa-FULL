import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceBanner from './WorkspaceBanner';
import { SUB_ACCOUNT_KEY } from '../../utils/subAccountStore';

const authMocks = vi.hoisted(() => ({ getAccountProfiles: vi.fn(), switchAccountProfile: vi.fn() }));

vi.mock('../../services/authService', () => authMocks);
vi.mock('../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: vi.fn().mockResolvedValue({ data: { data: [] } }) }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const renderBanner = () => render(<MemoryRouter initialEntries={['/dashboard/officer']}><WorkspaceBanner /><Where /></MemoryRouter>);

const profile = (id, role, name, extra = {}) => ({ id, role, account_status: 'active', organization: { id: id * 10, name, is_active: true, organization_type: role === 'STUDENT' ? 'COLLEGE' : 'STUDENT_ORGANIZATION' }, ...extra });

describe('WorkspaceBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('tells a dean which organization they are viewing and brings them back to the college', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 12, name: 'Computing Society' }));
    renderBanner();

    expect(screen.getByText('Computing Society')).toBeInTheDocument();
    expect(screen.getByText(/Viewing/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to my college' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/department-head');
    expect(sessionStorage.getItem(SUB_ACCOUNT_KEY)).toBeNull();
    expect(screen.queryByText(/Viewing/)).not.toBeInTheDocument();
  });

  it('shows nothing for a dean with no space open', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    renderBanner();

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('shows an officer the organization they are in and switches back to the student profile', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', active_profile_id: 2 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 2, profiles: [profile(1, 'STUDENT', 'College of Computing'), profile(2, 'SBO_OFFICER', 'Computing Society', { position_title: 'Treasurer' })] } });
    authMocks.switchAccountProfile.mockRejectedValue(new Error('offline'));
    renderBanner();

    expect(await screen.findByText('Computing Society')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveTextContent('Officer workspace · Computing Society · Treasurer');
    fireEvent.click(screen.getByRole('button', { name: 'Back to my account' }));

    await waitFor(() => expect(authMocks.switchAccountProfile).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch profile. Try again.');
  });

  it('shows nothing for an officer who has no student side to return to', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', active_profile_id: 2 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 2, profiles: [profile(2, 'ADMIN', 'Computing Society')] } });
    renderBanner();

    await waitFor(() => expect(authMocks.getAccountProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument();
  });

  it('names an Admin workspace with the organization and no position', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', active_profile_id: 3 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 3, profiles: [profile(1, 'STUDENT', 'College of Computing'), profile(3, 'ADMIN', 'Arts Guild')] } });
    renderBanner();

    expect(await screen.findByRole('complementary')).toHaveTextContent(/^Admin workspace · Arts Guild\s*Back to my account$/);
  });

  it('keeps a long organization name on one line with an ellipsis and the full name on hover', async () => {
    const long = 'Association of Computer Science and Information Technology Students of the Philippines';
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', active_profile_id: 3 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 3, profiles: [profile(1, 'STUDENT', 'College of Computing'), profile(3, 'ADMIN', long)] } });
    renderBanner();

    const name = await screen.findByText(long);
    expect(name).toHaveAttribute('title', long);
    expect(name).toHaveClass('truncate');
  });

  const studentProfile = (id, name, type) => ({ id, role: 'STUDENT', account_status: 'active', organization: { id: id * 10, name, is_active: true, organization_type: type } });
  const college = studentProfile(1, 'College of Computer Studies', 'COLLEGE');
  const psits = studentProfile(2, 'PSITS', 'STUDENT_ORGANIZATION');

  it('shows nothing for a student who holds only the college profile', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', active_profile_id: 1 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [college] } });
    renderBanner();

    await waitFor(() => expect(authMocks.getAccountProfiles).toHaveBeenCalled());
    expect(screen.queryByText(/Viewing/)).not.toBeInTheDocument();
  });

  it('names the organization a student is on and brings them back to the college profile', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', active_profile_id: 2 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 2, profiles: [college, psits] } });
    authMocks.switchAccountProfile.mockRejectedValue(new Error('offline'));
    renderBanner();

    expect(await screen.findByText('PSITS')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toHaveTextContent('Member workspace · PSITS');
    fireEvent.click(screen.getByRole('button', { name: 'Back to my account' }));

    await waitFor(() => expect(authMocks.switchAccountProfile).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch profile. Try again.');
  });

  it('labels the student home as the Student workspace when the student has an organization profile too', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', active_profile_id: 1 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [college, psits] } });
    renderBanner();

    expect(await screen.findByText('Student workspace')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to/ })).not.toBeInTheDocument();
  });
});
