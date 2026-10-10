import { Drawer, FlowStepper, NextStep } from '../ui';
import { financialReportLifecycle, toNextStepProps } from '../../lib/lifecycle';
import { formatDisplayText } from '../../utils/displayText.js';

export function withDraftDefault(report) {
  return { ...report, submission_status: report.submission_status || 'draft' };
}

// Submitting happens in this drawer, where the supporting files are chosen, so the button for a draft
// or returned report sends it instead of linking back to the page it is already on.
export function reportNextStepProps(report, viewerRole, { onSubmit, submitting } = {}) {
  const props = toNextStepProps(financialReportLifecycle(withDraftDefault(report), viewerRole));
  const status = withDraftDefault(report).submission_status;
  if (['draft', 'rejected'].includes(status) && props.primary && onSubmit) {
    props.primary = {
      label: status === 'draft' ? 'Submit for review' : 'Resubmit for review',
      onClick: onSubmit,
      disabledReason: submitting ? 'Submitting the report...' : undefined,
    };
  }
  return props;
}

export default function ReportDetailDrawer({ report, viewerRole, onClose, files = [], onFilesChange, onSubmit, submitting }) {
  if (!report) return null;
  const lifecycle = financialReportLifecycle(withDraftDefault(report), viewerRole);
  const canSubmit = viewerRole === 'ADMIN' && ['draft', 'rejected'].includes(withDraftDefault(report).submission_status);
  const nextStep = reportNextStepProps(report, viewerRole, { onSubmit: canSubmit ? onSubmit : undefined, submitting });
  const documentName = report.document_type === 'income_statement' ? 'Income statement' : 'Financial report';
  const generated = String(report.generated_at || '').slice(0, 10);

  return (
    <Drawer open title={formatDisplayText(report.title)} description={[documentName, generated && `Generated ${generated}`].filter(Boolean).join(' · ')} onClose={onClose} width="max-w-xl">
      <div className="space-y-5">
        <FlowStepper steps={lifecycle.steps} ariaLabel="Financial report progress" />
        <NextStep {...nextStep} />
        {report.summary_text && <p className="border-t border-line pt-4 text-sm font-medium text-ink-muted-strong">{report.summary_text}</p>}
        {canSubmit && (
          <div className="border-t border-line pt-4">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line px-3 text-[13px] font-semibold text-ink hover:bg-subtle focus-within:outline-2 focus-within:outline-brand-600">
              Supporting files
              <input
                aria-label={`Supporting documents for ${formatDisplayText(report.title)}`}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                className="sr-only"
                onChange={(event) => onFilesChange?.(Array.from(event.target.files || []))}
              />
            </label>
            <p className="mt-2 text-xs font-medium text-ink-muted-strong">{files.length} file(s) attached. Add receipts or other proof the reviewers need.</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
