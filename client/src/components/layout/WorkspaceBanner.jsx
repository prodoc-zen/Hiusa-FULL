import { useNavigate } from 'react-router-dom';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import useWorkspaces from '../../hooks/useWorkspaces';
import { getStoredRole } from '../../lib/pageMeta';
import { formatDisplayText } from '../../utils/displayText.js';

// One strip under the top bar: where the person is looking, and one way back to their own view.
function Banner({ name, onAction, busy = false }) {
  return (
    <aside aria-label="Workspace" className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-50 px-4 py-2 text-sm text-ink sm:px-6">
      <p className="min-w-0 break-words">Viewing <strong className="font-semibold">{formatDisplayText(name)}</strong></p>
      <button
        type="button"
        onClick={onAction}
        disabled={busy}
        className="min-h-11 text-sm font-medium text-brand-800 underline underline-offset-2 hover:text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 sm:min-h-8"
      >
        Back to mine
      </button>
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
        busy={workspaces.switching}
        onAction={() => workspaces.switchProfile(workspaces.main.profile)}
      />
    );
  }

  return null;
}
