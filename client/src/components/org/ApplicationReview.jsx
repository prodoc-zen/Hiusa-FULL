import { useCallback, useEffect, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { Button, ErrorState, Field, PageHeader, Select, SkeletonCard, StatusBadge, Textarea } from '../ui';
import notify from '../../lib/notify';
import { manilaDate } from '../../lib/format';
import { attachReviewFile, getOrganizationApplication, removeReviewFile, reviewOrganizationApplication } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { APPLICATION_LABELS } from './applicationStatus';

const ATTACH_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
const LIST_PATH = '/dashboard/organization-applications';

// The word a reviewer sees for each requirement. "Not checked" sends nothing, so a requirement the
// reviewer has not looked at is never recorded as accepted.
const MARKS = [
  ['', 'Not checked'],
  ['ok', 'Accepted'],
  ['needs_changes', 'Needs changes'],
];

const REVIEW_WORD = { ok: 'Accepted', needs_changes: 'Needs changes', missing: 'Missing' };

const STATUS_LINE = {
  pending_dean: 'With the Department Head for review.',
  pending_sao: 'Endorsed by the Department Head. With the SAO for a decision.',
  returned: 'Returned to the applicant.',
  approved: 'Approved. The organization now exists.',
  rejected: 'Not approved.',
};

async function open(url) {
  try {
    await openProtectedFile(url);
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open this file.'));
  }
}

function FileLink({ url, children, icon: Icon = FileText }) {
  return (
    <button type="button" onClick={() => open(url)} className="inline-flex min-h-11 items-center gap-2 text-left text-sm font-medium text-brand-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="break-all">{children}</span>
    </button>
  );
}

function AttachButton({ label, busy, onFile }) {
  return (
    <label className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-brand-700 underline underline-offset-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
      <Paperclip size={14} aria-hidden="true" />
      Attach a file
      <input
        type="file"
        accept={ATTACH_TYPES}
        aria-label={label}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function ReviewFileRow({ file, removable, busy, onRemove }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FileLink url={file.open_url} icon={Paperclip}>{file.name} ({file.stage_label})</FileLink>
      {removable && (
        <button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => onRemove(file)} className="grid h-11 w-11 place-items-center rounded-control text-ink-muted hover:bg-subtle hover:text-danger-strong focus-visible:outline-2 focus-visible:outline-brand-600">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// One application on one page: a decision belongs on a page, not in a drawer. While the application
// waits for this reviewer it shows one row per requirement and one decision area; afterwards the
// same page reads as a summary of what was decided.
export default function ApplicationReview({ applicationId, viewerRole }) {
  const stage = viewerRole === 'DEPARTMENT_HEAD' ? 'dean' : 'sao';
  const waiting = stage === 'dean' ? 'pending_dean' : 'pending_sao';
  const [state, setState] = useState({ loading: true, error: null, application: null });
  const [marks, setMarks] = useState({});
  const [notes, setNotes] = useState({});
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');

  const load = useCallback((silent = false) => {
    if (!silent) setState({ loading: true, error: null, application: null });
    return getOrganizationApplication(applicationId)
      .then((res) => setState({ loading: false, error: null, application: res.data }))
      .catch((err) => setState({ loading: false, error: err?.response?.status === 404 ? 'This application is not in your queue.' : getApiErrorMessage(err, 'Could not load this application.'), application: null }));
  }, [applicationId]);

  useEffect(() => {
    setMarks({});
    setNotes({});
    setRemarks('');
    setProblem('');
    load();
  }, [applicationId, load]);

  const { application } = state;
  const actionable = application?.status === waiting;
  const requirements = application?.requirements ?? [];
  const flagged = requirements.filter((requirement) => marks[requirement.id] === 'needs_changes');
  const allAccepted = requirements.length > 0 && requirements.every((requirement) => marks[requirement.id] === 'ok');
  const hasNote = remarks.trim() !== '' || flagged.some((requirement) => (notes[requirement.id] || '').trim() !== '');

  async function attach(file, requirementId) {
    setBusy('attach');
    setProblem('');
    try {
      await attachReviewFile(application.id, file, requirementId);
      await load(true);
    } catch (err) {
      setProblem(getApiErrorMessage(err, 'Could not attach this file.'));
    } finally {
      setBusy('');
    }
  }

  async function removeFile(file) {
    setBusy('attach');
    setProblem('');
    try {
      await removeReviewFile(application.id, file.id);
      await load(true);
    } catch (err) {
      setProblem(getApiErrorMessage(err, 'Could not remove this file.'));
    } finally {
      setBusy('');
    }
  }

  async function decide(action, message) {
    setBusy(action);
    setProblem('');
    try {
      await reviewOrganizationApplication(application.id, {
        action,
        remarks: remarks.trim() || null,
        requirements: requirements.filter((requirement) => marks[requirement.id]).map((requirement) => ({
          requirement_type_id: requirement.id,
          status: marks[requirement.id],
          note: marks[requirement.id] === 'needs_changes' ? (notes[requirement.id] || '').trim() || null : null,
        })),
      });
      notify.success(message);
      await load(true);
    } catch (err) {
      setProblem(getApiErrorMessage(err, 'Could not save this decision.'));
      if (err?.response?.status === 409) load(true);
    } finally {
      setBusy('');
    }
  }

  const passAction = stage === 'dean' ? 'endorse' : 'approve';
  const passLabel = stage === 'dean' ? 'Endorse' : 'Approve';
  const passMessage = stage === 'dean' ? 'Endorsed. The SAO is next.' : 'Approved. The organization now exists.';
  const breadcrumbs = [{ label: 'Applications', to: LIST_PATH }, { label: application?.name || 'Application' }];

  return (
    <div className="max-w-3xl space-y-6 pb-8">
      <PageHeader breadcrumbs={breadcrumbs} title={application?.name || 'Application'} />

      {state.loading && <SkeletonCard />}
      {!state.loading && state.error && <ErrorState description={state.error} onRetry={() => load()} />}

      {application && (
        <>
          <section aria-label="Application" className="space-y-3">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-ink-muted">Applicant</dt>
                <dd className="break-words text-ink">{application.applicant?.name}</dd>
                <dd className="break-all text-xs text-ink-muted">{application.applicant?.email} · ID {application.applicant?.school_id}</dd>
              </div>
              <div>
                <dt className="font-medium text-ink-muted">Position</dt>
                <dd className="break-words text-ink">{application.position_title}</dd>
                <dd className="text-xs text-ink-muted">{application.college?.name}</dd>
              </div>
            </dl>
            {(application.submitted_at || application.round > 1) && (
              <p className="text-xs text-ink-muted">
                {application.submitted_at && `Sent ${manilaDate(application.submitted_at, 'long')}`}
                {application.submitted_at && application.round > 1 && '. '}
                {application.round > 1 && `Sent again, round ${application.round}`}
              </p>
            )}
            {application.description && <p className="whitespace-pre-wrap text-sm text-ink-muted-strong">{application.description}</p>}
            {application.endorsement_note && (
              <div className="border-t border-line pt-3">
                <p className="text-xs font-medium text-ink-muted">Note from the Department Head</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{application.endorsement_note}</p>
              </div>
            )}
          </section>

          <section aria-label="Requirements" className="border-t border-line pt-5">
            <h2 className="text-base font-semibold text-ink">Requirements</h2>
            <ul className="mt-3 divide-y divide-line-soft">
              {requirements.map((requirement) => {
                const mark = marks[requirement.id] || '';
                const priorReviews = requirement.reviews.filter((review) => !actionable || review.stage !== stage);
                return (
                  <li key={requirement.id} className="space-y-2 py-4 first:pt-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{requirement.name}</p>
                        {requirement.document ? <FileLink url={requirement.document.open_url}>{requirement.document.name}</FileLink> : <p className="text-sm text-danger-strong">No file attached.</p>}
                      </div>
                      {actionable && (
                        <div className="sm:w-44 sm:shrink-0">
                          <Select aria-label={`Review of ${requirement.name}`} value={mark} onChange={(event) => setMarks((current) => ({ ...current, [requirement.id]: event.target.value }))}>
                            {MARKS.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
                          </Select>
                        </div>
                      )}
                    </div>

                    {priorReviews.map((review) => (
                      <p key={review.stage} className="text-sm text-ink">
                        <span className="font-medium">{review.stage_label}:</span> {review.status === 'ok' ? 'Accepted' : (REVIEW_WORD[review.status] || review.status)}{review.note ? `. ${review.note}` : '.'}
                      </p>
                    ))}

                    {actionable && mark === 'needs_changes' && (
                      <Field label="Note for the applicant">
                        <Textarea rows={2} maxLength={1000} value={notes[requirement.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [requirement.id]: event.target.value }))} />
                      </Field>
                    )}

                    {requirement.review_files.map((file) => (
                      <ReviewFileRow key={file.id} file={file} removable={actionable && file.stage === stage} busy={Boolean(busy)} onRemove={removeFile} />
                    ))}
                    {actionable && <AttachButton label={`Attach a file to ${requirement.name}`} busy={busy === 'attach'} onFile={(file) => attach(file, requirement.id)} />}
                  </li>
                );
              })}
            </ul>
          </section>

          {(application.review_files.length > 0 || actionable) && (
            <section aria-label="Other files" className="space-y-2 border-t border-line pt-5">
              <h2 className="text-base font-semibold text-ink">Other files for the applicant</h2>
              {application.review_files.map((file) => (
                <ReviewFileRow key={file.id} file={file} removable={actionable && file.stage === stage} busy={Boolean(busy)} onRemove={removeFile} />
              ))}
              {actionable && <AttachButton label="Attach a file to the application" busy={busy === 'attach'} onFile={(file) => attach(file)} />}
            </section>
          )}

          {actionable ? (
            <section aria-label="Decision" className="space-y-4 border-t border-line pt-5">
              <h2 className="text-base font-semibold text-ink">Decision</h2>
              <Field label="Comments for the applicant" hint={stage === 'sao' ? 'Add a comment to return the application or to reject it.' : 'Add a comment to return the application.'}>
                <Textarea rows={3} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button loading={busy === passAction} disabled={Boolean(busy) || !allAccepted} onClick={() => decide(passAction, passMessage)}>{passLabel}</Button>
                <Button variant="secondary" loading={busy === 'return'} disabled={Boolean(busy) || !hasNote} onClick={() => decide('return', 'Returned to the applicant.')}>Return with comments</Button>
                {stage === 'sao' && (
                  <button type="button" disabled={Boolean(busy) || remarks.trim() === ''} onClick={() => decide('reject', 'Application not approved.')} className="inline-flex min-h-11 items-center text-sm font-medium text-danger-strong underline underline-offset-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
                    Reject application
                  </button>
                )}
              </div>
              {!allAccepted && <p className="text-xs text-ink-muted-strong">{passLabel} turns on when every requirement is Accepted.</p>}
              {problem && <p role="alert" className="text-sm font-semibold text-danger-strong">{problem}</p>}
            </section>
          ) : (
            <section aria-label="Summary" className="space-y-2 border-t border-line pt-5">
              <h2 className="text-base font-semibold text-ink">Summary</h2>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={application.status} label={APPLICATION_LABELS[application.status]} />
                <p className="text-sm text-ink">{STATUS_LINE[application.status] || ''}</p>
              </div>
              {application.remarks && (
                <div>
                  <p className="text-xs font-medium text-ink-muted">Last note</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{application.remarks}</p>
                </div>
              )}
              {problem && <p role="alert" className="text-sm font-semibold text-danger-strong">{problem}</p>}
              <Button variant="secondary" to={LIST_PATH} className="mt-2">Back to applications</Button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
