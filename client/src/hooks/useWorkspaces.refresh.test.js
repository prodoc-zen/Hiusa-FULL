import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountProfiles } from '../services/authService';
import { getCollegeOrganizations } from '../services/collegeOrganizationService';
import useWorkspaces from './useWorkspaces';

vi.mock('../services/authService', () => ({
  getAccountProfiles: vi.fn(),
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
