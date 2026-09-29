import { useCallback, useEffect, useState } from 'react';
import { Building2, PencilLine, Plus, Search, Users } from 'lucide-react';
import { createSystemOrganization, getSystemColleges, getSystemOrganizations, updateSystemOrganization } from '../../../services/systemAdministrationService';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { fetchAllPages } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';

const empty = { name: '', acronym: '', college: '', parent_organization_id: '', description: '', is_active: true };
const inputClass = 'mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 font-normal outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20';

export default function SystemOrganizationsPage() {
  const [items, setItems] = useState([]);
  const [parentItems, setParentItems] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (requestedPage = page) => {
    setLoading(true);
    try {
      const data = await getSystemOrganizations({ search, per_page: 100, page: requestedPage });
      setItems(data.data || []);
      setPage(data.current_page || requestedPage);
      setLastPage(data.last_page || 1);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load organizations.'));
    } finally {
      setLoading(false);
    }
  }, [page, search]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([getSystemColleges(), fetchAllPages((params) => getSystemOrganizations(params))])
      .then(([collegeList, organizations]) => { setColleges(collegeList); setParentItems(organizations); })
      .catch((cause) => setError(getApiErrorMessage(cause, 'Unable to load organization options.')));
  }, []);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { ...form, parent_organization_id: form.parent_organization_id || null };
      if (form.id) await updateSystemOrganization(form.id, payload);
      else await createSystemOrganization(payload);
      setForm(null);
      setNotice(form.id ? 'Organization updated.' : 'Organization added.');
      await load();
      setParentItems(await fetchAllPages((params) => getSystemOrganizations(params)));
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not save the organization.'));
    } finally {
      setBusy(false);
    }
  }

  const parents = parentItems.filter((organization) => !organization.parent_organization_id && organization.is_active);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-lg bg-[#0B1831] p-6 text-white sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#16C7F3]">SAO administration</p><h2 className="mt-2 text-2xl font-black">Organizations</h2><p className="mt-1 text-sm text-slate-300">Register main organizations and their suborganizations.</p></div>
        <button type="button" onClick={() => setForm(empty)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#16C7F3] px-4 text-sm font-bold text-[#0B1831]"><Plus size={17} /> Add organization</button>
      </section>
      <div className="rounded-lg border border-[#DDE7EF] bg-white p-4"><div className="flex gap-2"><label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3"><Search size={16} className="text-slate-500" /><input aria-label="Search organizations" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} onKeyDown={(event) => event.key === 'Enter' && load()} placeholder="Search name, code, or department" className="w-full outline-none" /></label><button type="button" onClick={() => load()} className="rounded-lg bg-[#0F2F62] px-4 text-sm font-bold text-white">Search</button></div></div>
      {error && !form && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" onClick={() => load()} className="font-bold underline">Retry</button></p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading && <p role="status" className="rounded-lg border border-[#DDE7EF] bg-white p-4 text-sm text-slate-600">Loading organizations...</p>}
      <section className="grid gap-4 lg:grid-cols-2">
        {items.map((org) => <article key={org.id} className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex justify-between gap-3"><div className="flex gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]"><Building2 size={19} /></span><div><h3 className="font-bold text-slate-900">{org.name}</h3><p className="text-xs font-semibold text-slate-500">{org.acronym} · {org.college || 'No department assigned'}</p>{org.parent_organization && <p className="mt-1 text-xs text-[#0878B7]">Part of {org.parent_organization.name}</p>}</div></div><span className={`h-fit rounded-full px-2 py-1 text-[10px] font-bold ${org.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{org.is_active ? 'ACTIVE' : 'INACTIVE'}</span></div><p className="mt-4 min-h-10 text-sm text-slate-600">{org.description || 'No organization description yet.'}</p><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500"><span className="inline-flex items-center gap-1"><Users size={14} /> {org.users_count} members · {org.administrators?.length || 0} admins</span><button type="button" onClick={() => setForm(org)} className="inline-flex min-h-11 items-center gap-1 text-[#0878B7]"><PencilLine size={14} /> Edit</button></div></article>)}
      </section>
      {!loading && !items.length && <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No student organizations match this view.</div>}
      {lastPage > 1 && <nav aria-label="Organization pages" className="flex items-center justify-end gap-3 text-xs font-semibold text-slate-600"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-40">Previous</button><span>Page {page} of {lastPage}</span><button type="button" disabled={loading || page >= lastPage} onClick={() => setPage(page + 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-40">Next</button></nav>}
      {form && <AccessibleOverlay label={form.id ? 'Edit organization' : 'Add organization'} onClose={() => !busy && setForm(null)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-2xl"><h3 className="text-lg font-black text-slate-900">{form.id ? 'Edit organization' : 'Add organization'}</h3>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="mt-5 grid gap-3">
        <label className="text-sm font-semibold text-slate-700">Organization name<input required value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-semibold text-slate-700">Organization code<input required value={form.acronym || ''} onChange={(event) => setForm({ ...form, acronym: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-semibold text-slate-700">Main organization<select value={form.parent_organization_id || ''} onChange={(event) => setForm({ ...form, parent_organization_id: event.target.value })} className={inputClass}><option value="">This is a main organization</option>{parents.filter((parent) => parent.id !== form.id).map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Department / college<select required={Boolean(form.parent_organization_id)} value={form.college || ''} onChange={(event) => setForm({ ...form, college: event.target.value })} className={inputClass}><option value="">Select a college</option>{form.college && !colleges.some((college) => college.name === form.college) && <option value={form.college}>{form.college}</option>}{colleges.filter((college) => college.is_active || college.name === form.college).map((college) => <option key={college.id} value={college.name}>{college.name}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Description<textarea value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-[#DDE7EF] p-3 font-normal outline-[#0B8ED0]" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Active organization</label>
      </div><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setForm(null)} className="min-h-11 rounded-lg px-4 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button><button disabled={busy} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white">{busy ? 'Saving…' : 'Save organization'}</button></div></form></AccessibleOverlay>}
    </div>
  );
}
