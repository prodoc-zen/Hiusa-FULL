import TableRowActions from '../../../components/TableRowActions';
import { useCallback, useEffect, useState } from 'react';
import { Archive, Plus } from 'lucide-react';
import { Button, Card, Field, Input, PageHeader, Select } from '../../../components/ui';
import Modal from '../../../components/Modal';
import DateTimeInput from '../../../components/ui/DateTimeInput';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import PaginationControls from '../../../components/PaginationControls';
import { archiveGlobalAnnouncement, createGlobalAnnouncement, deleteGlobalAnnouncement, getGlobalAnnouncements, getSystemOrganizations, updateGlobalAnnouncement } from '../../../services/systemAdministrationService';
import { fetchAllPages, listMeta } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';

const ROLES = ['STUDENT', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'ADMIN'];
const FRESH = { title: '', body: '', target_scope: 'all_users', target_organization_ids: [], target_departments: [], target_roles: [], publish: false, is_important: false, is_pinned: false };

export default function GlobalAnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [readTarget, setReadTarget] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [form, setForm] = useState(null);
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ currentPage: 1, total: 0, perPage: 10 });
  const load = useCallback(() => {
    setLoading(true);
    getGlobalAnnouncements({ page, per_page: 10 }).then((data) => { setItems(data.data || []); setMeta(listMeta(data)); }).catch((e) => setError(getApiErrorMessage(e, 'Unable to load announcements.'))).finally(() => setLoading(false));
  }, [page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchAllPages(getSystemOrganizations).then(setOrganizations).catch((e) => setError(getApiErrorMessage(e, 'Unable to load organization options.'))); }, []);
  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const departments = [...new Set(organizations.map((org) => org.college).filter(Boolean))];
  const toggle = (key, value) => setForm((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((entry) => entry !== value) : [...current[key], value] }));
  function open(item = null) {
    setError(''); setImage(null);
    setForm(item ? { ...item, target_organization_ids: (item.target_organization_ids || []).map(String), target_departments: item.target_departments || [], target_roles: item.target_roles || [], publish: Boolean(item.is_published) } : FRESH);
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { ...form, target_organization_ids: form.target_organization_ids.map(Number), scheduled_at: form.scheduled_at || null, expires_at: form.expires_at || null, ...(image ? { image } : {}) };
      if (form.id) await updateGlobalAnnouncement(form.id, payload); else await createGlobalAnnouncement(payload);
      setForm(null); setImage(null); load();
    } catch (e) { setError(getApiErrorMessage(e, 'Could not save the official announcement.')); }
    finally { setBusy(false); }
  }
  async function archive(item) {
    setBusy(true); setError('');
    try { await archiveGlobalAnnouncement(item.id); load(); }
    catch (e) { setError(getApiErrorMessage(e, 'Could not archive the announcement.')); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    setBusy(true); setDeleteError('');
    try { await deleteGlobalAnnouncement(deleteTarget.id); setDeleteTarget(null); load(); }
    catch (e) { setDeleteError(getApiErrorMessage(e, 'Could not delete this draft.')); }
    finally { setBusy(false); }
  }
  const firstRun = !loading && !error && !items.length;
  const createButton = <Button leftIcon={Plus} onClick={() => open()}>Create official notice</Button>;
  return <div className="space-y-5">
    <PageHeader primary={firstRun ? undefined : createButton} />
    {error && !form && <p role="alert" className="text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Retry</button></p>}
    {loading ? <p role="status" className="text-sm text-ink-muted">Loading announcements...</p> : <section className="grid gap-4 md:grid-cols-2">{items.map((item) => <Card key={item.id}><p className="text-xs font-semibold text-brand-700">{item.announcement_source === 'COMPLIANCE' ? `${item.source_organization?.name || 'SAO'} · Compliance reminder` : 'Student Affairs Office'}</p><h2 className="mt-1 font-bold text-ink">{item.title}</h2><p className="mt-1 text-xs text-ink-muted">{item.published_at ? 'Published' : item.is_published ? 'Scheduled' : 'Draft'}</p>{item.image_url && <img src={resolveAssetUrl(item.image_url)} alt={`Photo for ${item.title}`} className="mt-3 max-h-64 w-full rounded-lg object-contain" />}<RichTextBody value={item.body} className="mt-3 line-clamp-3 text-sm text-ink-muted" /><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><span className="text-xs text-ink-muted">{item.recipients_count || 0} recipients</span><TableRowActions subject={item.title} actions={[
      item.announcement_source === 'COMPLIANCE' && { label: 'Read reminder', onClick: () => setReadTarget(item) },
      item.announcement_source !== 'COMPLIANCE' && !item.published_at && { label: 'Edit draft', onClick: () => open(item) },
      item.announcement_source !== 'COMPLIANCE' && !item.published_at && { label: 'Delete draft', danger: true, onClick: () => { setDeleteTarget(item); setDeleteError(''); } },
      item.announcement_source !== 'COMPLIANCE' && item.is_published && { label: 'Archive', icon: Archive, disabled: busy, onClick: () => archive(item) },
    ]} /></div></Card>)}</section>}
    {firstRun && <div className="rounded-lg border border-line bg-white p-8 text-center"><p className="mb-4 text-sm text-ink-muted">No official announcements yet</p>{createButton}</div>}
    <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="announcements" />
    <Modal open={Boolean(readTarget)} title={readTarget?.title} onClose={() => setReadTarget(null)}><RichTextBody value={readTarget?.body || ''} className="text-sm text-ink" /></Modal>
    <Modal open={Boolean(deleteTarget)} title="Delete this draft?" onClose={busy ? undefined : () => setDeleteTarget(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" loading={busy} onClick={confirmDelete}>Delete draft</Button></>}><p className="text-sm text-ink-muted">{deleteTarget?.title} will be removed and never sent.</p>{deleteError && <p role="alert" className="mt-3 text-sm text-danger-strong">{deleteError}</p>}</Modal>
    <Modal open={Boolean(form)} title={form?.id ? 'Edit official announcement' : 'Create official announcement'} onClose={busy ? undefined : () => setForm(null)} maxWidth="max-w-2xl" footer={<><Button variant="secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="official-notice-form" loading={busy}>{form?.publish ? 'Publish official notice' : 'Save draft'}</Button></>}>
      {form && <form id="official-notice-form" onSubmit={save} className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Field label="Title" required><Input required maxLength={255} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Announcement" required><RichTextEditor id="official-announcement" ariaLabel="Announcement" value={form.body} onChange={(body) => setForm({ ...form, body })} rows={5} /></Field>
        <Field label="Photo (optional)" hint="JPEG, PNG, or WebP, up to 5 MB."><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file && file.size > 5 * 1024 * 1024) { setError('Choose a photo no larger than 5 MB.'); e.target.value = ''; return; } setError(''); setImage(file || null); }} /></Field>
        {(preview || form.image_url) && <img src={preview || resolveAssetUrl(form.image_url)} alt="Announcement photo preview" className="max-h-56 w-full rounded-lg object-contain" />}
        <Field label="Audience scope"><Select value={form.target_scope} onChange={(e) => setForm({ ...form, target_scope: e.target.value })}><option value="all_users">All HIUSA users</option><option value="all_organizations">All organizations</option><option value="selected_organizations">Selected organizations</option><option value="all_departments">All departments</option><option value="selected_departments">Selected departments</option></Select></Field>
        {form.target_scope === 'selected_organizations' && <fieldset><legend className="text-sm font-semibold">Organizations</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{organizations.map((org) => <label key={org.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.target_organization_ids.includes(String(org.id))} onChange={() => toggle('target_organization_ids', String(org.id))} />{org.acronym}</label>)}</div></fieldset>}
        {form.target_scope === 'selected_departments' && <fieldset><legend className="text-sm font-semibold">Departments</legend>{departments.map((department) => <label key={department} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.target_departments.includes(department)} onChange={() => toggle('target_departments', department)} />{department}</label>)}</fieldset>}
        <fieldset><legend className="text-sm font-semibold">Optional role filter</legend><div className="flex flex-wrap gap-3">{ROLES.map((role) => <label key={role} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={form.target_roles.includes(role)} onChange={() => toggle('target_roles', role)} />{role.replaceAll('_', ' ')}</label>)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Schedule (optional)"><DateTimeInput type="datetime-local" value={form.scheduled_at || ''} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></Field><Field label="Expires (optional)"><DateTimeInput type="datetime-local" value={form.expires_at || ''} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></Field></div>
        <div className="flex flex-wrap gap-4">{[['is_important', 'Important'], ['is_pinned', 'Pin announcement'], ['publish', 'Confirm publish']].map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />{label}</label>)}</div>
      </form>}
    </Modal>
  </div>;
}
