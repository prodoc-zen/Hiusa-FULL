import { formatDisplayText } from '../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { getEventWorkflowHistory } from '../../services/eventService';
import { formatDateTime, replaceIsoDateTimes } from '../../utils/dateTime';
import { Skeleton, StatusBadge } from '../ui';

const PHASE_LABEL = {
  pre_event: 'Before the event',
  event_day: 'During the event',
  post_event: 'After the event',
};

// The plan an officer reads in the event details: the one the Admin confirmed, or the newest draft while none is.
// It never offers to confirm, discard or regenerate anything.
export default function EventPlanReadOnly({ eventId }) {
  const [state, setState] = useState({ status: 'loading', plan: null });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', plan: null });
    getEventWorkflowHistory(eventId)
      .then((response) => { if (active) setState({ status: 'ready', plan: (response.data || [])[0] || null }); })
      .catch(() => { if (active) setState({ status: 'error', plan: null }); });
    return () => { active = false; };
  }, [eventId]);

  const plan = state.plan?.structured_output;
  const confirmed = state.plan?.decision_status === 'accepted';
  const sections = plan ? [
    ['Plan outline', plan.preparation_phases],
    ['Key dates', plan.timeline],
    ['What is needed', plan.resources],
    ['Setup and coordination', plan.logistics],
    ['Possible problems', [...(plan.risks || []), ...(plan.scheduling_conflicts || [])]],
  ] : [];

  return (
    <section className="border-t border-line pt-4" aria-label="Event plan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Event plan</h3>
        {state.plan && <StatusBadge tone={confirmed ? 'success' : 'warning'} label={confirmed ? 'Confirmed by the Admin' : 'Draft, not confirmed yet'} />}
      </div>
      {state.status === 'loading' && <Skeleton className="mt-3 h-16 w-full" />}
      {state.status === 'error' && <p role="alert" className="mt-2 text-sm text-danger-strong">The event plan could not be loaded.</p>}
      {state.status === 'ready' && !state.plan && <p className="mt-2 text-sm text-ink-muted">No plan has been prepared for this event yet.</p>}
      {plan && (
        <>
          {plan.overview && <p className="mt-2 text-sm text-ink-muted-strong">{replaceIsoDateTimes(plan.overview)}</p>}
          <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {sections.map(([heading, items]) => (
              <div key={heading}>
                <h4 className="text-sm font-semibold text-ink">{heading}</h4>
                {items?.length
                  ? <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-ink-muted-strong">{items.map((item, index) => <li key={`${heading}-${index}`}>{replaceIsoDateTimes(item)}</li>)}</ul>
                  : <p className="mt-1.5 text-xs text-ink-muted">Nothing listed.</p>}
              </div>
            ))}
          </div>
          {plan.tasks?.length > 0 && (
            <>
              <h4 className="mt-4 text-sm font-semibold text-ink">Workflow steps</h4>
              <ol className="mt-1 divide-y divide-line border-t border-line">
                {plan.tasks.map((task, index) => (
                  <li key={task.key || index} className="py-2.5">
                    <p className="text-xs text-ink-muted">Step {index + 1} · {PHASE_LABEL[task.phase] || 'Timing not set'}</p>
                    <p className="mt-0.5 break-words text-sm font-semibold text-ink">{formatDisplayText(task.title) || 'Untitled step'}</p>
                    <p className="mt-0.5 text-xs text-ink-muted-strong">{task.deadline ? `Due ${formatDateTime(task.deadline)}` : 'No due date'}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
