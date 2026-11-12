import { useCallback, useEffect, useState } from 'react';
import { Eye, FileText } from 'lucide-react';
import { getEventSubmission, submitEventRequirements } from '../../services/eventService';
import { getApiErrorMessage } from '../../utils/apiError';
import { openProtectedFile } from '../../utils/openProtectedFile';
import { formatDisplayText } from '../../utils/displayText';
import { RichTextBody } from '../RichText';
import { Button, DataTable, StatusBadge } from '../ui';
import TableRowActions from '../TableRowActions';

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

  async function view(file) {
    try {
      await openProtectedFile(`/events/${eventId}/submission/files/${file.id}`);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not open the file.'));
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
  const maySubmit = role === 'ADMIN' && requirements.length > 0 && (
    !submission?.approval_status || submission.approval_status === 'rejected' || submission.approval_stage === 'awaiting_requirements'
  );

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">SAO event requirements</h3>
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-tint p-2 text-xs text-danger-strong">{error} <button type="button" onClick={() => load(true)} className="font-semibold underline">Retry</button></p>}
      {!requirements.length && !uploaded.length && <p className="mt-2 text-xs text-ink-muted">SAO has not listed any file requirements.</p>}
      {requirements.length > 0 && <div className="mt-3"><DataTable
        caption="Event requirement submissions"
        stickyHeader={false}
        rows={requirements}
        rowKey={(item) => item.id}
        columns={[
          { key: 'name', header: 'Requirement', render: (item) => <div><strong>{formatDisplayText(item.name)}</strong>{item.description && <RichTextBody value={item.description} className="mt-1 text-xs text-ink-muted-strong" />}</div> },
          { key: 'file', header: 'File', render: (item) => <span className="break-all text-xs">{byRequirement.get(item.id)?.original_name || 'No file'}</span> },
          { key: 'sample', header: 'SAO sample', render: (item) => item.template_url ? 'Link' : item.template_original_name ? 'PDF file' : 'No sample' },
          { key: 'status', header: 'Status', render: (item) => <StatusBadge label={byRequirement.has(item.id) ? 'Submitted' : 'Not submitted'} tone={byRequirement.has(item.id) ? 'info' : 'neutral'} /> },
        ]}
        actions={(item) => (byRequirement.has(item.id) || item.template_url || item.template_original_name) && <TableRowActions subject={formatDisplayText(item.name)} actions={[
          byRequirement.has(item.id) && { label: 'View submitted file', icon: Eye, onClick: () => view(byRequirement.get(item.id)) },
          (item.template_url || item.template_original_name) && { label: 'View SAO sample', icon: FileText, onClick: () => viewTemplate(item) },
        ]} />}
      /></div>}
      {submission?.approval_status === 'rejected' && submission.approval_remarks && <p className="mt-3 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm text-danger-strong"><strong>Why this was returned:</strong> {submission.approval_remarks}</p>}
      {maySubmit && <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-xs text-ink-muted-strong">{uploaded.length ? 'Replace only the files that need changes. Existing files stay on record.' : 'Upload a PDF for each required item.'} The Department Head can view the submission.</p>
        {requirements.map((requirement) => <div key={requirement.id}>
          <label className="block text-xs font-semibold text-ink">
            {formatDisplayText(requirement.name)} <span className="font-normal text-ink-muted">(PDF{requirement.is_optional ? ', if applicable' : ''})</span>
            <input required={!requirement.is_optional && !byRequirement.has(requirement.id)} type="file" accept=".pdf,application/pdf" onChange={(event) => setFiles((current) => ({ ...current, [requirement.id]: event.target.files?.[0] || null }))} className="mt-1 block min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-xs font-normal" />
          </label>
          {(requirement.template_original_name || requirement.template_url) && <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted-strong">
            <span className="break-all">SAO sample: {requirement.template_original_name || requirement.template_url}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => viewTemplate(requirement)}>View sample</Button>
          </div>}
        </div>)}
        {missingFiles > 0 && <p id="event-files-missing" className="text-xs text-ink-muted-strong">{missingFiles === 1 ? '1 file is still missing.' : `${missingFiles} files are still missing.`}</p>}
        <Button type="submit" loading={busy} disabled={missingFiles > 0} aria-describedby={missingFiles > 0 ? 'event-files-missing' : undefined}>Submit event files to SAO</Button>
      </form>}
      {submission?.approval_status && <p className="mt-3 text-xs font-semibold text-ink">Review: {submission.approval_status.replaceAll('_', ' ')}</p>}
    </section>
  );
}
