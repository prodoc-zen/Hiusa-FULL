import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountProfiles, getCurrentUser } from '../services/authService';
import { ROLE_HOME_PATHS } from '../components/layout/navigation';
import { getCollegeOrganizations } from '../services/collegeOrganizationService';
import useWorkspaces from './useWorkspaces';

vi.mock('../services/authService', () => ({
  getAccountProfiles: vi.fn(),
  getCurrentUser: vi.fn(),
  switchAccountProfile: vi.fn(),
}));
vi.mock('../services/collegeOrganizationService', () => ({
  getCollegeOrganizations: vi.fn(() => Promise.resolve({ data: [] })),
}));

const student = { id: 1, role: 'STUDENT', account_status: 'active', organization: { id: 10, name: 'College', is_active: true, organization_type: 'COLLEGE' } };
const officer = { id: 2, role: 'SBO_OFFICER', account_status: 'active', organization: { id: 20, name: 'Rehearsal Society', is_active: true, organization_type: 'STUDENT_ORGANIZATION' } };
const studentOnly = { data: { profiles: [student], active_profile_id: 1 } };
const studentAndOfficer = { data: { profiles: [student, officer], active_profile_id: 1 } };

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const fire = (...events) => act(() => {
  events.forEach(([target, name]) => target.dispatchEvent(new Event(name)));
});
const focus = [window, 'focus'];
const visibility = [document, 'visibilitychange'];

describe('useWorkspaces after access is granted to someone already signed in', () => {
  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockReset();
    getCollegeOrganizations.mockReset();
    getCollegeOrganizations.mockResolvedValue({ data: [] });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    localStorage.clear();
    delete document.visibilityState;
  });

  it('picks up the new organization when the person comes back to the tab', async () => {
    getAccountProfiles.mockResolvedValueOnce(studentOnly);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getAccountProfiles).toHaveBeenCalledTimes(1));
    expect(result.current.spaces).toEqual([]);

    getAccountProfiles.mockResolvedValueOnce(studentAndOfficer);
    act(() => { window.dispatchEvent(new Event('focus')); });

    await waitFor(() => expect(result.current.spaces.map((space) => space.label)).toContain('Rehearsal Society'));
  });

  it('stops listening once the hook is gone', async () => {
    getAccountProfiles.mockResolvedValue({ data: { profiles: [student], active_profile_id: 1 } });
    const { unmount } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getAccountProfiles).toHaveBeenCalledTimes(1));
    unmount();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(getAccountProfiles).toHaveBeenCalledTimes(1);
  });

  it('does not strand loading when the tab regains focus during the first load', async () => {
    const first = deferred();
    getAccountProfiles.mockReturnValueOnce(first.promise);
    getAccountProfiles.mockResolvedValue(studentOnly);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loading).toBe(true));

    fire(focus);
    await act(async () => { first.resolve(studentOnly); });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles).toEqual([student]);
  });

  it('makes one request when visibilitychange and focus fire together', async () => {
    getAccountProfiles.mockResolvedValue(studentOnly);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getAccountProfiles).toHaveBeenCalledTimes(1);

    fire(visibility, focus);

    await waitFor(() => expect(getAccountProfiles).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(getAccountProfiles).toHaveBeenCalledTimes(2);
  });

  it('picks up the new organization on visibilitychange alone', async () => {
    getAccountProfiles.mockResolvedValueOnce(studentOnly);
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getAccountProfiles.mockResolvedValueOnce(studentAndOfficer);
    fire(visibility);

    await waitFor(() => expect(result.current.spaces.map((space) => space.label)).toContain('Rehearsal Society'));
  });

  it('shares one request between two mounted hooks on a tab return', async () => {
    getAccountProfiles.mockResolvedValue(studentOnly);
    const topBar = renderHook(() => useWorkspaces());
    const banner = renderHook(() => useWorkspaces());
    await waitFor(() => expect(topBar.result.current.loading).toBe(false));
    await waitFor(() => expect(banner.result.current.loading).toBe(false));
    getAccountProfiles.mockClear();

    getAccountProfiles.mockResolvedValueOnce(studentAndOfficer);
    fire(focus);
    await act(async () => {});

    expect(getAccountProfiles).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(topBar.result.current.spaces).toHaveLength(2));
    await waitFor(() => expect(banner.result.current.spaces).toHaveLength(2));
  });

  it('never hands an unanswered request from one sign-in to the next person', async () => {
    localStorage.setItem('auth_token', 'token-a');
    const slowA = deferred();
    getAccountProfiles.mockReturnValueOnce(slowA.promise);
    const a = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getAccountProfiles).toHaveBeenCalledTimes(1));
    a.unmount();

    localStorage.setItem('auth_token', 'token-b');
    getAccountProfiles.mockResolvedValueOnce(studentOnly);
    const b = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getAccountProfiles).toHaveBeenCalledTimes(2));
    await act(async () => { slowA.resolve(studentAndOfficer); });

    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current.profiles).toEqual([student]);
  });

  it('shows a college organization approved while a dean is signed in', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'DEPARTMENT_HEAD' }));
    getAccountProfiles.mockResolvedValue({ data: { profiles: [], active_profile_id: null } });
    getCollegeOrganizations.mockResolvedValueOnce({ data: [] });
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getCollegeOrganizations).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current.spaces).toEqual([]);

    getCollegeOrganizations.mockResolvedValueOnce({ data: [{ id: 20, name: 'Rehearsal Society', members_count: 4 }] });
    fire(focus);

    await waitFor(() => expect(result.current.spaces.map((space) => space.label)).toContain('Rehearsal Society'));
  });
});

describe('useWorkspaces when the role changes while the person is signed in', () => {
  const assign = vi.fn();
  const originalLocation = window.location;
  const profilesFor = (role, id = 1) => ({ data: { profiles: [{ ...student, id, role }], active_profile_id: id } });

  beforeEach(() => {
    getAccountProfiles.mockReset();
    getCurrentUser.mockReset();
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    localStorage.clear();
    delete document.visibilityState;
  });

  it('refreshes the stored user and sends the tab to the new role home', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockResolvedValue(profilesFor('ADMIN'));
    getCurrentUser.mockImplementation(async () => {
      const user = { school_id: 5, role: 'ADMIN' };
      localStorage.setItem('user', JSON.stringify(user));
      return user;
    });

    renderHook(() => useWorkspaces());

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(ROLE_HOME_PATHS.ADMIN);
    expect(JSON.parse(localStorage.getItem('user')).role).toBe('ADMIN');
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the stored role already matches the active profile', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockResolvedValue(profilesFor('STUDENT'));

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.profiles).toHaveLength(1));
    await act(async () => {});

    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('leaves the tab alone, and still returns the profiles, when the user cannot be re-read', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockResolvedValue(profilesFor('ADMIN'));
    getCurrentUser.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.profiles).toHaveLength(1));
    await act(async () => {});

    expect(assign).not.toHaveBeenCalled();
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('does not redirect when the re-read role equals the stored role', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockResolvedValue(profilesFor('ADMIN'));
    getCurrentUser.mockResolvedValue({ school_id: 5, role: 'STUDENT' });

    renderHook(() => useWorkspaces());
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['a department head on the college home profile', 'DEPARTMENT_HEAD'],
    ['office staff holding an admin profile on the college home organization', 'ADMIN'],
  ])('never re-reads the user for %s', async (_name, role) => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role }));
    getAccountProfiles.mockResolvedValue({ data: { profiles: [{ ...student, id: 7, role }], active_profile_id: 7 } });
    getCollegeOrganizations.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.profiles).toHaveLength(1));
    await act(async () => {});

    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['the admin profile is active and stored as ADMIN', 2, 'ADMIN'],
    ['the student profile is active and stored as STUDENT', 1, 'STUDENT'],
  ])('never re-reads the user for a person with several profiles when %s', async (_name, activeProfileId, storedRole) => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: storedRole }));
    getAccountProfiles.mockResolvedValue({
      data: {
        profiles: [student, { ...student, id: 2, role: 'ADMIN' }],
        active_profile_id: activeProfileId,
      },
    });

    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(result.current.profiles).toHaveLength(2));
    await act(async () => {});

    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown role', 'UNKNOWN'],
    ['a name that only exists on every object', 'constructor'],
  ])('does not redirect when the re-read role is %s', async (_name, freshRole) => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockResolvedValue(profilesFor('ADMIN'));
    getCurrentUser.mockResolvedValue({ school_id: 5, role: freshRole });

    renderHook(() => useWorkspaces());
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(assign).not.toHaveBeenCalled();
  });
});
