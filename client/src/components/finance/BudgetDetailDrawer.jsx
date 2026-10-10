import { Drawer, FlowStepper, NextStep } from '../ui';
import { budgetLifecycle, toNextStepProps } from '../../lib/lifecycle';
import { peso } from '../../lib/format';
import { formatDisplayText } from '../../utils/displayText.js';

// A returned budget is edited on this page, so its button opens the form instead of linking back here.
export function budgetNextStepProps(budget, viewerRole, onEdit) {
  const props = toNextStepProps(budgetLifecycle(budget, viewerRole));
  if (budget.submission_status === 'rejected' && props.primary && onEdit) {
    props.primary = { label: 'Edit and resubmit', onClick: onEdit };
  }
  return props;
}

export default function BudgetDetailDrawer({ budget, viewerRole, onClose, onEdit }) {
  if (!budget) return null;
  const lifecycle = budgetLifecycle(budget, viewerRole);
  const nextStep = budgetNextStepProps(budget, viewerRole, onEdit ? () => onEdit(budget) : undefined);
  const context = [budget.event && formatDisplayText(budget.event.title), budget.financial_semester && `Semester: ${formatDisplayText(budget.financial_semester.name)}`].filter(Boolean).join(' · ');

  return (
    <Drawer open title={formatDisplayText(budget.title)} description={context || undefined} onClose={onClose} width="max-w-xl">
      <div className="space-y-5">
        <FlowStepper steps={lifecycle.steps} ariaLabel="Budget progress" />
        <NextStep {...nextStep} />
        <dl className="grid grid-cols-1 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs font-semibold text-ink-muted-strong">Allocated</dt><dd className="mt-0.5 font-bold tabular-nums text-ink">{peso(budget.allocated_amount)}</dd></div>
          <div><dt className="text-xs font-semibold text-ink-muted-strong">Remaining</dt><dd className="mt-0.5 font-bold tabular-nums text-ink">{peso(budget.remaining_amount)}</dd></div>
          <div><dt className="text-xs font-semibold text-ink-muted-strong">Warning at</dt><dd className="mt-0.5 font-bold tabular-nums text-ink">{peso(budget.warning_threshold)}</dd></div>
        </dl>
      </div>
    </Drawer>
  );
}
