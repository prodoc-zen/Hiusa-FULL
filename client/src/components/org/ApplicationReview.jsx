import { useCallback, useEffect, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { Button, ErrorState, Field, PageHeader, Select, SkeletonCard, StatusBadge, Textarea } from '../ui';
import api from '../../services/api';
import notify from '../../lib/notify';
import { manilaDate } from '../../lib/format';
import { attachReviewFile, getOrganizationApplication, removeReviewFile, reviewOrganizationApplication } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { APPLICATION_LABELS } from './applicationStatus';

// A comment-only note: it saves without a decision and the applicant does not see it.
const commentOnApplication = (id, data) => api.post(`/organization-applications/${id}/comments`, data);

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

// The one word on a collapsed requirement row. A problem outranks an acceptance, so a row that any
// reviewer flagged never reads as Accepted.
// A file the applicant did not change since this reviewer accepted it comes back from the server already accepted.
function carriedMarks(application, stage) {
  return Object.fromEntries((application?.requirements ?? [])
    .filter((requirement) => requirement.reviews.some((review) => review.stage === stage && review.carried))
    .map((requirement) => [requirement.id, 'ok']));
}

function worstStatus(reviews) {
  if (reviews.some((review) => review.status === 'needs_changes')) return 'needs_changes';
  if (reviews.some((review) => review.status === 'missing')) return 'missing';
  if (reviews.length > 0 && reviews.every((review) => review.status === 'ok')) return 'ok';
  return '';
}

function RowStatus({ state }) {
  return state
    ? <StatusBadge status={state} label={REVIEW_WORD[state]} />
    : <StatusBadge status="pending" tone="neutral" label="Not checked" />;
}

const LINK_BUTTON = 'inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

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
  const [openId, setOpenId] = useState(null);
  const [notes, setNotes] = useState({});
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');

  const load = useCallback((silent = false) => {
    if (!silent) setState({ loading: true, error: null, application: null });
    return getOrganizationApplication(applicationId)
      .then((res) => {
        if (!silent) setMarks(carriedMarks(res.data, stage));
        setState({ loading: false, error: null, application: res.data });
      })
      .catch((err) => setState({ loading: false, error: err?.response?.status === 404 ? 'This application is not in your queue.' : getApiErrorMessage(err, 'Could not load this application.'), application: null }));
  }, [applicationId, stage]);

  useEffect(() => {
    setMarks({});
    setOpenId(null);
    setNotes({});
    setRemarks('');
    setProblem('');
    setCommenting(false);
    setComment('');
    load();
  }, [applicationId, load]);

  const { application } = state;
  const actionable = application?.status === waiting;
  const requirements = application?.requirements ?? [];
  const flagged = requirements.filter((requirement) => marks[requirement.id] === 'needs_changes');
  const allAccepted = requirements.length > 0 && requirements.every((requirement) => marks[requirement.id] === 'ok');
  const notChecked = requirements.filter((requirement) => requirement.document && !marks[requirement.id]);
  const carriedCount = Object.keys(carriedMarks(application, stage)).length;
  const hasNote = remarks.trim() !== '' || flagged.some((requirement) => (notes[requirement.id] || '').trim() !== '');

  const acceptNotChecked = () => setMarks((current) => ({ ...current, ...Object.fromEntries(notChecked.map((requirement) => [requirement.id, 'ok'])) }));

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

  async function saveComment() {
    setBusy('comment');
    setProblem('');
    try {
      await commentOnApplication(application.id, { note: comment.trim() });
      notify.success('Comment saved.');
      setComment('');
      setCommenting(false);
      await load(true);
    } catch (err) {
      setProblem(getApiErrorMessage(err, 'Could not save this comment.'));
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">Requirements</h2>
              {actionable && notChecked.length > 0 && <Button variant="secondary" size="sm" disabled={Boolean(busy)} onClick={acceptNotChecked}>Accept all not checked</Button>}
            </div>
            {actionable && carriedCount > 0 && <p className="mt-2 text-sm text-ink-muted-strong">{carriedCount === 1 ? '1 file is' : `${carriedCount} files are`} unchanged since you accepted {carriedCount === 1 ? 'it' : 'them'}, so {carriedCount === 1 ? 'it starts' : 'they start'} as Accepted.</p>}
            <ul className="mt-3 divide-y divide-line-soft">
              {requirements.map((requirement) => {
                const mark = marks[requirement.id] || '';
                const priorReviews = requirement.reviews.filter((review) => !actionable || review.stage !== stage);
                // One word per row. While deciding it is this reviewer's own mark, so an unmarked row reads
                // Not checked even if the Department Head accepted it. Otherwise it is what the record says.
                const state = actionable ? (mark || (requirement.document ? '' : 'missing')) : (requirement.document ? worstStatus(priorReviews) : 'missing');
                const needsAction = state === 'needs_changes' || state === 'missing' || priorReviews.some((review) => review.status !== 'ok');
                const hasDetail = priorReviews.some((review) => review.note) || requirement.review_files.length > 0;
                const open = openId === requirement.id;
                const expanded = open || needsAction;
                // A row that needs nothing stays one line. The reviewer can open any row to change it.
                const toggle = !needsAction && (actionable || hasDetail);
                const toggleLabel = actionable ? (open ? 'Close' : (mark ? 'Change' : 'Review')) : (open ? 'Hide details' : 'Details');
                return (
                  <li key={requirement.id} className="py-3 first:pt-0">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
                        <p className="min-w-0 break-words text-sm font-semibold text-ink">{requirement.name}</p>
                        <RowStatus state={state} />
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-4 sm:justify-end">
                        {requirement.document ? <FileLink url={requirement.document.open_url}>{requirement.document.name}</FileLink> : <p className="text-sm text-danger-strong">No file attached.</p>}
                        {toggle && (
                          <button type="button" aria-expanded={open} aria-label={`${toggleLabel} ${requirement.name}`} onClick={() => setOpenId(open ? null : requirement.id)} className={LINK_BUTTON}>{toggleLabel}</button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-2 space-y-2">
                        {actionable && (
                          <div className="sm:w-44">
                            <Select aria-label={`Review of ${requirement.name}`} value={mark} onChange={(event) => { setOpenId(requirement.id); setMarks((current) => ({ ...current, [requirement.id]: event.target.value })); }}>
                              {MARKS.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
                            </Select>
                          </div>
                        )}

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
                      </div>
                    )}
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

          {application.history?.length > 0 && (
            <section aria-label="History" className="border-t border-line pt-5">
              <h2 className="text-base font-semibold text-ink">History</h2>
              <ul className="mt-3 divide-y divide-line-soft">
                {application.history.map((entry) => (
                  <li key={entry.id} className="space-y-1 py-3 first:pt-0">
                    <p className="text-sm text-ink">
                      <span className="font-semibold">{entry.label}</span>
                      <span className="text-ink-muted-strong">{entry.by ? `, ${entry.by}` : ''} ({entry.stage_label}), {manilaDate(entry.at, 'long')}</span>
                    </p>
                    {entry.note && <p className="whitespace-pre-wrap text-sm text-ink">{entry.note}</p>}
                  </li>
                ))}
              </ul>
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
              <div className="border-t border-line pt-3">
                {commenting ? (
                  <div className="space-y-3">
                    <Field label="Comment" hint="For the reviewers of this application. The applicant does not see it.">
                      <Textarea rows={3} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button variant="secondary" loading={busy === 'comment'} disabled={Boolean(busy) || comment.trim() === ''} onClick={saveComment}>Save comment</Button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => { setCommenting(false); setComment(''); }} className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setCommenting(true)} className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Add a comment</button>
                )}
              </div>
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
