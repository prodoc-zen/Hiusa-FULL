import { useNavigate } from 'react-router-dom';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import useWorkspaces from '../../hooks/useWorkspaces';
import { getStoredRole } from '../../lib/pageMeta';
import { workspaceRoleWord } from '../../utils/workspaceLabels';
import { formatDisplayText } from '../../utils/displayText.js';

// One strip under the top bar: which workspace the person is in, in plain words, and one way back to their own view.
// The organization name gives way first (ellipsis, full name on hover), so the strip stays one or two lines on a phone.
function Banner({ label, name, position, actionLabel, onAction, busy = false, error = '' }) {
  const shownName = formatDisplayText(name);

  return (
    <aside aria-label="Workspace" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-brand-50 px-4 py-2 text-sm text-ink sm:px-6">
      <p className="flex min-w-0 max-w-full flex-1 basis-64 items-baseline gap-x-1.5">
        <strong className="shrink-0 font-semibold">{label}</strong>
        {shownName ? <span aria-hidden="true" className="shrink-0 text-ink-muted-strong">{' · '}</span> : null}
        {shownName ? <span className="min-w-0 truncate" title={shownName}>{shownName}</span> : null}
        {position ? <span aria-hidden="true" className="shrink-0 text-ink-muted-strong">{' · '}</span> : null}
        {position ? <span className="max-w-[40%] shrink-0 truncate text-ink-muted-strong" title={position}>{position}</span> : null}
      </p>
      {onAction && <button
        type="button"
        onClick={onAction}
        disabled={busy}
        className="min-h-11 shrink-0 text-sm font-medium text-brand-800 underline underline-offset-2 hover:text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 sm:min-h-8"
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
        label="Viewing"
        name={subAccount.name}
        actionLabel="Back to my college"
        onAction={() => {
          leave();
          navigate('/dashboard/department-head');
        }}
      />
    );
  }

  if (workspaces.spaces.length < 2 || !workspaces.current) return null;

  // Only a person with somewhere else to go sees the strip; it never repeats what a single-profile account already knows.
  if (workspaces.current.kind === 'org') {
    const active = workspaces.current.profile;

    return (
      <Banner
        label={`${workspaceRoleWord(active.role, active.organization.organization_type)} workspace`}
        name={active.organization.name}
        position={active.role === 'SBO_OFFICER' ? active.position_title : null}
        actionLabel="Back to my account"
        busy={workspaces.switching}
        error={workspaces.switchError}
        onAction={workspaces.main ? () => workspaces.switchProfile(workspaces.main.profile) : undefined}
      />
    );
  }

  return <Banner label="Student workspace" busy={workspaces.switching} error={workspaces.switchError} />;
}
