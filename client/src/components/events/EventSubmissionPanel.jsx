import { useCallback, useEffect, useState } from 'react';
import { getEventSubmission, submitEventRequirements } from '../../services/eventService';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { formatDisplayText } from '../../utils/displayText';
import { RichTextBody } from '../RichText';
import { Button } from '../ui';
import FileReviewList from '../reviews/FileReviewList';
import { describeReview, reviewLineClass } from '../approvals/EventFilesReview';

export default function EventSubmissionPanel(props) {
  return <EventSubmission key={props.eventId} {...props} />;
}

function EventSubmission({ eventId, role, onSubmitted }) {
  const [submission, setSubmission] = useState(null);
  const [files, setFiles] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await (refresh ? getEventSubmission(eventId, { cache: false }) : getEventSubmission(eventId));
      setSubmission(response.data);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not load event requirements.'));
    }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await submitEventRequirements(eventId, files);
      setSubmission(response.data);
      setFiles({});
      onSubmitted?.();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not submit event files.'));
    } finally {
      setBusy(false);
    }
  }

  async function viewTemplate(requirement) {
    if (requirement.template_url) {
      window.open(requirement.template_url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await openProtectedFile(`/event-requirements/${requirement.id}/template`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not open the sample template.'));
    }
  }

  if (!submission && !error) return <p className="text-xs text-ink-muted">Loading event requirements…</p>;
  const requirements = submission?.requirements || [];
  const uploaded = submission?.files || [];
  const byRequirement = new Map(uploaded.map((file) => [file.requirement_id, file]));
  const missingFiles = requirements.filter((requirement) => !requirement.is_optional && !byRequirement.has(requirement.id) && !files[requirement.id]).length;
  const flagged = (file) => file?.reviews?.some((review) => review.status === 'needs_changes') ?? false;
  const toReplace = requirements.filter((requirement) => flagged(byRequirement.get(requirement.id)) && !files[requirement.id]).length;
  const accepted = (file) => Boolean(file?.reviews?.length) && file.reviews.every((review) => review.status === 'ok');
  const rows = requirements.map((item) => {
    const file = byRequirement.get(item.id);
    const lines = file?.reviews?.filter((review) => review.status === 'needs_changes' || review.note) ?? [];
    const name = formatDisplayText(item.name);
    let status = { label: file ? 'Submitted' : 'Not submitted', tone: file ? 'info' : 'neutral' };
    if (flagged(file)) status = { status: 'needs_changes', label: 'Needs changes' };
    else if (accepted(file)) status = { status: 'ok', label: 'Accepted' };
    return {
      id: item.id,
      name,
      status,
      file: file ? { name: file.original_name, url: `/events/${eventId}/submission/files/${file.id}` } : null,
      emptyFile: 'No file',
      actions: item.template_url || item.template_original_name ? [{ label: 'Sample', ariaLabel: `View SAO sample for ${name}`, onClick: () => viewTemplate(item) }] : [],
      expanded: true,
      note: item.description || lines.length > 0 ? (
        <div className="space-y-1">
          {item.description && <RichTextBody value={item.description} className="text-xs text-ink-muted-strong" />}
          {lines.map((review) => <p key={review.stage} className={reviewLineClass(review)}>{describeReview(review)}</p>)}
        </div>
      ) : null,
    };
  });
  const maySubmit = role === 'ADMIN' && requirements.length > 0 && (
    !submission?.approval_status || submission.approval_status === 'rejected' || submission.approval_stage === 'awaiting_requirements'
  );

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">SAO event requirements</h3>
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-tint p-2 text-xs text-danger-strong">{error} <button type="button" onClick={() => load(true)} className="font-semibold underline">Retry</button></p>}
      {!requirements.length && !uploaded.length && <p className="mt-2 text-xs text-ink-muted">SAO has not listed any file requirements.</p>}
      {rows.length > 0 && <section aria-label="SAO event requirement files" className="mt-3 overflow-hidden rounded-card border border-line"><FileReviewList rows={rows} /></section>}
      {submission?.approval_status === 'rejected' && submission.approval_remarks && <p className="mt-3 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm text-danger-strong"><strong>Why this was returned:</strong> {submission.approval_remarks}</p>}
      {maySubmit && <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-xs text-ink-muted-strong">{uploaded.length ? 'Replace only the files that need changes. Existing files stay on record.' : 'Upload a PDF for each required item.'} The Department Head can view the submission.</p>
        {requirements.map((requirement) => <div key={requirement.id}>
          <label className="block text-xs font-semibold text-ink">
            {formatDisplayText(requirement.name)} <span className="font-normal text-ink-muted">(PDF{requirement.is_optional ? ', if applicable' : ''})</span>
            <input required={(!requirement.is_optional && !byRequirement.has(requirement.id)) || flagged(byRequirement.get(requirement.id))} type="file" accept=".pdf,application/pdf" onChange={(event) => setFiles((current) => ({ ...current, [requirement.id]: event.target.files?.[0] || null }))} className="mt-1 block min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-xs font-normal" />
          </label>
          {(requirement.template_original_name || requirement.template_url) && <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted-strong">
            <span className="break-all">SAO sample: {requirement.template_original_name || requirement.template_url}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => viewTemplate(requirement)}>View sample</Button>
          </div>}
        </div>)}
        {missingFiles > 0 && <p id="event-files-missing" className="text-xs text-ink-muted-strong">{missingFiles === 1 ? '1 file is still missing.' : `${missingFiles} files are still missing.`}</p>}
        {toReplace > 0 && <p id="event-files-replace" className="text-xs text-ink-muted-strong">{toReplace === 1 ? '1 file still needs to be replaced.' : `${toReplace} files still need to be replaced.`}</p>}
        <Button type="submit" loading={busy} disabled={missingFiles > 0 || toReplace > 0} aria-describedby={missingFiles > 0 ? 'event-files-missing' : toReplace > 0 ? 'event-files-replace' : undefined}>Submit event files</Button>
      </form>}
      {submission?.approval_status && <p className="mt-3 text-xs font-semibold text-ink">Review: {submission.approval_status.replaceAll('_', ' ')}</p>}
    </section>
  );
}
