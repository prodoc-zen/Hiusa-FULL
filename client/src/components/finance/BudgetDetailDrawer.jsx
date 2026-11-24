import { Drawer, FlowStepper, NextStep, ProgressMeter } from '../ui';
import { budgetLifecycle, toNextStepProps } from '../../lib/lifecycle';
import { peso } from '../../lib/format';
import { formatDisplayText } from '../../utils/displayText.js';
import BudgetFigures, { budgetFigures } from './BudgetFigures';

// A draft or returned budget is edited on this page, so its button opens the form instead of linking back here. An
// officer only ever edits (the budget stays a draft); the Admin submits a draft and resubmits a returned one.
export function budgetNextStepProps(budget, viewerRole, onEdit, onSubmit) {
  const props = toNextStepProps(budgetLifecycle(budget, viewerRole));
  const status = budget.submission_status;
  if (!props.primary) return props;
  if (viewerRole === 'SBO_OFFICER') {
    if (['draft', 'rejected'].includes(status)) {
      props.primary = onEdit ? { label: props.primary.label, onClick: onEdit } : { label: props.primary.label, disabledReason: 'Your position cannot handle finance' };
    }
  } else if (status === 'rejected' && onEdit) {
    props.primary = { label: 'Edit and resubmit', onClick: onEdit };
  } else if (status === 'draft' && onSubmit) {
    props.primary = { label: 'Submit for approval', onClick: onSubmit };
  }
  return props;
}

export default function BudgetDetailDrawer({ budget, viewerRole, onClose, onEdit, onSubmit }) {
  if (!budget) return null;
  const lifecycle = budgetLifecycle(budget, viewerRole);
  const nextStep = budgetNextStepProps(budget, viewerRole, onEdit ? () => onEdit(budget) : undefined, onSubmit ? () => onSubmit(budget) : undefined);
  const figures = budgetFigures(budget);
  const context = [budget.event && formatDisplayText(budget.event.title), budget.financial_semester && `Semester: ${formatDisplayText(budget.financial_semester.name)}`].filter(Boolean).join(' · ');

  return (
    <Drawer open title={formatDisplayText(budget.title)} description={context || undefined} onClose={onClose} width="max-w-xl">
      <div className="space-y-5">
        <FlowStepper variant="full" steps={lifecycle.steps} ariaLabel="Budget progress" />
        <NextStep {...nextStep} />
        <div className="space-y-4 border-t border-line pt-4">
          <BudgetFigures budget={budget} size="md" />
          {figures.hasBreakdown && figures.allocated > 0 && (
            <ProgressMeter label="Budget used" value={figures.spent} max={figures.allocated} valueLabel={`${peso(figures.spent)} of ${peso(figures.allocated)} spent`} />
          )}
          <dl className="text-sm">
            <div><dt className="text-xs font-semibold text-ink-muted-strong">Warning at</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{peso(budget.warning_threshold)}</dd></div>
          </dl>
        </div>
      </div>
    </Drawer>
  );
}
