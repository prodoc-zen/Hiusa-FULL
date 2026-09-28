import { useCallback, useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { downloadEventRequirementFile, getEventSubmission, submitEventRequirements } from '../../services/eventService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function EventSubmissionPanel({ eventId, role, onSubmitted }) {
  const [submission, setSubmission] = useState(null);
  const [files, setFiles] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await getEventSubmission(eventId);
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

  async function download(file) {
    try {
      const response = await downloadEventRequirementFile(eventId, file.id);
      const url = URL.createObjectURL(response.data);
      const link = Object.assign(document.createElement('a'), { href: url, download: file.original_name });
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not download the file.'));
    }
  }

  if (!submission && !error) return <p className="text-xs text-slate-500">Loading event requirements…</p>;
  const requirements = submission?.requirements || [];
  const uploaded = submission?.files || [];
  const maySubmit = role === 'ADMIN' && requirements.length > 0 && (!submission?.approval_status || submission.approval_status === 'rejected');

  return <section className="rounded-lg border border-[#DDE7EF] bg-white p-4">
    <div className="flex items-center gap-2 text-[#0F2F62]"><FileText size={17} /><h3 className="text-sm font-bold">SAO event requirements</h3></div>
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Retry</button></p>}
    {!requirements.length && !uploaded.length && <p className="mt-2 text-xs text-slate-500">SAO has not listed any file requirements.</p>}
    {uploaded.length > 0 && <div className="mt-3 space-y-2">{uploaded.map((file) => <div key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#DDE7EF] px-3 py-2"><span className="text-xs"><strong>{file.requirement?.name}</strong> · {file.original_name}</span><button type="button" onClick={() => download(file)} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[#0878B7]"><Download size={14} />Download</button></div>)}</div>}
    {maySubmit && <form onSubmit={submit} className="mt-3 space-y-3"><p className="text-xs text-slate-600">Upload every listed file to send this event to SAO. The Department Head can view the submission.</p>{requirements.map((requirement) => <label key={requirement.id} className="block text-xs font-semibold text-[#0F172A]">{requirement.name} <span className="font-normal text-slate-500">({requirement.allowed_extensions.join(', ')})</span>{requirement.description && <span className="mt-1 block font-normal text-slate-600">{requirement.description}</span>}<input required type="file" accept={requirement.allowed_extensions.map((extension) => `.${extension}`).join(',')} onChange={(event) => setFiles((current) => ({ ...current, [requirement.id]: event.target.files?.[0] || null }))} className="mt-1 block min-h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 py-2 text-xs" /></label>)}<button disabled={busy} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Submitting…' : 'Submit event files to SAO'}</button></form>}
    {submission?.approval_status && <p className="mt-3 text-xs font-semibold text-[#0F2F62]">Review: {submission.approval_status.replaceAll('_', ' ')}</p>}
  </section>;
}
