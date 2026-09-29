import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, FileText, Pencil, Plus, Trash2, X } from 'lucide-react';
import { createEventRequirement, deleteEventRequirement, getEventRequirements, reorderEventRequirements, updateEventRequirement } from '../../../services/eventService';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import EventSubmissionPanel from '../../../components/events/EventSubmissionPanel';
import { getApiErrorMessage } from '../../../utils/apiError';

const extensions = ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx'];
const empty = { name: '', description: '', allowed_extensions: [], is_active: true };

export default function SaoEventRequirementsPage() {
  const [requirements, setRequirements] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [remarks, setRemarks] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requirementsResponse, approvalsResponse] = await Promise.all([
        getEventRequirements(), getApprovalRequests({ entity_type: 'event', status: 'pending', per_page: 100 }),
      ]);
      setRequirements(requirementsResponse.data || []);
      setApprovals(approvalsResponse.data?.data || []);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not load event requirements.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editingId) await updateEventRequirement(editingId, form);
      else await createEventRequirement(form);
      setNotice(editingId ? 'Requirement updated.' : 'Requirement added.');
      setForm(empty);
      setEditingId(null);
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not save the requirement.'));
    } finally {
      setBusy(false);
    }
  }

  async function move(index, direction) {
    const next = [...requirements];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setBusy(true);
    try {
      const response = await reorderEventRequirements(next.map((item) => item.id));
      setRequirements(response.data);
      setNotice('Requirement order saved.');
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not reorder requirements.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(requirement) {
    if (!window.confirm(`Remove ${requirement.name}? Submitted files prevent removal; deactivate it instead if needed.`)) return;
    setBusy(true);
    try {
      await deleteEventRequirement(requirement.id);
      setNotice('Requirement removed.');
      if (editingId === requirement.id) { setEditingId(null); setForm(empty); }
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not remove the requirement.'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approval, status) {
    setBusy(true);
    try {
      await reviewApprovalRequest(approval.id, { status, remarks: remarks[approval.id] || undefined });
      setSelectedEventId(null);
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not review this event.'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-5">
    <header className="rounded-lg bg-[#0B1831] p-5 text-white"><p className="text-xs font-bold uppercase text-[#16C7F3]">Student Affairs Office</p><h1 className="mt-1 text-2xl font-black">Event requirements</h1><p className="mt-1 text-sm text-slate-300">Choose the files organizations must submit. Department Heads can view them; SAO reviews the event.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Retry</button></p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
      <div className="rounded-lg border border-[#DDE7EF] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#DDE7EF] pb-4"><div><h2 className="text-base font-bold text-[#0F172A]">Submission checklist</h2><p className="mt-1 text-xs text-slate-600">Active items require one file each. Order is shared with organizations.</p></div><span className="text-xs font-semibold text-slate-600">{requirements.filter((item) => item.is_active).length} active</span></div>
        {loading ? <p role="status" className="py-6 text-sm text-slate-600">Loading requirements...</p> : <ol className="divide-y divide-[#DDE7EF]">{requirements.map((requirement, index) => <li key={requirement.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#EEF6FB] text-xs font-bold text-[#0F2F62]">{index + 1}</span><div className="min-w-0"><p className="break-words text-sm font-bold text-[#0F172A]">{requirement.name}</p>{requirement.description && <p className="mt-1 break-words text-xs text-slate-600">{requirement.description}</p>}<p className="mt-1 text-xs text-slate-600">{(requirement.allowed_extensions || []).map((ext) => ext.toUpperCase()).join(', ')} ? {requirement.is_active ? 'Required' : 'Inactive'}</p></div></div>
          <div className="flex shrink-0 gap-1"><button type="button" disabled={busy || index === 0} aria-label={`Move ${requirement.name} up`} onClick={() => move(index, -1)} className="grid h-11 w-11 place-items-center rounded-lg border border-[#DDE7EF] text-[#0F2F62] disabled:opacity-40"><ArrowUp size={16} /></button><button type="button" disabled={busy || index === requirements.length - 1} aria-label={`Move ${requirement.name} down`} onClick={() => move(index, 1)} className="grid h-11 w-11 place-items-center rounded-lg border border-[#DDE7EF] text-[#0F2F62] disabled:opacity-40"><ArrowDown size={16} /></button><button type="button" disabled={busy} aria-label={`Edit ${requirement.name}`} onClick={() => { setEditingId(requirement.id); setForm({ name: requirement.name, description: requirement.description || '', allowed_extensions: requirement.allowed_extensions || [], is_active: requirement.is_active }); }} className="grid h-11 w-11 place-items-center rounded-lg border border-[#DDE7EF] text-[#0878B7]"><Pencil size={16} /></button><button type="button" disabled={busy} aria-label={`Remove ${requirement.name}`} onClick={() => remove(requirement)} className="grid h-11 w-11 place-items-center rounded-lg border border-red-200 text-red-700"><Trash2 size={16} /></button></div>
        </li>)}</ol>}{!loading && !requirements.length && <p className="py-6 text-sm text-slate-600">No files required yet. Add the first checklist item.</p>}
      </div>
      <form onSubmit={save} className="h-fit rounded-lg border border-[#DDE7EF] bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2 text-[#0878B7]">{editingId ? <Pencil size={17} /> : <Plus size={17} />}<h2 className="text-base font-bold text-[#0F172A]">{editingId ? 'Edit requirement' : 'Add requirement'}</h2></div>
        <p className="mt-1 text-xs text-slate-600">Each active item needs one file for an event submission.</p>
        <label className="mt-4 block text-xs font-bold text-slate-700">File name<input required maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Event proposal" className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label>
        <label className="mt-3 block text-xs font-bold text-slate-700">Instructions for organizations<textarea maxLength={500} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 w-full rounded-lg border border-[#DDE7EF] p-3 text-sm" /></label>
        <fieldset className="mt-4"><legend className="text-xs font-bold text-slate-700">Accepted file types</legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{extensions.map((extension) => <label key={extension} className="flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-2 text-xs font-semibold"><input type="checkbox" checked={form.allowed_extensions.includes(extension)} onChange={(event) => setForm((current) => ({ ...current, allowed_extensions: event.target.checked ? [...current.allowed_extensions, extension] : current.allowed_extensions.filter((value) => value !== extension) }))} />{extension.toUpperCase()}</label>)}</div></fieldset>
        <label className="mt-4 flex min-h-11 items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active requirement</label>
        <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || !form.allowed_extensions.length} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#0878B7] px-4 text-xs font-bold text-white disabled:opacity-50"><Check size={15} />{busy ? 'Saving...' : editingId ? 'Save changes' : 'Add requirement'}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="min-h-11 rounded-lg border border-[#DDE7EF] px-4 text-xs font-bold">Cancel</button>}</div>
      </form>
    </section>
    <section className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex items-center gap-2"><FileText size={17} className="text-[#0878B7]" /><h2 className="text-base font-bold text-[#0F172A]">Events waiting for SAO</h2></div><div className="mt-3 space-y-3">{approvals.map((approval) => <article key={approval.id} className="rounded-lg border border-[#DDE7EF] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-[#0F172A]">{approval.title}</h3><p className="text-xs text-slate-500">Event #{approval.entity_id} · {approval.requester?.first_name} {approval.requester?.last_name}</p></div><button type="button" onClick={() => setSelectedEventId(selectedEventId === approval.entity_id ? null : approval.entity_id)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0878B7]">{selectedEventId === approval.entity_id ? 'Hide files' : 'View files'}</button></div>{selectedEventId === approval.entity_id && <div className="mt-3"><EventSubmissionPanel eventId={approval.entity_id} role="SUPER_ADMIN" /></div>}<label className="mt-3 block text-xs font-semibold text-slate-600">Remarks for rejection<input value={remarks[approval.id] || ''} onChange={(event) => setRemarks((current) => ({ ...current, [approval.id]: event.target.value }))} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></label><div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => decide(approval, 'approved')} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-[#0878B7] px-4 text-xs font-bold text-white"><Check size={14} />Approve</button><button type="button" disabled={busy || !remarks[approval.id]?.trim()} onClick={() => decide(approval, 'rejected')} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-red-200 px-4 text-xs font-bold text-red-700 disabled:opacity-50"><X size={14} />Reject</button></div></article>)}{!approvals.length && <p className="text-sm text-slate-500">No event submissions are waiting for review.</p>}</div></section>
  </div>;
}
