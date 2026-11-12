import { useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { Button, Drawer, EmptyState, FlowStepper, NextStep, Skeleton } from '../ui';
import { formatDisplayText, signatoryLabel } from '../../utils/displayText.js';
import { roleLabel, toNextStepProps } from '../../lib/lifecycle';
import { downloadFinancialReportPdf } from '../../services/financeService';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../utils/apiError';
import notify from '../../lib/notify';
import { FileLink } from '../reviews/FileReviewList';
import ApprovalReceipt from './ApprovalReceipt';
import EventFilesReview, { allAccepted, filesOf, initialMarks, markedFiles, missingNote, stageOfRequest } from './EventFilesReview';
import { ENTITY_LABEL, decisionMessage, describeApproval, entityLink } from './approvalStage';
import { formatDateTime, fullName } from './approvalFormat';

function downloadBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(response.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function historyEntries(request) {
  const entries = [{
    key: 'requested',
    title: `Requested by ${fullName(request.requester) || 'an organization member'}`,
    when: request.requested_at,
  }];

  if (request.status === 'pending') {
    entries.push({ key: 'waiting', title: `Waiting for ${roleLabel(request.required_role) ?? 'a reviewer'} to decide`, when: null });
    return entries;
  }

  entries.push({
    key: 'decided',
    title: `${request.status === 'approved' ? 'Approved' : 'Rejected'} by ${fullName(request.reviewer) || roleLabel(request.required_role) || 'the reviewer'}`,
    when: request.reviewed_at,
    remarks: request.remarks || 'No remarks recorded.',
  });
  return entries;
}

function nextStepFor(request, info, role) {
  const decided = decisionMessage(request);
  if (decided) {
    return {
      tone: request.status === 'approved' ? 'done' : 'blocked',
      title: decided,
      body: info.kind === 'lifecycle' ? info.stageText : undefined,
    };
  }

  if (info.kind === 'chip') return { tone: request.required_role === role ? 'action' : 'waiting', title: info.stageText };

  // The decision buttons are in the footer, so the lifecycle's own link back to this page is dropped.
  const props = toNextStepProps(info.lifecycle);
  return props.primary?.to?.includes('/approvals') ? { ...props, primary: undefined } : props;
}

function ReportExtras({ request }) {
  const [downloading, setDownloading] = useState(false);
  const summary = request.summary ?? {};

  async function openDocument(document) {
    try {
      await openProtectedFile(document.open_url);
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Unable to open this document.'));
    }
  }

  async function downloadReportPdf() {
    setDownloading(true);
    try {
      downloadBlob(await downloadFinancialReportPdf(request.entity_id), `financial-report-${request.entity_id}.pdf`);
    } catch {
      notify.error('Unable to download the submitted financial report PDF.');
    } finally {
      setDownloading(false);
    }
  }

  const documents = summary.supporting_documents || [];

  return (
    <div className="space-y-3">
      <Button variant="secondary" leftIcon={Download} loading={downloading} onClick={downloadReportPdf}>
        {downloading ? 'Preparing PDF' : 'Download submitted report'}
      </Button>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-ink-muted-strong">Required signatories</dt>
          {Object.entries(summary.signatories || {}).map(([role, name]) => (
            <dd key={role} className="mt-2 text-ink-muted-strong">{signatoryLabel(role)}: <strong>{formatDisplayText(name)}</strong></dd>
          ))}
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-muted-strong">Supporting documents</dt>
          {documents.map((document) => (
            <dd key={document.index}>
              <button type="button" onClick={() => openDocument(document)} className="mt-2 flex min-h-11 items-center gap-2 text-left text-sm font-semibold text-brand-700 hover:underline">
                <Download size={14} aria-hidden="true" />{document.name}
              </button>
            </dd>
          ))}
          {documents.length === 0 && <dd className="mt-2 text-ink-muted-strong">No supporting documents.</dd>}
        </div>
      </dl>
    </div>
  );
}

// The detail of one approval request, addressable by ?record=. It shows the entity's stage, what the
// request says, and what has happened to it. The footer holds the viewer's one decision: Approve is
// the single primary, Reject is the secondary. After a decision the same drawer stays open on the
// updated record, so it reads the next stage and who the request is waiting on.
export default function ApprovalDetailDrawer({ open, request, status, role, canAct, organizationName, onClose, onApprove, onReject }) {
  if (!open) return null;

  if (!request) {
    return (
      <Drawer open title="Approval request" onClose={onClose} width="max-w-2xl">
        {status === 'loading'
          ? <div role="status" aria-label="Loading the request" className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
          : (
            <EmptyState
              kind="restricted"
              title="This request is not available to you"
              description="Only the reviewer it was sent to and the organization that sent it can open it. It may have been removed."
            />
          )}
      </Drawer>
    );
  }

  return <RequestDrawer key={request.id} request={request} role={role} canAct={canAct} organizationName={organizationName} onClose={onClose} onApprove={onApprove} onReject={onReject} />;
}

// Split from the shell above so the per-file marks live in hooks that run only once there is a request.
function RequestDrawer({ request, role, canAct, organizationName, onClose, onApprove, onReject }) {
  const files = filesOf(request);
  const stage = stageOfRequest(request);
  const reviewing = canAct && files.length > 0;
  const [marks, setMarks] = useState(() => initialMarks(files, stage));
  const [notes, setNotes] = useState({});
  const info = describeApproval(request, role);
  const link = entityLink(request, role);
  const nextStep = nextStepFor(request, info, role);
  const typeLabel = ENTITY_LABEL[request.entity_type] || request.entity_type;

  const footer = (
    <>
      {link && <Button variant="secondary" to={link.to}>{link.label}</Button>}
      {canAct && (
        <>
          <Button variant="secondary" leftIcon={X} disabled={reviewing && missingNote(files, marks, notes)} onClick={() => onReject(request, markedFiles(files, marks, notes))}>Reject</Button>
          <Button leftIcon={Check} disabled={reviewing && !allAccepted(files, marks)} onClick={() => onApprove(request, markedFiles(files, marks, notes))}>Approve</Button>
        </>
      )}
    </>
  );

  return (
    <Drawer
      open
      title={formatDisplayText(request.title)}
      description={`Request #${request.id} · ${typeLabel}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={footer}
    >
      <div className="space-y-5">
        {info.kind === 'lifecycle' && (
          <div className="sticky top-0 z-10 -mx-5 -mt-4 bg-surface px-5 pb-3 pt-4">
            <FlowStepper variant="full" layout="wrap" steps={info.steps} ariaLabel={`${typeLabel} progress`} />
          </div>
        )}
        <NextStep {...nextStep} />
        <ApprovalReceipt request={request} organizationName={organizationName} compact />
        {files.length > 0 && (
          <EventFilesReview
            files={files}
            actionable={reviewing}
            marks={marks}
            notes={notes}
            onMark={(id, value) => setMarks((current) => ({ ...current, [id]: value }))}
            onNote={(id, value) => setNotes((current) => ({ ...current, [id]: value }))}
          />
        )}
        {request.entity_type === 'election' && request.summary?.informative_letter_url && (
          <section aria-label="Informative letter">
            <h3 className="text-xs font-semibold text-ink-muted-strong">Informative letter</h3>
            <FileLink url={request.summary.informative_letter_url} name="Informative letter" />
          </section>
        )}
        {reviewing && !allAccepted(files, marks) && (
          <p className="text-sm text-ink-muted-strong">Accept every file to approve. Return the request to send back a file with a note.</p>
        )}
        {request.entity_type === 'financial_report' && <ReportExtras request={request} />}
        <section aria-label="History">
          <h3 className="text-xs font-semibold text-ink-muted-strong">History</h3>
          <ol className="mt-2 space-y-3 border-l border-line pl-4">
            {historyEntries(request).map((entry) => (
              <li key={entry.key} className="text-sm">
                <p className="font-semibold text-ink">{entry.title}</p>
                {entry.when && <p className="text-xs font-medium text-ink-muted-strong">{formatDateTime(entry.when)}</p>}
                {entry.remarks && <p className="mt-1 text-sm text-ink-muted-strong"><span className="font-semibold">Remarks:</span> {entry.remarks}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Drawer>
  );
}
