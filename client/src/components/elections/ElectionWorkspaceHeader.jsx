import { NavLink, useLocation } from 'react-router-dom';
import Button from '../ui/Button';
import FlowStepper from '../ui/FlowStepper';
import PageHeader from '../ui/PageHeader';
import StatusBadge from '../ui/StatusBadge';
import { electionLifecycle } from '../../lib/lifecycle';
import { manilaDate } from '../../lib/format';
import { formatDisplayText } from '../../utils/displayText.js';
import ElectionNextStep from './ElectionNextStep';
import { electionStatusChip, withApprovalState, workspaceSteps } from './electionFlow';

const TAB_BASE = 'inline-flex h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-medium';

function StepStrip({ steps }) {
  if (steps.length < 2) return null;

  return (
    <nav aria-label="Election workspace steps" className="border-b border-line">
      <ol className="flex flex-wrap">
        {steps.map((step) => (
          <li key={step.key}>
            {step.available ? (
              <NavLink
                to={step.to}
                aria-current={step.active ? 'step' : undefined}
                className={`${TAB_BASE} transition-colors duration-150 ${step.active ? 'border-brand-600 font-semibold text-ink' : 'border-transparent text-ink-muted-strong hover:text-ink'}`}
              >
                <span aria-hidden="true">{step.number}.</span>
                {step.label}
              </NavLink>
            ) : (
              <span aria-disabled="true" title={step.reason} className={`${TAB_BASE} cursor-not-allowed border-transparent text-ink-soft`}>
                <span aria-hidden="true">{step.number}.</span>
                {step.label}
                <span className="sr-only">: {step.reason}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// The selected election's header: who it is, where it stands (compact stepper), what happens next,
// and the workspace steps in process order. The one h1 comes from PageHeader (the page's own title).
export default function ElectionWorkspaceHeader({ election, role, onClear, onChanged }) {
  const { pathname, search } = useLocation();
  const view = new URLSearchParams(search).get('view');
  const lifecycle = electionLifecycle(withApprovalState(election), role);
  const chip = electionStatusChip(election);
  const steps = workspaceSteps(role, election, pathname, view);

  return (
    <div className="space-y-4">
      <PageHeader
        actions={<Button variant="secondary" onClick={onClear}>Change election</Button>}
        meta={(
          <>
            <p className="text-sm font-semibold text-ink"><span className="sr-only">Election: </span>{formatDisplayText(election.title)}</p>
            <StatusBadge label={chip.label} tone={chip.tone} />
            <span className="text-xs text-ink-muted-strong">
              {manilaDate(election.start_time)} to {manilaDate(election.end_time)}
            </span>
          </>
        )}
        stepper={<FlowStepper steps={lifecycle.steps} ariaLabel="Election progress" />}
        nextStep={<ElectionNextStep election={election} role={role} onChanged={onChanged} />}
      />
      <StepStrip steps={steps} />
    </div>
  );
}
