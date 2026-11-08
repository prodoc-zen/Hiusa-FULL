import { useCallback, useEffect, useState } from 'react';
import { getMyOrganizationApplications } from '../services/organizationApplicationService';
import { useRefetchOnReturn } from './useRefetchOnReturn';

// A student sees "Apply for an organization" while a Department Head's permission is unused, and
// afterwards for as long as they have an application to follow.
export function useApplicantAccess(role) {
  const [visible, setVisible] = useState(false);
  const enabled = role === 'STUDENT';

  const refresh = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return getMyOrganizationApplications()
      .then((res) => setVisible(Boolean(res.data?.can_apply) || (res.data?.applications?.length ?? 0) > 0))
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    let cancelled = false;
    if (enabled) {
      getMyOrganizationApplications()
        .then((res) => { if (!cancelled) setVisible(Boolean(res.data?.can_apply) || (res.data?.applications?.length ?? 0) > 0); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [enabled]);

  useRefetchOnReturn(refresh);

  return { visible: enabled && visible };
}
