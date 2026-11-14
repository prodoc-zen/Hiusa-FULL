import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAccountProfiles, switchAccountProfile } from '../services/authService';
import notify from '../lib/notify';
import { workspaceRoleWord } from '../utils/workspaceLabels';
import { usable } from './useWorkspaces';

const NO_ACCESS = 'You do not have access to that page.';

// ProtectedRoute sends a person to their own dashboard when they open a page their active profile may not. It leaves
// the page and the roles that may open it in the location, so the dashboard can say why they landed here and,
// when another of their own profiles may open the page, offer to switch to it.
export default function useAccessDeniedNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const denied = location.state?.accessDenied;
  const handled = useRef(null);

  useEffect(() => {
    if (!denied || handled.current === location.key) return;
    handled.current = location.key;
    navigate(location.pathname + location.search, { replace: true, state: null });

    (async () => {
      let owned = null;
      try {
        const response = await getAccountProfiles();
        const activeId = response.data.active_profile_id;
        owned = (response.data.profiles || []).find((profile) => profile.id !== activeId && usable(profile) && denied.allowedRoles?.includes(profile.role)) ?? null;
      } catch {
        owned = null;
      }

      if (!owned) {
        notify.info(NO_ACCESS);
        return;
      }

      const word = workspaceRoleWord(owned.role, owned.organization.organization_type);
      notify.info(`That page belongs to your ${owned.organization.name} ${word} workspace.`, {
        duration: 15000,
        action: {
          label: 'Switch',
          onClick: async () => {
            try {
              const switched = await switchAccountProfile(owned.id);
              localStorage.setItem('user', JSON.stringify(switched.data.user));
              window.location.assign(denied.path);
            } catch {
              notify.error('Could not switch profile. Try again.');
            }
          },
        },
      });
    })();
  }, [denied, location, navigate]);
}
