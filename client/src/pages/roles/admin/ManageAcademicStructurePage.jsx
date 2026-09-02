import { useEffect, useState } from 'react';
import { BookOpen, Check, Layers, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { createAcademicProgram, deleteAcademicProgram, getAcademicStructure, updateAcademicProgram } from '../../../services/userService';

const YEARS = [['1', '1st Year'], ['2', '2nd Year'], ['3', '3rd Year'], ['4', '4th Year']];
const EMPTY_FORM = { name: '', sections: { 1: 0, 2: 0, 3: 0, 4: 0 } };

function programForm(program) {
  return {
    name: program.name,
    sections: Object.fromEntries(YEARS.map(([year]) => [year, program.sections?.filter((section) => Number(section.year_level) === Number(year) && !section.name.includes('Non Block')).length || 0])),
  };
}

function firstError(error, fallback) {
  const errors = error?.response?.data?.errors;
  return (errors && Object.values(errors).flat()[0]) || error?.response?.data?.message || fallback;
}

function SectionCountFields({ form, setForm }) {
  return <fieldset><legend className="text-[13px] font-semibold text-[#0F172A]">Number of block sections by year level</legend><p className="mt-1 text-xs text-slate-500">A Non Block section is always included in every year and does not count toward these block totals.</p><div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">{YEARS.map(([year, label]) => <label key={year} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><span className="block text-xs font-bold text-slate-600">{label}</span><input aria-label={`${label} sections`} type="number" min="0" max="26" value={form.sections[year]} onChange={(event) => setForm({ ...form, sections: { ...form.sections, [year]: Number(event.target.value) } })} className="mt-2 h-10 w-full rounded-md border border-[#DDE7EF] bg-white px-2 text-sm font-bold outline-none focus:border-[#0B8ED0]" /></label>)}</div></fieldset>;
}

export default function ManageAcademicStructurePage() {
  const [structure, setStructure] = useState({ department: '', programs: [] });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try { setStructure(await getAcademicStructure()); setError(''); } catch { setError('Unable to load program and section settings.'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await createAcademicProgram({ name: form.name.trim(), sections: form.sections });
      setForm(EMPTY_FORM); setSuccess('Program and its required Non Block sections were created.'); await load();
    } catch (requestError) { setError(firstError(requestError, 'Unable to save the program.')); } finally { setBusy(false); }
  };

  const beginEdit = (program) => { setEditing(program); setEditForm(programForm(program)); setError(''); setSuccess(''); };
  const saveEdit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await updateAcademicProgram(editing.id, { name: editForm.name.trim(), sections: editForm.sections });
      setEditing(null); setSuccess('Program and section settings were updated.'); await load();
    } catch (requestError) { setError(firstError(requestError, 'Unable to update the program.')); } finally { setBusy(false); }
  };
  const confirmDelete = async () => {
    setBusy(true); setError(''); setSuccess('');
    try {
      await deleteAcademicProgram(deleteTarget.id); setDeleteTarget(null); setSuccess('Program and its sections were deleted.'); await load();
    } catch (requestError) { setError(firstError(requestError, 'Unable to delete the program.')); setDeleteTarget(null); } finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Academic setup</p><h2 className="mt-1 text-2xl font-black text-[#0F172A]">Programs & Sections</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Create, review, update, and remove academic programs. Every program automatically includes 1st–4th Year Non Block options.</p></div>
        <div className="rounded-lg border border-[#B9D9E9] bg-[#EEF6FB] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[#0878B7]">Department</p><p className="mt-0.5 text-sm font-bold text-[#0F172A]">{structure.department || 'College of Computer Studies'}</p></div>
      </div>
      <form onSubmit={submit} className="mt-6 border-t border-[#E5EDF3] pt-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <label className="block text-[13px] font-semibold text-[#0F172A]">Course / Program<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="e.g. BS Information Technology" className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" /></label>
          <SectionCountFields form={form} setForm={setForm} />
        </div>
        <button disabled={busy || !form.name.trim()} className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50"><Plus size={16} />{busy ? 'Saving...' : 'Add Program'}</button>
      </form>
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      {success && <p className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"><Check size={15} />{success}</p>}
    </section>

    <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#DDE7EF] p-5"><BookOpen size={18} className="text-[#0B8ED0]" /><div><h3 className="font-bold text-[#0F172A]">Configured programs</h3><p className="text-xs text-slate-500">Block sections use letter labels; each year always keeps its Non Block option.</p></div></div>
      {loading ? <div className="space-y-2 p-5">{[1, 2].map((row) => <div key={row} className="h-20 animate-pulse rounded-lg bg-slate-100" />)}</div> : <div className="divide-y divide-[#E5EDF3]">{structure.programs?.length ? structure.programs.map((program) => <article key={program.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Layers size={16} className="text-[#0B8ED0]" /><h4 className="font-bold text-[#0F172A]">{program.name}</h4></div><div className="flex gap-1"><button type="button" aria-label={`Edit ${program.name}`} title="Edit program" onClick={() => beginEdit(program)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#DDE7EF] text-[#0B8ED0] hover:bg-[#EEF6FB]"><Pencil size={15} /></button><button type="button" aria-label={`Delete ${program.name}`} title="Delete program" onClick={() => setDeleteTarget(program)} className="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><Trash2 size={15} /></button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{YEARS.map(([year, label]) => { const sections = program.sections?.filter((section) => Number(section.year_level) === Number(year)) || []; return <div key={year} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2.5"><p className="text-[10px] font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-[#0F172A]">{sections.map((section) => section.name).join(', ')}</p></div>; })}</div></article>) : <p className="p-10 text-center text-sm text-slate-400">No programs have been configured yet.</p>}</div>}
    </section>

    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm" onMouseDown={() => !busy && setEditing(null)}><form onSubmit={saveEdit} onMouseDown={(event) => event.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Update academic structure</p><h3 className="mt-1 text-xl font-black text-[#0F172A]">Edit Program</h3></div><button type="button" aria-label="Close edit program" onClick={() => setEditing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><label className="mt-5 block text-[13px] font-semibold text-[#0F172A]">Course / Program<input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" /></label><div className="mt-4"><SectionCountFields form={editForm} setForm={setEditForm} /></div><p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">A section cannot be removed while user accounts are assigned to it. Renaming a program safely updates assigned user profiles.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} disabled={busy} className="h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy || !editForm.name.trim()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white disabled:opacity-50"><Save size={15} />{busy ? 'Saving...' : 'Save Changes'}</button></div></form></div>}

    {deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"><h3 className="text-lg font-black text-[#0F172A]">Delete program?</h3><p className="mt-2 text-sm text-slate-600">This permanently removes <strong>{deleteTarget.name}</strong> and all its sections. Programs assigned to users cannot be deleted.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(null)} disabled={busy} className="h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600">Cancel</button><button type="button" onClick={confirmDelete} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50"><Trash2 size={15} />{busy ? 'Deleting...' : 'Delete Program'}</button></div></div></div>}
  </div>;
}
