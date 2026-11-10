import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAccountProfiles, switchAccountProfile } from '../services/authService';
import { getCollegeOrganizations } from '../services/collegeOrganizationService';
import { unwrapList } from '../services/pagination';
import { ROLE_HOME_PATHS, ROLE_LABELS } from '../components/layout/navigation';
import { storedUser } from '../utils/collegeIdentity';

const ORG_ROLES = ['ADMIN', 'SBO_OFFICER'];

// Every mounted copy of the hook (the top bar and the banner) reloads on a tab return. They share the one
// request that is in flight, and each copy still applies the answer to its own state.
// A request is only shared with someone holding the same sign-in, so a slow answer never reaches the next person.
let pending = null;

function sharedAccountProfiles() {
  const token = localStorage.getItem('auth_token');
  if (pending && pending.token === token) return pending.request;
  const request = Promise.resolve(getAccountProfiles());
  const entry = { token, request };
  pending = entry;
  const clear = () => { if (pending === entry) pending = null; };
  request.then(clear, clear);
  return request;
}

const usable = (profile) => profile.account_status === 'active'
  && Boolean(profile.organization?.is_active)
  && profile.organization.college_is_active !== false;

function profileDetail(profile) {
  const role = ROLE_LABELS[profile.role] || profile.role;
  return profile.position_title ? `${role} · ${profile.position_title}` : role;
}

// Every place a person can work, as plain rows. "My account" is the student side of a user; each
// organization they lead or help run is a space of its own. A Department Head's spaces are the
// college's active organizations, entered as an overview and not as a role change.
export function buildWorkspaces({ role, profiles = [], activeProfileId = null, collegeOrganizations = [], activeSubAccount = null }) {
  if (role === 'DEPARTMENT_HEAD') {
    const main = { key: 'main', kind: 'main', label: 'My college', detail: 'Dean view' };
    const orgs = collegeOrganizations.map((organization) => ({
      key: `org-${organization.id}`,
      kind: 'org',
      label: organization.name,
      detail: `${organization.members_count ?? 0} members`,
      organization,
    }));
    const spaces = orgs.length > 0 ? [main, ...orgs] : [];
    const current = activeSubAccount ? orgs.find((space) => Number(space.organization.id) === Number(activeSubAccount.id)) ?? main : main;

    return { spaces, current, main: orgs.length > 0 ? main : null };
  }

  const profilesNow = profiles.filter(usable);
  const students = profilesNow.filter((profile) => profile.role === 'STUDENT');
  const mainProfile = students.find((profile) => profile.organization?.organization_type === 'COLLEGE') ?? students[0];
  const main = mainProfile ? { key: 'main', kind: 'main', label: 'My account', detail: 'Student view', profile: mainProfile } : null;
  const orgs = profilesNow.filter((profile) => ORG_ROLES.includes(profile.role)).map((profile) => ({
    key: `profile-${profile.id}`,
    kind: 'org',
    label: profile.organization.name,
    detail: profileDetail(profile),
    profile,
  }));
  const spaces = main && orgs.length > 0 ? [main, ...orgs] : orgs.length > 1 ? orgs : [];
  const active = profilesNow.find((profile) => profile.id === activeProfileId);
  const current = active && ORG_ROLES.includes(active.role) ? orgs.find((space) => space.profile.id === active.id) : main;

  const activeStudent = students.find((profile) => profile.id === activeProfileId) ?? null;

  return { spaces, current: current ?? null, main, studentProfiles: students, activeStudent };
}

export default function useWorkspaces({ enabled = true, activeSubAccount = null } = {}) {
  const user = storedUser();
  const role = user?.role ?? '';
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const [collegeOrganizations, setCollegeOrganizations] = useState([]);

  const latestLoad = useRef(0);
  const inFlight = useRef(false);
  const latestOrgLoad = useRef(0);
  const orgInFlight = useRef(false);

  const loadProfiles = useCallback(async ({ quiet = false } = {}) => {
    const load = ++latestLoad.current;
    inFlight.current = true;
    if (!quiet) setLoading(true);
    try {
      const response = await sharedAccountProfiles();
      if (load !== latestLoad.current) return;
      setProfiles(response.data.profiles || []);
      setActiveProfileId(response.data.active_profile_id);
      setError('');
    } catch {
      if (!quiet && load === latestLoad.current) setError('Could not load your profiles.');
    } finally {
      // Whichever load is the latest settles the spinner, so a quiet one that took over never strands it.
      if (load === latestLoad.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, []);

  const loadCollegeOrganizations = useCallback(async ({ quiet = false } = {}) => {
    const load = ++latestOrgLoad.current;
    orgInFlight.current = true;
    try {
      const response = await getCollegeOrganizations({ per_page: 100, lifecycle_status: 'active' });
      if (load === latestOrgLoad.current) setCollegeOrganizations(unwrapList(response?.data));
    } catch {
      if (!quiet && load === latestOrgLoad.current) setCollegeOrganizations([]);
    } finally {
      if (load === latestOrgLoad.current) orgInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled && role) loadProfiles();
  }, [enabled, role, loadProfiles]);

  // Access granted while this person is signed in shows up when they come back to the tab, without a reload.
  useEffect(() => {
    if (!enabled || !role) return undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (!inFlight.current) loadProfiles({ quiet: true });
      if (role === 'DEPARTMENT_HEAD' && !orgInFlight.current) loadCollegeOrganizations({ quiet: true });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, role, loadProfiles, loadCollegeOrganizations]);

  useEffect(() => {
    if (enabled && role === 'DEPARTMENT_HEAD') loadCollegeOrganizations();
  }, [enabled, role, loadCollegeOrganizations]);

  const switchProfile = useCallback(async (profile) => {
    if (switching) return;
    setSwitching(true);
    setSwitchError('');
    try {
      const response = await switchAccountProfile(profile.id);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      window.location.assign(ROLE_HOME_PATHS[response.data.user.role] || '/dashboard');
    } catch {
      setSwitchError('Could not switch profile. Try again.');
      setSwitching(false);
    }
  }, [switching]);

  const workspaces = useMemo(
    () => buildWorkspaces({ role, profiles, activeProfileId: activeProfileId ?? user?.active_profile_id ?? null, collegeOrganizations, activeSubAccount }),
    [role, profiles, activeProfileId, user?.active_profile_id, collegeOrganizations, activeSubAccount],
  );

  return {
    ...workspaces,
    profiles,
    activeProfileId,
    loading,
    error,
    switching,
    switchError,
    reload: loadProfiles,
    switchProfile,
  };
}
