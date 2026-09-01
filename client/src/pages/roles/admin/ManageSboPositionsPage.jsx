import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, PencilLine, Plus, Search, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { createSboPosition, deleteSboPosition, getSboPositions, updateSboPosition } from '../../../services/userService';

const PAGE_SIZE = 10;
const EMPTY_FORM = { role: 'ADMIN', title: '', description: '', is_active: true };
const ROLE_LABELS = { ADMIN: 'Admin', SBO_OFFICER: 'SBO Officer' };

function firstError(error, fallback) {
  const errors = error.response?.data?.errors;
  if (errors) return Object.values(errors).flat()[0] || fallback;
  return error.response?.data?.message || fallback;
}

export default function ManageSboPositionsPage() {
  const [positions, setPositions] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formMode, setFormMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const load = async () => {
    setLoading(true); setError('');
    try { setPositions(await getSboPositions()); }
    catch { setError('Unable to load organization positions.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return positions.filter((position) => (!roleFilter || position.role === roleFilter)
      && (!query || `${position.title} ${position.description || ''}`.toLowerCase().includes(query)));
  }, [positions, roleFilter, search]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, roleFilter]);
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > lastPage) setPage(lastPage);
  }, [filtered.length, page]);

  const openCreate = () => { setForm(EMPTY_FORM); setEditingId(null); setFormError(''); setFormMode('create'); };
  const openEdit = (position) => {
    setForm({ role: position.role, title: position.title, description: position.description || '', is_active: Boolean(position.is_active) });
    setEditingId(position.id); setFormError(''); setFormMode('edit');
  };
  const closeForm = () => { if (!busy) { setFormMode(null); setEditingId(null); setFormError(''); } };

  const submit = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    if (title.length < 2) { setFormError('Position title must contain at least 2 characters.'); return; }
    setBusy(true); setFormError('');
    const payload = { ...form, title, description: form.description.trim() || null };
    try {
      if (formMode === 'edit') await updateSboPosition(editingId, payload);
      else await createSboPosition(payload);
      await load();
      setFormMode(null); setEditingId(null);
      setFeedback({ open: true, type: 'success', message: `Position ${formMode === 'edit' ? 'updated' : 'created'} successfully.` });
    } catch (requestError) { setFormError(firstError(requestError, 'Unable to save this position.')); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteSboPosition(deleteTarget.id);
      await load();
      setDeleteTarget(null);
      setFeedback({ open: true, type: 'success', message: `${deleteTarget.title} was deleted. Assigned users were safely unassigned.` });
    } catch (requestError) {
      setDeleteTarget(null);
      setFeedback({ open: true, type: 'error', message: firstError(requestError, 'Unable to delete this position.') });
    } finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false, type: 'success', message: '' })} />
    <section className="flex flex-col gap-4 rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Organization access structure</p><h2 className="mt-1 text-2xl font-black text-[#0F172A]">Manage Positions</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Create and maintain positions separately for Admin and SBO Officer accounts. Students and Department Heads cannot be assigned these positions.</p></div>
      <button type="button" onClick={openCreate} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7]"><Plus size={16} />Add Position</button>
    </section>

    <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-4 sm:flex-row">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3"><Search size={15} className="text-slate-400" /><span className="sr-only">Search positions</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or responsibilities..." className="w-full bg-transparent text-sm outline-none" /></label>
        <select aria-label="Filter positions by account role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="">All account roles</option><option value="ADMIN">Admin</option><option value="SBO_OFFICER">SBO Officer</option></select>
      </div>
      {error && <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Position</th><th className="px-5 py-3">Account Role</th><th className="px-5 py-3">Responsibilities</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-[#E5EDF3]">
        {loading ? Array.from({ length: 5 }, (_, index) => <tr key={index}>{Array.from({ length: 5 }, (__, cell) => <td key={cell} className="px-5 py-4"><div className="h-4 animate-pulse rounded bg-slate-100" /></td>)}</tr>) : paged.map((position) => <tr key={position.id} className="hover:bg-[#F8FBFD]"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><BriefcaseBusiness size={16} /></span><strong className="text-sm text-[#0F172A]">{position.title}</strong></div></td><td className="px-5 py-4 text-sm font-semibold text-slate-600">{ROLE_LABELS[position.role] || position.role}</td><td className="max-w-md px-5 py-4 text-sm text-slate-500">{position.description || 'No responsibilities recorded.'}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${position.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{position.is_active ? 'Active' : 'Inactive'}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button type="button" aria-label={`Edit ${position.title}`} title="Edit position" onClick={() => openEdit(position)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#DDE7EF] text-[#0B8ED0] hover:bg-[#EEF6FB]"><PencilLine size={15} /></button><button type="button" aria-label={`Delete ${position.title}`} title="Delete position" onClick={() => setDeleteTarget(position)} className="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><Trash2 size={15} /></button></div></td></tr>)}
      </tbody></table></div>
      {!loading && paged.length === 0 && <p className="p-10 text-center text-sm text-slate-400">No positions match the current filters.</p>}
      <PaginationControls currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} label="positions" />
    </section>

    <Modal open={Boolean(formMode)} title={formMode === 'edit' ? 'Edit Position' : 'Add Position'} description="Positions determine which titles can be assigned in Manage Users." onClose={closeForm} closeOnBackdrop={!busy} closeOnEscape={!busy} footer={<><button type="button" onClick={closeForm} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600">Cancel</button><button type="submit" form="position-form" disabled={busy || !form.title.trim()} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save Position'}</button></>}>
      <form id="position-form" onSubmit={submit} className="space-y-4"><label className="block text-sm font-semibold text-[#0F172A]">Assignable account role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} required className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="ADMIN">Admin</option><option value="SBO_OFFICER">SBO Officer</option></select></label><label className="block text-sm font-semibold text-[#0F172A]">Position title<input data-autofocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={2} maxLength={100} placeholder="e.g. President" className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" /></label><label className="block text-sm font-semibold text-[#0F172A]">Responsibilities<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} rows={4} placeholder="Describe this position's responsibilities." className="mt-1.5 w-full resize-none rounded-lg border border-[#DDE7EF] p-3 text-sm outline-none focus:border-[#0B8ED0]" /></label><label className="flex items-center gap-3 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 text-sm font-semibold"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} className="h-4 w-4 accent-[#0B8ED0]" />Available for assignment</label>{formError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{formError}</p>}</form>
    </Modal>
    <ConfirmModal open={Boolean(deleteTarget)} title="Delete Position" message="Assigned users will have this position safely cleared before deletion." recordName={deleteTarget ? `${deleteTarget.title} · ${ROLE_LABELS[deleteTarget.role]}` : ''} confirmText="Delete Position" busy={busy} onCancel={() => !busy && setDeleteTarget(null)} onConfirm={confirmDelete} />
  </div>;
}
