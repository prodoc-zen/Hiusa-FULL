import { formatDisplayText } from '../../../utils/displayText.js';
import FieldIcon from '../../../components/FieldIcon.jsx';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Archive, Building2, ExternalLink, FileText, PencilLine, Search, UserPlus, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { getSystemAgency, getSystemColleges, getSystemOrganizationOverview, getSystemOrganizations, archiveSystemOrganization, restoreSystemOrganization, reviewSystemOrganization, updateSystemOrganization, uploadSystemOrganizationLogo } from '../../../services/systemAdministrationService';
import { getComplianceDocuments } from '../../../services/complianceService';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import TableRowActions from '../../../components/TableRowActions';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import ManageAccountProfilesModal from '../../../components/users/ManageAccountProfilesModal';
import { Button, Drawer, EmptyState, ErrorState, Field, SkeletonCard, StatusBadge, Tabs, Textarea } from '../../../components/ui';
import { manilaDate } from '../../../lib/format';
import { fetchAllPages } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { organizationOverviewPath } from './agencyStatus';

const STATUS_TABS = [
  { key: 'pending', label: 'Pending review' },
  { key: 'active', label: 'Active' },
  { key: 'returned', label: 'Returned' },
  { key: 'archived', label: 'Archived' },
];
const STATUS_KEYS = STATUS_TABS.map((tab) => tab.key);
const EMPTY_COPY = {
  pending: 'No organizations are waiting for review.',
  active: 'No active student organizations match this view.',
  returned: 'No organizations are returned to their Department Head.',
  archived: 'No archived organizations.',
};
const inputClass = 'mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 font-normal outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20';

function ReviewDrawer({ organization, open, onClose, onReviewed, onStale }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [remarksError, setRemarksError] = useState('');
  const [submitting, setSubmitting] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [openingId, setOpeningId] = useState(null);
  const [fileError, setFileError] = useState('');

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, documents] = await Promise.all([
        getSystemOrganizationOverview(organization.id),
        fetchAllPages((params) => getComplianceDocuments(params).then((response) => response.data), { organization_id: organization.id, source: 'compliance' }),
      ]);
      setDetails({ overview, documents });
      setLoadError('');
    } catch (cause) {
      setLoadError(getApiErrorMessage(cause, 'Unable to load the registration details.'));
    } finally {
      setLoading(false);
    }
  }, [organization.id]);
  useEffect(() => { loadDetails(); }, [loadDetails]);

  async function openFile(document) {
    setOpeningId(document.open_url);
    setFileError('');
    try {
      await openProtectedFile(document.open_url);
    } catch (cause) {
      setFileError(getApiErrorMessage(cause, 'Could not open the file.'));
    } finally {
      setOpeningId(null);
    }
  }

  async function decide(decision) {
    const trimmed = remarks.trim();
    if (decision === 'return' && !trimmed) {
      setRemarksError('Add remarks explaining what the Department Head needs to fix.');
      return;
    }
    setRemarksError('');
    setSubmitError('');
    setSubmitting(decision);
    try {
      await reviewSystemOrganization(organization.id, decision === 'return'
        ? { decision, remarks: trimmed, submitted_at: organization.submitted_at }
        : { decision, submitted_at: organization.submitted_at });
      onReviewed(decision === 'approve' ? `${formatDisplayText(organization.name)} approved and activated.` : `${formatDisplayText(organization.name)} returned to its Department Head.`);
    } catch (cause) {
      if (cause?.response?.status === 409) {
        onStale(getApiErrorMessage(cause, 'This organization was already reviewed.'));
      } else {
        setSubmitError(getApiErrorMessage(cause, 'Could not save your decision.'));
      }
    } finally {
      setSubmitting('');
    }
  }

  const submittedBy = details?.overview?.lifecycle?.submitted_by?.name;
  const documents = details?.documents || [];

  return (
    <Drawer
      open={open}
      title="Review registration"
      description={formatDisplayText(organization.name)}
      onClose={() => !submitting && onClose()}
      width="max-w-lg"
      footer={(
        <>
          <Button variant="secondary" onClick={() => decide('return')} loading={submitting === 'return'} disabled={Boolean(submitting) || loading}>Return</Button>
          <Button onClick={() => decide('approve')} loading={submitting === 'approve'} disabled={Boolean(submitting) || loading}>Approve</Button>
        </>
      )}
    >
      <dl className="grid gap-3 text-sm">
        <div><dt className="text-xs font-semibold text-ink-muted">Organization</dt><dd className="font-bold text-ink">{formatDisplayText(organization.name)} {organization.acronym && `(${organization.acronym})`}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">College</dt><dd className="font-medium text-ink">{organization.college || 'Not assigned'}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Description</dt><dd><RichTextBody value={organization.description || 'No description provided.'} className="text-sm text-ink" /></dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Submitted</dt><dd className="font-medium text-ink">{organization.submitted_at ? manilaDate(organization.submitted_at) : 'Not available'}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Submitted by</dt><dd className="font-medium text-ink">{loading ? 'Loading...' : submittedBy || 'Not available'}</dd></div>
      </dl>

      <section aria-labelledby="registration-documents" className="mt-5 border-t border-line pt-4">
        <h3 id="registration-documents" className="text-sm font-bold text-ink">Registration documents</h3>
        {loading && <p role="status" className="mt-2 text-sm text-ink-muted">Loading registration details...</p>}
        {!loading && loadError && <ErrorState className="py-6" description={loadError} onRetry={loadDetails} />}
        {!loading && !loadError && !documents.length && <p className="mt-2 text-sm font-medium text-ink-muted">No registration documents were submitted.</p>}
        {fileError && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{fileError}</p>}
        {!loading && !loadError && documents.length > 0 && (
          <ul className="mt-2 divide-y divide-line-soft">
            {documents.map((document) => (
              <li key={`${document.source}-${document.open_url}`} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 break-words text-sm font-bold text-ink"><FileText size={15} className="shrink-0 text-brand-700" aria-hidden="true" />{document.item}</p>
                  <p className="mt-0.5 break-words text-xs font-medium text-ink-muted">{document.file_name || 'No file name'}{document.submitted_at ? ` · ${manilaDate(document.submitted_at)}` : ''}</p>
                </div>
                <Button variant="secondary" size="sm" leftIcon={ExternalLink} loading={openingId === document.open_url} disabled={!document.open_url} onClick={() => openFile(document)} aria-label={`Open ${document.file_name || document.item}`}>Open</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5 border-t border-line pt-4">
        <Field label="Remarks (required to return)" error={remarksError} hint="Shown to the Department Head when you return the registration.">
          <Textarea rows={4} maxLength={3000} value={remarks} onChange={(event) => { setRemarks(event.target.value); setRemarksError(''); }} disabled={Boolean(submitting)} />
        </Field>
        {submitError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{submitError}</p>}
      </div>
    </Drawer>
  );
}

function ArchiveModal({ organization, busy, error, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title="Archive organization"
      description={`${formatDisplayText(organization.name)} becomes read-only and its members can no longer sign in. You can restore it later.`}
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={false}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(reason.trim())} loading={busy}>Archive organization</Button>
        </>
      )}
    >
      <Field label="Reason (optional)">
        <Textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
      </Field>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

export default function SystemOrganizationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const [defaultStatus, setDefaultStatus] = useState(null);
  const status = STATUS_KEYS.includes(statusParam) ? statusParam : defaultStatus;
  const [counts, setCounts] = useState(null);
  const [items, setItems] = useState([]);
  const [parentItems, setParentItems] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [form, setForm] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [membershipOrganization, setMembershipOrganization] = useState(null);
  const [profileOrganization, setProfileOrganization] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCounts = useCallback(async () => {
    try {
      const agency = await getSystemAgency();
      const byStatus = agency?.totals?.by_lifecycle_status || {};
      setCounts(byStatus);
      return byStatus;
    } catch {
      setCounts(null);
      return null;
    }
  }, []);
  useEffect(() => {
    loadCounts().then((byStatus) => setDefaultStatus((byStatus?.pending || 0) > 0 ? 'pending' : 'active'));
  }, [loadCounts]);

  useEffect(() => {
    if (status && statusParam !== status) {
      setSearchParams((current) => { const next = new URLSearchParams(current); next.set('status', status); return next; }, { replace: true });
    }
  }, [status, statusParam, setSearchParams]);

  const load = useCallback(async (requestedPage = page) => {
    if (!status) return;
    setLoading(true);
    try {
      const data = await getSystemOrganizations({ search, lifecycle_status: status, per_page: 100, page: requestedPage });
      setItems([...(data.data || [])].sort((left, right) =>
        (left.college || '').localeCompare(right.college || '')
        || Number(Boolean(left.parent_organization_id)) - Number(Boolean(right.parent_organization_id))
        || left.name.localeCompare(right.name)));
      setPage(data.current_page || requestedPage);
      setLastPage(data.last_page || 1);
      setError('');
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Unable to load organizations.'));
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([getSystemColleges(), fetchAllPages((params) => getSystemOrganizations({ ...params, lifecycle_status: 'active' }))])
      .then(([collegeList, organizations]) => { setColleges(collegeList); setParentItems(organizations); })
      .catch((cause) => setError(getApiErrorMessage(cause, 'Unable to load organization options.')));
  }, []);

  function selectStatus(key) {
    setPage(1);
    setNotice('');
    setActionError('');
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('status', key); return next; });
  }

  async function reloadAll() {
    await Promise.all([load(), loadCounts()]);
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    let saved = null;
    try {
      const payload = {
        name: form.name,
        acronym: form.acronym,
        college_id: form.college_id,
        parent_organization_id: form.parent_organization_id || null,
        description: form.description,
        color: form.color,
        is_active: Boolean(form.is_active),
      };
      saved = await updateSystemOrganization(form.id, payload);
      if (logoFile) await uploadSystemOrganizationLogo(saved.id, logoFile);
      setForm(null);
      setLogoFile(null);
      setNotice('Organization updated.');
      await load();
      setParentItems(await fetchAllPages((params) => getSystemOrganizations({ ...params, lifecycle_status: 'active' })));
    } catch (cause) {
      if (saved) setForm(saved);
      setError(getApiErrorMessage(cause, saved ? 'Organization saved, but its logo could not be uploaded. Retry saving the logo.' : 'Could not save the organization.'));
    } finally {
      setBusy(false);
    }
  }

  function closeReview() {
    setReviewOpen(false);
  }

  function finishReview(message) {
    closeReview();
    setActionError('');
    setNotice(message);
    reloadAll();
  }

  function staleReview(message) {
    closeReview();
    setNotice('');
    setActionError(message);
    reloadAll();
  }

  async function runLifecycle(action, target, done) {
    setLifecycleBusy(true);
    setLifecycleError('');
    try {
      await action();
      setActionError('');
      setNotice(done);
      setArchiveTarget(null);
      setRestoreTarget(null);
      reloadAll();
    } catch (cause) {
      if (cause?.response?.status === 409) {
        setArchiveTarget(null);
        setRestoreTarget(null);
        setNotice('');
        setActionError(getApiErrorMessage(cause, `${formatDisplayText(target.name)} changed since you opened this page.`));
        reloadAll();
      } else if (restoreTarget) {
        setRestoreTarget(null);
        setNotice('');
        setActionError(getApiErrorMessage(cause, 'Could not restore the organization.'));
      } else {
        setLifecycleError(getApiErrorMessage(cause, 'Could not update the organization.'));
      }
    } finally {
      setLifecycleBusy(false);
    }
  }

  const parents = parentItems.filter((organization) => !organization.parent_organization_id && organization.is_active);
  const tabs = STATUS_TABS.map((tab) => ({ ...tab, label: counts ? `${tab.label} (${counts[tab.key] || 0})` : tab.label }));
  const editingBase = form ? items.find((item) => item.id === form.id) : null;

  return (
    <div className="space-y-6">
      {status && <Tabs tabs={tabs} value={status} onChange={selectStatus} />}
      <div className="rounded-lg border border-[#DDE7EF] bg-white p-4"><div className="flex gap-2"><label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3"><Search size={16} className="text-slate-500" aria-hidden="true" /><input aria-label="Search organizations" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} onKeyDown={(event) => event.key === 'Enter' && load()} placeholder="Search name, code, or department" className="w-full outline-none" /></label><button type="button" onClick={() => load()} className="min-h-11 rounded-lg bg-[#0F2F62] px-4 text-sm font-bold text-white">Search</button></div></div>
      {status === 'archived' && <p role="note" className="rounded-lg border border-line bg-subtle p-3 text-sm font-semibold text-ink">Archived organizations are read-only. Restore to make changes.</p>}
      {error && !form && <ErrorState description={error} onRetry={() => load()} />}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading && !error && <section aria-label="Loading organizations" className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></section>}
      {!loading && !error && <section className="grid gap-4 lg:grid-cols-2">
        {items.map((org, index) => {
          const lifecycle = org.lifecycle_status || status;
          const name = formatDisplayText(org.name);
          return <Fragment key={org.id}>{(index === 0 || items[index - 1].college !== org.college) && <h2 className="flex items-center gap-2 text-sm font-bold text-[#0F2F62] lg:col-span-2"><span className="h-4 w-4 rounded-sm border border-[#DDE7EF]" style={{ backgroundColor: colleges.find((college) => college.name === org.college)?.color || '#DDE7EF' }} />{org.college || 'No college assigned'}</h2>}<article className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex justify-between gap-3"><div className="flex gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#E6F6FD] text-[#0F2F62]" style={{ borderLeft: `4px solid ${org.color || '#0B8ED0'}` }}>{org.logo_url ? <img src={resolveAssetUrl(org.logo_url)} alt="" className="h-full w-full object-cover" /> : <Building2 size={19} aria-hidden="true" />}</span><div><h3 className="font-bold text-slate-900">{name}</h3><p className="text-xs font-semibold text-slate-500">{org.acronym} · {org.college || 'No department assigned'}</p>{org.parent_organization && <p className="mt-1 text-xs font-semibold text-[#0878B7]">Sub organization of {formatDisplayText(org.parent_organization.name)}</p>}</div></div><StatusBadge status={lifecycle} className="h-fit" /></div><RichTextBody value={org.description || 'No organization description yet.'} className="mt-4 min-h-10 text-sm text-slate-600" />
            {lifecycle === 'pending' && org.submitted_at && <p className="mt-3 text-xs font-semibold text-slate-500">Submitted {manilaDate(org.submitted_at)}</p>}
            {lifecycle === 'returned' && <p className="mt-3 rounded-lg bg-subtle p-3 text-sm text-ink"><span className="block text-xs font-bold text-ink-muted">Returned with remarks</span>{org.review_remarks || 'No remarks were recorded.'}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500"><span className="inline-flex items-center gap-1"><Users size={14} aria-hidden="true" /> {org.users_count} members · {org.administrators_count ?? org.administrators?.length ?? 0} admins</span>
              <span className="flex items-center gap-1">
                <Button to={organizationOverviewPath(org.id)} variant="ghost" size="sm" aria-label={`Open ${name}`}>Open</Button>
                {lifecycle === 'pending' && <Button variant="secondary" size="sm" onClick={() => { setReviewTarget(org); setReviewOpen(true); }} aria-label={`Review ${name}`}>Review</Button>}
                {lifecycle === 'archived' && <Button variant="secondary" size="sm" onClick={() => { setLifecycleError(''); setRestoreTarget(org); }} aria-label={`Restore ${name}`}>Restore</Button>}
                {lifecycle === 'active' && <TableRowActions subject={name} label="Organization actions" actions={[{ label: 'Edit organization', icon: PencilLine, onClick: () => { setLogoFile(null); setForm(org); } }, { label: 'Add existing user', icon: UserPlus, disabled: !org.is_active || !org.college, onClick: () => setMembershipOrganization(org) }, { label: 'Manage user profiles', icon: Users, onClick: () => setProfileOrganization(org) }, { label: 'Archive organization', icon: Archive, onClick: () => { setLifecycleError(''); setArchiveTarget(org); } }]} />}
              </span></div></article></Fragment>;
        })}
      </section>}
      {!loading && !error && !items.length && <EmptyState icon={Building2} kind={search.trim() ? 'filtered' : 'first-run'} title={EMPTY_COPY[status]} description={search.trim() ? 'Try a different search term.' : undefined} />}
      {lastPage > 1 && <nav aria-label="Organization pages" className="flex items-center justify-end gap-3 text-xs font-semibold text-slate-600"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-40">Previous</button><span>Page {page} of {lastPage}</span><button type="button" disabled={loading || page >= lastPage} onClick={() => setPage(page + 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-40">Next</button></nav>}
      {form && !membershipOrganization && !profileOrganization && <AccessibleOverlay label="Edit organization" onClose={() => !busy && setForm(null)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-2xl"><h3 className="text-lg font-black text-slate-900">Edit organization</h3>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="mt-5 grid gap-3">
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Organization name" />Organization name<input required value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Organization code" />Organization code<input required value={form.acronym || ''} onChange={(event) => setForm({ ...form, acronym: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Main organization" />Main organization<select value={form.parent_organization_id || ''} onChange={(event) => setForm({ ...form, parent_organization_id: event.target.value })} className={inputClass}><option value="">This is a main organization</option>{parents.filter((parent) => parent.id !== form.id).map((parent) => <option key={parent.id} value={parent.id}>{formatDisplayText(parent.name)}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Department / college" />Department / college<select required value={form.college_id || ''} onChange={(event) => setForm({ ...form, college_id: event.target.value ? Number(event.target.value) : null })} className={inputClass}><option value="">Select a college</option>{colleges.filter((college) => college.is_active || college.id === form.college_id).map((college) => <option key={college.id} value={college.id}>{formatDisplayText(college.name)}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">Organization color<input type="color" value={form.color || '#0B8ED0'} onChange={(event) => setForm({ ...form, color: event.target.value })} className="mt-1 h-11 w-20 rounded-lg border border-[#DDE7EF] bg-white p-1" /></label>
        <label className="text-sm font-semibold text-slate-700">Organization logo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border border-[#DDE7EF] bg-white p-2 text-sm" />{logoFile && <span className="mt-1 block text-xs text-slate-500">{logoFile.name}</span>}</label>
        <div className="text-sm font-semibold text-slate-700"><label htmlFor="organization-description"><FieldIcon label="Description" />Description</label><RichTextEditor id="organization-description" value={form.description || ''} onChange={(description) => setForm({ ...form, description })} rows={4} /></div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> <FieldIcon label="Active organization" />Active organization</label>
      </div><div className="mt-5 border-t border-[#DDE7EF] pt-4"><h4 className="text-sm font-bold text-[#0F2F62]">Organization members</h4><p className="mt-1 text-xs text-[#64748B]">Add an existing user from this organization's college with a separate profile. Save changes to the college before adding members.</p><button type="button" disabled={busy || !form.is_active || !form.college_id || form.college_id !== editingBase?.college_id} onClick={() => setMembershipOrganization(editingBase)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0878B7] disabled:opacity-50"><UserPlus size={16} aria-hidden="true" /> Add existing user</button><button type="button" disabled={busy} onClick={() => setProfileOrganization(editingBase)} className="ml-2 mt-3 min-h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0878B7]">Manage user profiles</button></div><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setForm(null)} className="min-h-11 rounded-lg px-4 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button><button disabled={busy} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white">{busy ? 'Saving…' : 'Save organization'}</button></div></form></AccessibleOverlay>}
      {reviewTarget && <ReviewDrawer key={reviewTarget.id} organization={reviewTarget} open={reviewOpen} onClose={closeReview} onReviewed={finishReview} onStale={staleReview} />}
      {archiveTarget && <ArchiveModal organization={archiveTarget} busy={lifecycleBusy} error={lifecycleError} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => runLifecycle(() => archiveSystemOrganization(archiveTarget.id, reason ? { reason } : {}), archiveTarget, `${formatDisplayText(archiveTarget.name)} archived.`)} />}
      <ConfirmModal open={Boolean(restoreTarget)} title="Restore organization" message={restoreTarget ? `Restore ${formatDisplayText(restoreTarget.name)} so it can be edited and used again?` : ''} recordName={restoreTarget ? `Restore ${formatDisplayText(restoreTarget.name)}?` : ''} confirmText="Restore organization" variant="primary" busy={lifecycleBusy} onCancel={() => setRestoreTarget(null)} onConfirm={() => runLifecycle(() => restoreSystemOrganization(restoreTarget.id), restoreTarget, `${formatDisplayText(restoreTarget.name)} restored.`)} />
      {profileOrganization && <ManageAccountProfilesModal organization={profileOrganization} onClose={() => setProfileOrganization(null)} onDeleted={(result) => { setNotice(result.message); load(); }} />}
      {membershipOrganization && <AddExistingUserModal actorRole="SUPER_ADMIN" organization={membershipOrganization} onClose={() => setMembershipOrganization(null)} onAdded={() => { setNotice('User added to the organization.'); load(); }} />}
    </div>
  );
}
