import { useEffect, useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import { Button, Drawer, EmptyState, Field, FlowStepper, NextStep, Skeleton, Textarea } from '../ui';
import ConfirmModal from '../ConfirmModal';
import { formatDisplayText, signatoryLabel } from '../../utils/displayText.js';
import { roleLabel, toNextStepProps } from '../../lib/lifecycle';
import { downloadFinancialReportPdf } from '../../services/financeService';
import { getApprovalHistory } from '../../services/electionService';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../utils/apiError';
import notify from '../../lib/notify';
import { FileLink } from '../reviews/FileReviewList';
import ApprovalReceipt from './ApprovalReceipt';
import EventFilesReview, { allAccepted, filesOf, initialMarks, markedFiles, missingNote, stageOfRequest } from './EventFilesReview';
import { ENTITY_LABEL, decisionMessage, describeApproval, entityLink } from './approvalStage';
import { electionProposal, formatDateTime, fullName } from './approvalFormat';

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

const HISTORY_LABELS = {
  submitted: 'Submitted',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  returned: 'Asked for changes',
  declined: 'Rejected for good',
  approval_reopened: 'Sent back for approval',
};

// The election's own trail: submissions, decisions and every time a change sent it back for approval.
// It is a short read-only list, so a failed load simply leaves the generic history in its place.
function useElectionHistory(request, reloadKey) {
  const electionId = request.entity_type === 'election' ? request.entity_id : null;
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (electionId === null || electionId === undefined) return undefined;
    let cancelled = false;
    getApprovalHistory(electionId)
      .then((history) => { if (!cancelled) setRows(Array.isArray(history) ? history : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [electionId, reloadKey]);

  return rows;
}

function ElectionHistory({ rows }) {
  return (
    <section aria-label="Decision history">
      <h3 className="text-xs font-semibold text-ink-muted-strong">Decision history</h3>
      <ul aria-label="Decision history" className="mt-2 space-y-3 border-l border-line pl-4">
        {rows.map((row, index) => (
          <li key={`${row.action}-${row.at}-${index}`} className="text-sm">
            <p className="font-semibold text-ink">{HISTORY_LABELS[row.action] ?? row.action}{row.actor_name ? ` by ${row.actor_name}` : ''}</p>
            {row.at && <p className="text-xs font-medium text-ink-muted-strong">{formatDateTime(row.at)}</p>}
            {row.rules_version ? <p className="text-xs font-medium text-ink-muted-strong">Rules version {row.rules_version}</p> : null}
            {row.remarks && <p className="mt-1 text-sm text-ink-muted-strong"><span className="font-semibold">Remarks:</span> {row.remarks}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// What the reviewer reads before deciding. Only the parts the proposal has are shown.
function ElectionProposal({ summary }) {
  const proposal = electionProposal(summary);
  const heading = 'text-xs font-semibold text-ink-muted-strong';

  return (
    <section aria-label="Election proposal" className="space-y-4">
      {summary.description && <p className="text-sm text-ink">{summary.description}</p>}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {summary.organization && (
          <div><dt className={heading}>Organization</dt><dd className="mt-1 text-ink">{summary.organization}</dd></div>
        )}
        {summary.academic_year && (
          <div><dt className={heading}>Academic year</dt><dd className="mt-1 text-ink">{summary.academic_year}</dd></div>
        )}
      </dl>
      {proposal.schedule.length > 0 && (
        <div>
          <h3 className={heading}>Schedule</h3>
          <ul aria-label="Schedule" className="mt-2 space-y-1.5 text-sm">
            {proposal.schedule.map((row) => (
              <li key={row.label} className="flex flex-col sm:flex-row sm:gap-3">
                <span className="w-36 shrink-0 font-semibold text-ink">{row.label}</span>
                <span className="text-ink-muted-strong">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposal.positions.length > 0 && (
        <div>
          <h3 className={heading}>Positions</h3>
          <ul aria-label="Positions" className="mt-2 divide-y divide-line rounded-control border border-line">
            {proposal.positions.map((position, index) => (
              <li key={`${position.title}-${index}`} className="px-3 py-2 text-sm">
                <p className="font-semibold text-ink">{formatDisplayText(position.title)}</p>
                <p className="text-ink-muted-strong">{position.details.join(' | ')}</p>
                {position.description && <p className="text-ink-muted-strong">{position.description}</p>}
                {position.qualifications && <p className="text-ink-muted-strong">Other qualifications: {position.qualifications}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposal.requirements.length > 0 && (
        <div>
          <h3 className={heading}>Qualifications</h3>
          <ul aria-label="Qualifications" className="mt-2 space-y-1 text-sm text-ink">
            {proposal.requirements.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
      {proposal.rules && (
        <div>
          <h3 className={heading}>Official rules</h3>
          <div role="region" aria-label="Official rules" tabIndex={0} className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line rounded-control border border-line bg-subtle px-3 py-2 text-sm text-ink">
            {proposal.rules}
          </div>
        </div>
      )}
      {proposal.tieBreakRule && (
        <div>
          <h3 className={heading}>Tie-break rule</h3>
          <p className="mt-1 text-sm text-ink">{proposal.tieBreakRule}</p>
        </div>
      )}
    </section>
  );
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
export default function ApprovalDetailDrawer({ open, request, status, role, canAct, organizationName, onClose, onApprove, onReject, onDecide }) {
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

  return <RequestDrawer key={request.id} request={request} role={role} canAct={canAct} organizationName={organizationName} onClose={onClose} onApprove={onApprove} onReject={onReject} onDecide={onDecide} />;
}

// Split from the shell above so the per-file marks live in hooks that run only once there is a request.
function RequestDrawer({ request, role, canAct, organizationName, onClose, onApprove, onReject, onDecide }) {
  const files = filesOf(request);
  const stage = stageOfRequest(request);
  const reviewing = canAct && files.length > 0;
  const [marks, setMarks] = useState(() => initialMarks(files, stage));
  const [notes, setNotes] = useState({});
  // An election has three outcomes, so its remarks are written here and the decision is sent as one payload.
  const isElection = request.entity_type === 'election';
  const decidingElection = isElection && canAct && typeof onDecide === 'function';
  const [remarks, setRemarks] = useState('');
  const [confirmingFinal, setConfirmingFinal] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [historyKey, setHistoryKey] = useState(0);
  const electionHistory = useElectionHistory(request, historyKey);
  const info = describeApproval(request, role);
  const link = entityLink(request, role);
  const nextStep = nextStepFor(request, info, role);
  const typeLabel = ENTITY_LABEL[request.entity_type] || request.entity_type;

  const trimmed = remarks.trim();

  async function decide(payload) {
    setDeciding(true);
    setDecisionError('');
    try {
      await onDecide(request, payload);
      setRemarks('');
      setHistoryKey((key) => key + 1);
    } catch (cause) {
      setDecisionError(getApiErrorMessage(cause, 'Could not save your decision. Try again.'));
    } finally {
      setDeciding(false);
    }
  }

  const footer = (
    <>
      {link && <Button variant="secondary" to={link.to}>{link.label}</Button>}
      {decidingElection && (
        <>
          <Button variant="secondary" leftIcon={X} disabled={deciding || !trimmed} onClick={() => setConfirmingFinal(true)}>Reject for good</Button>
          <Button variant="secondary" disabled={deciding || !trimmed} onClick={() => decide({ status: 'rejected', remarks: trimmed })}>Ask for changes</Button>
          <Button leftIcon={Check} loading={deciding} disabled={deciding} onClick={() => decide({ status: 'approved', remarks: trimmed || null })}>Approve</Button>
        </>
      )}
      {canAct && !decidingElection && (
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
        {isElection && request.summary && <ElectionProposal summary={request.summary} />}
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
        {decidingElection && (
          <section aria-label="Your decision" className="space-y-2">
            <Field label="Remarks for the Admin" hint="Needed to ask for changes or to reject. Optional when you approve.">
              <Textarea rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} disabled={deciding} />
            </Field>
            {decisionError && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong">{decisionError}</p>}
          </section>
        )}
        {isElection && electionHistory.length > 0 && <ElectionHistory rows={electionHistory} />}
        {!(isElection && electionHistory.length > 0) && (
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
        )}
      </div>
      <ConfirmModal
        open={confirmingFinal}
        title="Reject election for good"
        message="This rejects the election for good. It cannot be resubmitted. To let the Admin fix it, ask for changes instead."
        confirmText="Reject for good"
        busy={deciding}
        onCancel={() => setConfirmingFinal(false)}
        onConfirm={() => { setConfirmingFinal(false); decide({ status: 'rejected', remarks: trimmed, final: true }); }}
      />
    </Drawer>
  );
}
