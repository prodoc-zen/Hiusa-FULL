import { useNavigate } from 'react-router-dom';
import { Button } from '../ui';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import useWorkspaces from '../../hooks/useWorkspaces';
import { getStoredRole } from '../../lib/pageMeta';
import { formatDisplayText } from '../../utils/displayText.js';

function Banner({ name, actionLabel, onAction, busy = false }) {
  return (
    <aside aria-label="Workspace" className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#DDE7EF] bg-[#EEF6FB] px-4 py-2 text-sm text-[#0F172A] sm:mx-6 sm:mt-3">
      <p className="min-w-0 break-words">Viewing <strong className="font-bold">{formatDisplayText(name)}</strong></p>
      <Button variant="secondary" size="sm" onClick={onAction} loading={busy}>{actionLabel}</Button>
    </aside>
  );
}

export default function WorkspaceBanner() {
  const role = getStoredRole();
  const navigate = useNavigate();
  const { subAccount, leave } = useActiveSubAccount();
  const workspaces = useWorkspaces({ enabled: role === 'ADMIN' || role === 'SBO_OFFICER' });

  if (role === 'DEPARTMENT_HEAD' && subAccount) {
    return (
      <Banner
        name={subAccount.name}
        actionLabel="Back to my college"
        onAction={() => {
          leave();
          navigate('/dashboard/department-head');
        }}
      />
    );
  }

  if ((role === 'ADMIN' || role === 'SBO_OFFICER') && workspaces.current?.kind === 'org' && workspaces.main) {
    return (
      <Banner
        name={workspaces.current.label}
        actionLabel="Back to my account"
        busy={workspaces.switching}
        onAction={() => workspaces.switchProfile(workspaces.main.profile)}
      />
    );
  }

  return null;
}
