import FieldIcon from '../../../components/FieldIcon.jsx';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useState } from 'react';
import { Building2, PencilLine, Plus, Search, Trash2 } from 'lucide-react';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { createSystemCollege, deleteSystemCollege, getSystemColleges, updateSystemCollege } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';

const empty = { name: '', code: '', description: '', color: '#0B8ED0', is_active: true };
const inputClass = 'mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm focus:border-[#0B8ED0] focus:outline-none focus:ring-2 focus:ring-[#16C7F3]/30';

function CollegeFormModal({ college, busy, error, onClose, onSave }) {
  const [form, setForm] = useState(college || empty);
  return <AccessibleOverlay label={college ? 'Edit college' : 'Add college'} onClose={() => !busy && onClose()} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
    <form onSubmit={(event) => { event.preventDefault(); onSave(form); }} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 sm:p-6">
      <h2 className="text-lg font-bold text-[#0F172A]">{college ? 'Edit college' : 'Add college'}</h2><p className="mt-1 text-sm text-slate-600">Colleges can be assigned to student organizations.</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 space-y-3"><label className="block text-xs font-bold text-slate-700"><FieldIcon label="College name" />College name<input required maxLength={255} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label><label className="block text-xs font-bold text-slate-700"><FieldIcon label="Code (optional)" />Code (optional)<input maxLength={50} value={form.code || ''} onChange={(event) => setForm({ ...form, code: event.target.value })} className={inputClass} /></label><label className="block text-xs font-bold text-slate-700"><FieldIcon label="College color" />College color<input type="color" value={form.color || '#0B8ED0'} onChange={(event) => setForm({ ...form, color: event.target.value })} className="mt-1 h-11 w-20 rounded-lg border border-[#DDE7EF] bg-white p-1" /></label><div className="block text-xs font-bold text-slate-700"><label htmlFor="college-description"><FieldIcon label="Description" />Description</label><RichTextEditor id="college-description" maxLength={2000} rows={3} value={form.description || ''} onChange={(description) => setForm({ ...form, description })} /></div><label className="flex min-h-11 items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> <FieldIcon label="Active college" />Active college</label></div>
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy || !form.name.trim()} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving...' : college ? 'Save changes' : 'Add college'}</button></div>
    </form>
  </AccessibleOverlay>;
}

export default function SystemCollegesPage() {
  const [colleges, setColleges] = useState([]);
  const [search, setSearch] = useState('');
  const [formCollege, setFormCollege] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setColleges(await getSystemColleges());
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load colleges.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(form) {
    setBusy(true);
    setFormError('');
    try {
      const payload = { ...form, name: form.name.trim(), code: form.code?.trim() || null };
      if (formCollege) await updateSystemCollege(formCollege.id, payload);
      else await createSystemCollege(payload);
      setFormCollege(undefined);
      setNotice(formCollege ? 'College updated.' : 'College added.');
      await load();
    } catch (cause) {
      setFormError(getApiErrorMessage(cause, 'Could not save the college.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(college) {
    if (!window.confirm(`Delete ${college.name}?`)) return;
    setBusy(true);
    try {
      await deleteSystemCollege(college.id);
      setNotice('College deleted.');
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not delete the college.'));
    } finally {
      setBusy(false);
    }
  }

  const visible = colleges.filter((college) => [college.name, college.code].some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase())));
  return <div className="space-y-5">
    <div className="flex justify-end"><button type="button" onClick={() => { setFormError(''); setFormCollege(null); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white"><Plus size={17} />Add College</button></div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Retry</button></p>}
    {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3 text-slate-600"><Search size={17} /><input aria-label="Search colleges" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search college name or code" className="w-full bg-transparent text-sm outline-none" /></label>
    {loading ? <p role="status" className="rounded-lg border border-[#DDE7EF] bg-white p-6 text-sm text-slate-600">Loading colleges...</p> : <section className="grid gap-3 md:grid-cols-2">{visible.map((college) => <article key={college.id} className="rounded-lg border border-[#DDE7EF] bg-white p-4"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0F2F62]" style={college.color ? { borderLeft: `4px solid ${college.color}` } : undefined}><Building2 size={19} /></span><div className="min-w-0 flex-1"><h2 className="break-words text-sm font-bold text-[#0F172A]">{college.name}</h2><p className="mt-1 text-xs text-slate-600">{college.code || 'No code'} · {college.organizations_count} organization(s) · {college.is_active ? 'Active' : 'Inactive'}</p>{college.description && <RichTextBody value={college.description} className="mt-2 break-words text-xs text-slate-600" />}</div></div><div className="mt-4 flex justify-end gap-2 border-t border-[#DDE7EF] pt-3"><button type="button" disabled={busy} onClick={() => { setFormError(''); setFormCollege(college); }} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-bold text-[#0878B7]"><PencilLine size={15} />Edit</button><button type="button" disabled={busy || college.organizations_count > 0} onClick={() => remove(college)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-bold text-red-700 disabled:opacity-40" title={college.organizations_count > 0 ? 'Reassign organizations before deleting' : undefined}><Trash2 size={15} />Delete</button></div></article>)}</section>}
    {!loading && !visible.length && <p className="rounded-lg border border-dashed border-[#DDE7EF] bg-white p-8 text-center text-sm text-slate-600">{colleges.length ? 'No colleges match your search.' : 'No colleges yet. Add the first college.'}</p>}
    {formCollege !== undefined && <CollegeFormModal key={formCollege?.id || 'new'} college={formCollege} busy={busy} error={formError} onClose={() => setFormCollege(undefined)} onSave={save} />}
  </div>;
}
