import { useNavigate } from 'react-router-dom';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import useWorkspaces from '../../hooks/useWorkspaces';
import { getStoredRole } from '../../lib/pageMeta';
import { formatDisplayText } from '../../utils/displayText.js';

// One strip under the top bar: where the person is looking, and one way back to their own view.
function Banner({ name, kind, actionLabel = 'Back to mine', onAction, busy = false, error = '' }) {
  return (
    <aside aria-label="Workspace" className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-50 px-4 py-2 text-sm text-ink sm:px-6">
      <p className="min-w-0 break-words">Viewing <strong className="font-semibold">{formatDisplayText(name)}</strong>{kind ? <span className="text-ink-muted-strong"> · {kind}</span> : null}</p>
      {onAction && <button
        type="button"
        onClick={onAction}
        disabled={busy}
        className="min-h-11 text-sm font-medium text-brand-800 underline underline-offset-2 hover:text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 sm:min-h-8"
      >
        {actionLabel}
      </button>}
      {error && <p role="alert" className="basis-full text-sm font-medium text-danger-strong">{error}</p>}
    </aside>
  );
}

export default function WorkspaceBanner() {
  const role = getStoredRole();
  const navigate = useNavigate();
  const { subAccount, leave } = useActiveSubAccount();
  const workspaces = useWorkspaces({ enabled: role === 'ADMIN' || role === 'SBO_OFFICER' || role === 'STUDENT' });

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
        error={workspaces.switchError}
        onAction={() => workspaces.switchProfile(workspaces.main.profile)}
      />
    );
  }

  if (role === 'STUDENT' && workspaces.studentProfiles.length > 1 && workspaces.activeStudent) {
    const active = workspaces.activeStudent;
    const isCollege = active.organization.organization_type === 'COLLEGE';
    const college = workspaces.studentProfiles.find((profile) => profile.organization?.organization_type === 'COLLEGE');

    return (
      <Banner
        name={active.organization.name}
        kind={isCollege ? 'College profile' : 'Organization profile'}
        actionLabel="Back to college"
        busy={workspaces.switching}
        error={workspaces.switchError}
        onAction={!isCollege && college ? () => workspaces.switchProfile(college) : undefined}
      />
    );
  }

  return null;
}
