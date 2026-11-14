import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAccessDeniedNotice from './useAccessDeniedNotice';

const mocks = vi.hoisted(() => ({ getAccountProfiles: vi.fn(), switchAccountProfile: vi.fn(), info: vi.fn() }));
vi.mock('../services/authService', () => ({ getAccountProfiles: mocks.getAccountProfiles, switchAccountProfile: mocks.switchAccountProfile }));
vi.mock('../lib/notify', () => ({ default: { info: mocks.info } }));

function Probe() {
  useAccessDeniedNotice();
  return <output data-testid="state">{JSON.stringify(useLocation().state)}</output>;
}

const renderDenied = (denied = { path: '/dashboard/admin/users', allowedRoles: ['ADMIN'] }) => render(
  <MemoryRouter initialEntries={[{ pathname: '/dashboard/student', state: denied ? { accessDenied: denied } : null }]}><Probe /></MemoryRouter>,
);

const profile = (id, role, name, extra = {}) => ({ id, role, account_status: 'active', organization: { id: id * 10, name, is_active: true, organization_type: role === 'STUDENT' ? 'COLLEGE' : 'STUDENT_ORGANIZATION' }, ...extra });

describe('useAccessDeniedNotice', () => {
  const assign = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', active_profile_id: 1 }));
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
  });

  afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: originalLocation }));

  it('says the page belongs to another of their workspaces and offers a Switch that opens it', async () => {
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [profile(1, 'STUDENT', 'College of Computing'), profile(2, 'ADMIN', 'Arts Guild')] } });
    mocks.switchAccountProfile.mockResolvedValue({ data: { user: { role: 'ADMIN', active_profile_id: 2 } } });
    renderDenied();

    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1));
    const [message, options] = mocks.info.mock.calls[0];
    expect(message).toBe('That page belongs to your Arts Guild Admin workspace.');
    expect(options.action.label).toBe('Switch');

    await act(async () => { await options.action.onClick(); });

    expect(mocks.switchAccountProfile).toHaveBeenCalledWith(2);
    expect(JSON.parse(localStorage.getItem('user'))).toEqual({ role: 'ADMIN', active_profile_id: 2 });
    expect(assign).toHaveBeenCalledWith('/dashboard/admin/users');
  });

  it('only offers a profile whose role may open the page', async () => {
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [
      profile(1, 'STUDENT', 'College of Computing'),
      profile(2, 'SBO_OFFICER', 'Computing Society'),
      profile(3, 'ADMIN', 'Arts Guild', { account_status: 'inactive' }),
    ] } });
    renderDenied();

    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1));
    expect(mocks.info).toHaveBeenCalledWith('You do not have access to that page.');
  });

  it('gives the plain notice when they own no profile that can open it', async () => {
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [profile(1, 'STUDENT', 'College of Computing')] } });
    renderDenied();

    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('You do not have access to that page.'));
    expect(mocks.info).toHaveBeenCalledTimes(1);
  });

  it('gives the plain notice when their profiles cannot be read', async () => {
    mocks.getAccountProfiles.mockRejectedValue(new Error('offline'));
    renderDenied();

    await waitFor(() => expect(mocks.info).toHaveBeenCalledWith('You do not have access to that page.'));
  });

  it('says nothing on an ordinary arrival, and only once after a denial', async () => {
    renderDenied(null);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.getAccountProfiles).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it('clears the denial from the location so a reload does not repeat the notice', async () => {
    mocks.getAccountProfiles.mockResolvedValue({ data: { active_profile_id: 1, profiles: [profile(1, 'STUDENT', 'College of Computing')] } });
    renderDenied();

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'));
    expect(mocks.info).toHaveBeenCalledTimes(1);
  });
});
