import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAccountProfiles, switchAccountProfile } from '../services/authService';
import { getCollegeOrganizations } from '../services/collegeOrganizationService';
import { unwrapList } from '../services/pagination';
import { ROLE_HOME_PATHS, ROLE_LABELS } from '../components/layout/navigation';
import { storedUser } from '../utils/collegeIdentity';

const ORG_ROLES = ['ADMIN', 'SBO_OFFICER'];

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

  return { spaces, current: current ?? null, main };
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

  const loadProfiles = useCallback(async ({ quiet = false } = {}) => {
    const load = ++latestLoad.current;
    if (!quiet) setLoading(true);
    try {
      const response = await getAccountProfiles();
      if (load !== latestLoad.current) return;
      setProfiles(response.data.profiles || []);
      setActiveProfileId(response.data.active_profile_id);
      setError('');
    } catch {
      if (!quiet && load === latestLoad.current) setError('Could not load your profiles.');
    } finally {
      if (!quiet && load === latestLoad.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled && role) loadProfiles();
  }, [enabled, role, loadProfiles]);

  useEffect(() => {
    if (!enabled || role !== 'DEPARTMENT_HEAD') return;
    getCollegeOrganizations({ per_page: 100, lifecycle_status: 'active' })
      .then((response) => setCollegeOrganizations(unwrapList(response?.data)))
      .catch(() => setCollegeOrganizations([]));
  }, [enabled, role]);

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
