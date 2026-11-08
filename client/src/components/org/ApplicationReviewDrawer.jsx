import { useCallback, useEffect, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { Button, Drawer, ErrorState, Field, Input, Select, SkeletonCard, StatusBadge, Textarea } from '../ui';
import notify from '../../lib/notify';
import { manilaDate } from '../../lib/format';
import { attachReviewFile, getOrganizationApplication, removeReviewFile, reviewOrganizationApplication } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { APPLICATION_LABELS } from './applicationStatus';

const ATTACH_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';

const REVIEW_OPTIONS = [
  ['ok', 'OK'],
  ['needs_changes', 'Needs changes'],
  ['missing', 'Missing'],
];

async function open(url) {
  try {
    await openProtectedFile(url);
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open this file.'));
  }
}

function FileLink({ url, children, icon: Icon = FileText }) {
  return (
    <button type="button" onClick={() => open(url)} className="inline-flex min-h-11 items-center gap-2 text-left text-sm font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="break-all">{children}</span>
    </button>
  );
}

function AttachButton({ label, busy, onFile }) {
  return (
    <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-xs font-bold text-ink hover:bg-subtle focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
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

export default function ApplicationReviewDrawer({ applicationId, viewerRole, onClose, onDecided }) {
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
    if (!applicationId) return;
    setMarks({});
    setNotes({});
    setRemarks('');
    setProblem('');
    load();
  }, [applicationId, load]);

  const { application } = state;
  const actionable = application?.status === waiting;
  const flagged = application ? application.requirements.filter((requirement) => (marks[requirement.id] || 'ok') !== 'ok') : [];
  const hasNote = remarks.trim() !== '';

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
        remarks: hasNote ? remarks.trim() : null,
        requirements: application.requirements.filter((requirement) => marks[requirement.id] || notes[requirement.id]).map((requirement) => ({
          requirement_type_id: requirement.id,
          status: marks[requirement.id] || 'ok',
          note: notes[requirement.id]?.trim() || null,
        })),
      });
      notify.success(message);
      onDecided();
    } catch (err) {
      setProblem(getApiErrorMessage(err, 'Could not save this decision.'));
      if (err?.response?.status === 409) load(true);
    } finally {
      setBusy('');
    }
  }

  const passAction = stage === 'dean' ? 'endorse' : 'approve';
  const passLabel = stage === 'dean' ? 'Endorse to SAO' : 'Approve';
  const passMessage = stage === 'dean' ? 'Endorsed. The SAO is next.' : 'Approved. The organization now exists.';

  const footer = actionable ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {stage === 'sao' && (
        <Button variant="danger" loading={busy === 'reject'} disabled={Boolean(busy) || !hasNote} onClick={() => decide('reject', 'Application not approved.')}>Reject</Button>
      )}
      <Button variant="secondary" loading={busy === 'return'} disabled={Boolean(busy) || (!hasNote && flagged.length === 0)} onClick={() => decide('return', 'Returned to the applicant.')}>Return to applicant</Button>
      <Button loading={busy === passAction} disabled={Boolean(busy) || flagged.length > 0} onClick={() => decide(passAction, passMessage)}>{passLabel}</Button>
    </div>
  ) : (
    <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
  );

  return (
    <Drawer open title={application?.name || 'Application'} description={application?.acronym} onClose={busy ? undefined : onClose} width="max-w-2xl" footer={footer}>
      <div className="space-y-5 p-5">
        {state.loading && <SkeletonCard />}
        {!state.loading && state.error && <ErrorState description={state.error} onRetry={() => load()} />}

        {application && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={application.status} label={APPLICATION_LABELS[application.status]} />
              {application.submitted_at && <span className="text-xs font-medium text-ink-muted">Sent {manilaDate(application.submitted_at, 'long')}</span>}
              {application.round > 1 && <span className="text-xs font-medium text-ink-muted">Sent again, round {application.round}</span>}
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink-muted">Applicant</dt>
                <dd className="break-words text-ink">{application.applicant?.name}</dd>
                <dd className="break-all text-xs font-medium text-ink-muted">{application.applicant?.email} · ID {application.applicant?.school_id}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">Position</dt>
                <dd className="break-words text-ink">{application.position_title}</dd>
                <dd className="text-xs font-medium text-ink-muted">{application.college?.name}</dd>
              </div>
            </dl>
            {application.description && <p className="whitespace-pre-wrap text-sm text-ink-muted">{application.description}</p>}
            {application.endorsement_note && (
              <div className="rounded-control border border-line bg-subtle p-3">
                <p className="text-xs font-bold text-ink-muted">Note from the Department Head</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{application.endorsement_note}</p>
              </div>
            )}
            {application.remarks && !actionable && (
              <div className="rounded-control border border-line bg-subtle p-3">
                <p className="text-xs font-bold text-ink-muted">Last note</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{application.remarks}</p>
              </div>
            )}

            <section aria-label="Requirements" className="border-t border-line pt-4">
              <h3 className="text-base font-bold text-ink">Requirements</h3>
              <ul className="mt-3 divide-y divide-line-soft">
                {application.requirements.map((requirement) => (
                  <li key={requirement.id} className="space-y-2 py-4 first:pt-0">
                    <p className="text-sm font-bold text-ink">{requirement.name}</p>
                    {requirement.document ? <FileLink url={requirement.document.open_url}>{requirement.document.name}</FileLink> : <p className="text-sm font-medium text-danger-strong">No file attached.</p>}

                    {requirement.reviews.filter((review) => !actionable || review.stage !== stage).map((review) => (
                      <div key={review.stage} className="flex flex-wrap items-start gap-2">
                        <StatusBadge status={review.status} />
                        <p className="min-w-0 text-sm text-ink"><span className="font-semibold">{review.stage_label}:</span> {review.note || (review.status === 'ok' ? 'No problem found.' : 'No note.')}</p>
                      </div>
                    ))}

                    {actionable && (
                      <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
                        <Field label="Review">
                          <Select aria-label={`Review of ${requirement.name}`} value={marks[requirement.id] || 'ok'} onChange={(event) => setMarks((current) => ({ ...current, [requirement.id]: event.target.value }))}>
                            {REVIEW_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </Select>
                        </Field>
                        <Field label="Note to the applicant">
                          <Input aria-label={`Note for ${requirement.name}`} maxLength={1000} value={notes[requirement.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [requirement.id]: event.target.value }))} />
                        </Field>
                      </div>
                    )}

                    {requirement.review_files.map((file) => (
                      <div key={file.id} className="flex flex-wrap items-center gap-2">
                        <FileLink url={file.open_url} icon={Paperclip}>{file.name} ({file.stage_label})</FileLink>
                        {actionable && file.stage === stage && (
                          <button type="button" aria-label={`Remove ${file.name}`} disabled={Boolean(busy)} onClick={() => removeFile(file)} className="grid h-9 w-9 place-items-center rounded-control text-ink-muted hover:bg-subtle hover:text-danger-strong focus-visible:outline-2 focus-visible:outline-brand-600">
                            <X size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))}
                    {actionable && <AttachButton label={`Attach a file to ${requirement.name}`} busy={busy === 'attach'} onFile={(file) => attach(file, requirement.id)} />}
                  </li>
                ))}
              </ul>
            </section>

            {(application.review_files.length > 0 || actionable) && (
              <section aria-label="Other files" className="space-y-2 border-t border-line pt-4">
                <h3 className="text-base font-bold text-ink">Other files for the applicant</h3>
                {application.review_files.map((file) => (
                  <div key={file.id} className="flex flex-wrap items-center gap-2">
                    <FileLink url={file.open_url} icon={Paperclip}>{file.name} ({file.stage_label})</FileLink>
                    {actionable && file.stage === stage && (
                      <button type="button" aria-label={`Remove ${file.name}`} disabled={Boolean(busy)} onClick={() => removeFile(file)} className="grid h-9 w-9 place-items-center rounded-control text-ink-muted hover:bg-subtle hover:text-danger-strong focus-visible:outline-2 focus-visible:outline-brand-600">
                        <X size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                {actionable && <AttachButton label="Attach a file to the application" busy={busy === 'attach'} onFile={(file) => attach(file)} />}
              </section>
            )}

            {actionable && (
              <div className="border-t border-line pt-4">
                <Field label="General note" hint={stage === 'sao' ? 'Needed to reject. When you return it, a note or a marked requirement is enough.' : 'When you return it, a note or a marked requirement is enough.'}>
                  <Textarea rows={3} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
                </Field>
                {flagged.length > 0 && <p className="mt-2 text-xs font-semibold text-ink-muted">{stage === 'dean' ? 'Endorse' : 'Approve'} is off while a requirement is marked. Return it instead.</p>}
              </div>
            )}

            {problem && <p role="alert" className="text-sm font-semibold text-danger-strong">{problem}</p>}
          </>
        )}
      </div>
    </Drawer>
  );
}
