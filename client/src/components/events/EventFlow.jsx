import { Button, FlowStepper, NextStep } from '../ui';
import { eventNextStepProps } from './eventStage';

// The event's whole path under its title: the stepper, the one NextStep naming who owns the next
// move, and (as children) whatever that step needs on the page, such as the SAO file checklist.
export function EventFlowPanel({ flow, children }) {
  return (
    <section aria-label="Event progress" className="mt-5 space-y-4">
      <FlowStepper steps={flow.steps} ariaLabel="Event progress" />
      <NextStep {...eventNextStepProps(flow)} />
      {children}
    </section>
  );
}

// The one action for the viewer's stage. Waiting and done stages have none, so no footer shows.
export function EventFlowFooter({ flow, onEdit, onStart, busy = false }) {
  const { action, secondary } = flow;
  if (!action && !secondary) return null;

  const run = action?.kind === 'edit' ? onEdit : action?.kind === 'start' ? onStart : undefined;
  return (
    <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-6 py-4">
      {secondary && <Button variant="secondary" to={secondary.to}>{secondary.label}</Button>}
      {action && <Button to={action.to} onClick={run} loading={action.kind === 'start' && busy}>{action.label}</Button>}
    </div>
  );
}

export function EventRowProgress({ flow, title, className = '' }) {
  return <FlowStepper steps={flow.steps} variant="compact" ariaLabel={`Progress of ${title}`} summary={flow.nextAction.title} className={className} />;
}
