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

const profile = (id, role, name) => ({ id, role, account_status: 'active', organization: { id: id * 10, name, is_active: true, organization_type: role === 'STUDENT' ? 'COLLEGE' : 'STUDENT_ORGANIZATION' } });

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

    fireEvent.click(screen.getByRole('button', { name: 'Back to mine' }));

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
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 2, profiles: [profile(1, 'STUDENT', 'College of Computing'), profile(2, 'SBO_OFFICER', 'Computing Society')] } });
    authMocks.switchAccountProfile.mockRejectedValue(new Error('offline'));
    renderBanner();

    expect(await screen.findByText('Computing Society')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to mine' }));

    await waitFor(() => expect(authMocks.switchAccountProfile).toHaveBeenCalledWith(1));
  });

  it('shows nothing for an officer who has no student side to return to', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', active_profile_id: 2 }));
    authMocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 2, profiles: [profile(2, 'ADMIN', 'Computing Society')] } });
    renderBanner();

    await waitFor(() => expect(authMocks.getAccountProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Back to mine' })).not.toBeInTheDocument();
  });

  it('shows nothing while a student is on their own account', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    renderBanner();

    expect(authMocks.getAccountProfiles).not.toHaveBeenCalled();
    expect(screen.queryByText(/Viewing/)).not.toBeInTheDocument();
  });
});
