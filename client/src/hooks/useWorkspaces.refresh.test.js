import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountProfiles } from '../services/authService';
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

describe('useWorkspaces after access is granted to someone already signed in', () => {
  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify({ school_id: 5, role: 'STUDENT' }));
    getAccountProfiles.mockReset();
  });
  afterEach(() => localStorage.clear());

  it('picks up the new organization when the person comes back to the tab', async () => {
    getAccountProfiles.mockResolvedValueOnce({ data: { profiles: [student], active_profile_id: 1 } });
    const { result } = renderHook(() => useWorkspaces());
    await waitFor(() => expect(getAccountProfiles).toHaveBeenCalledTimes(1));
    expect(result.current.spaces).toEqual([]);

    getAccountProfiles.mockResolvedValueOnce({ data: { profiles: [student, officer], active_profile_id: 1 } });
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
});
