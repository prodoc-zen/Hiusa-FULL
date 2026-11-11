import { useState } from 'react';
import { Eye } from 'lucide-react';
import { DataTable, Drawer, FlowStepper, NextStep } from '../ui';
import { financialReportLifecycle, toNextStepProps } from '../../lib/lifecycle';
import { formatDisplayText } from '../../utils/displayText.js';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../utils/apiError';
import TableRowActions from '../TableRowActions';

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

// The same limits the server enforces on submit, checked as the files are picked so the Admin hears at once.
const SUPPORTING_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'];
const SUPPORTING_MAX_FILES = 10;
const SUPPORTING_MAX_BYTES = 10 * 1024 * 1024;

function supportingFileProblem(picked) {
  if (picked.length > SUPPORTING_MAX_FILES) return `Attach no more than ${SUPPORTING_MAX_FILES} supporting files.`;
  for (const file of picked) {
    if (!SUPPORTING_EXTENSIONS.includes(file.name.split('.').pop().toLowerCase())) return `${file.name} is not a PDF, JPG, PNG, Word or Excel file.`;
    if (file.size > SUPPORTING_MAX_BYTES) return `${file.name} is larger than 10 MB.`;
  }
  return '';
}

export default function ReportDetailDrawer({ report, viewerRole, onClose, files = [], onFilesChange, onSubmit, submitting }) {
  const [fileError, setFileError] = useState('');
  const [pickError, setPickError] = useState('');
  if (!report) return null;
  const lifecycle = financialReportLifecycle(withDraftDefault(report), viewerRole);
  const canSubmit = viewerRole === 'ADMIN' && ['draft', 'rejected'].includes(withDraftDefault(report).submission_status);
  const nextStep = reportNextStepProps(report, viewerRole, { onSubmit: canSubmit ? onSubmit : undefined, submitting });
  const documentName = report.document_type === 'income_statement' ? 'Income statement' : 'Financial report';
  const generated = String(report.generated_at || '').slice(0, 10);
  const documents = report.supporting_documents || [];

  async function viewDocument(document) {
    setFileError('');
    try {
      await openProtectedFile(document.open_url);
    } catch (error) {
      setFileError(getApiErrorMessage(error, 'Could not open this document.'));
    }
  }

  return (
    <Drawer open title={formatDisplayText(report.title)} description={[documentName, generated && `Generated ${generated}`].filter(Boolean).join(' · ')} onClose={onClose} width="max-w-xl">
      <div className="space-y-5">
        <FlowStepper variant="full" steps={lifecycle.steps} ariaLabel="Financial report progress" />
        <NextStep {...nextStep} />
        {report.summary_text && <p className="border-t border-line pt-4 text-sm font-medium text-ink-muted-strong">{report.summary_text}</p>}
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Submitted supporting files</h3>
          {fileError && <p role="alert" className="mt-2 text-sm font-medium text-danger-strong">{fileError}</p>}
          {documents.length ? <DataTable
            caption={`Supporting files for ${formatDisplayText(report.title)}`}
            stickyHeader={false}
            rows={documents}
            rowKey={(document) => document.index}
            columns={[{ key: 'file', header: 'File', render: (document) => <span className="break-all">{document.name}</span> }]}
            actions={(document) => <TableRowActions subject={document.name} actions={[{ label: 'View file', icon: Eye, onClick: () => viewDocument(document) }]} />}
          /> : <p className="mt-2 text-xs font-medium text-ink-muted">No supporting files submitted.</p>}
        </div>
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
                onChange={(event) => {
                  const picked = Array.from(event.target.files || []);
                  const problem = supportingFileProblem(picked);
                  setPickError(problem);
                  if (problem) {
                    event.target.value = '';
                    return;
                  }
                  onFilesChange?.(picked);
                }}
              />
            </label>
            <p className="mt-2 text-xs font-medium text-ink-muted-strong">{files.length} file(s) attached. Add receipts or other proof the reviewers need.</p>
            {pickError && <p role="alert" className="mt-2 text-sm font-medium text-danger-strong">{pickError}</p>}
          </div>
        )}
      </div>
    </Drawer>
  );
}
