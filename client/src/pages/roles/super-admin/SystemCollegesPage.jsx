import { formatDisplayText } from '../../../utils/displayText.js';
import { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Building2, ChevronDown, Eye, ImagePlus, Pencil, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { Button, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonStat, SkeletonTable, Stat, StatusBadge, Textarea } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import TableRowActions from '../../../components/TableRowActions';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import {
  archiveSystemCollege,
  createSystemCollege,
  deleteSystemCollege,
  restoreSystemCollege,
  updateSystemCollege,
  getSystemAgency,
  getSystemColleges,
  uploadSystemCollegeLogo,
} from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { InviteDepartmentHeadModal, ManageDepartmentHeadModal, summarizeHead } from './DepartmentHeadDialogs';
import {
  Count,
  NO_ORGANIZATIONS,
  OrganizationsTable,
  PENDING_REVIEW_PATH,
  hasAdministratorCount,
  needsAdministrator,
  sortColleges,
} from './AgencyOrganizations';

function mergeColleges(colleges, agency) {
  const overviews = agency?.colleges || [];
  const byId = new Map(overviews.map((overview) => [overview.id, overview]));
  const byName = new Map(overviews.map((overview) => [overview.name, overview]));
  return colleges.map((college) => {
    const overview = byId.get(college.id) ?? byName.get(college.name);
    return {
      ...college,
      organizations: overview?.organizations || [],
      by_lifecycle_status: overview?.by_lifecycle_status || {},
      administrators_count: overview?.administrators_count,
      organizations_count: overview?.organizations_count ?? college.organizations_count ?? 0,
    };
  });
}

function OrganizationsSummary({ college, awaitingAdministrator }) {
  const counts = college.by_lifecycle_status || {};
  return (
    <p className="pb-3 pl-7 text-xs font-semibold text-ink-muted">
      <Count value={college.organizations_count} /> {college.organizations_count === 1 ? 'organization' : 'organizations'} · <Count value={counts.pending || 0} /> pending · <Count value={counts.active || 0} /> active · <Count value={counts.returned || 0} /> returned · <Count value={counts.archived || 0} /> archived{hasAdministratorCount(college) && <> · <Count value={college.administrators_count} /> {college.administrators_count === 1 ? 'administrator' : 'administrators'}</>}{awaitingAdministrator > 0 && <> · <Count value={awaitingAdministrator} /> awaiting administrator</>}
    </p>
  );
}

const DEFAULT_COLLEGE_COLOR = '#0B8ED0';
const EMPTY_ADD_FORM = { name: '', code: '', color: '' };

function CollegeCard({ college, showAdmins, agencyUnavailable, uploading, onUpload, onView, onEdit, onInvite, onManage, onArchive, onDelete }) {
  const totalMembers = (college.organizations || []).reduce((sum, org) => sum + Number(org.member_counts?.total || 0), 0);
  const fileInput = useRef(null);
  const name = formatDisplayText(college.name);
  const head = college.department_head;
  const headIsActive = head?.account_status === 'active';
  const counts = college.by_lifecycle_status || {};
  const awaitingAdministrator = (college.organizations || []).filter(needsAdministrator).length;
  const needsReview = (counts.pending || 0) + (counts.returned || 0) + awaitingAdministrator > 0;
  const [expanded, setExpanded] = useState(needsReview);
  const panelId = `college-${college.id}-organizations`;

  useEffect(() => {
    if (needsReview) setExpanded(true);
  }, [needsReview]);

  return (
    <article aria-labelledby={`college-${college.id}`} className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="p-4">
        <div className="flex items-start gap-3">
          {college.logo_url && (
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-control bg-page">
              <img src={resolveAssetUrl(college.logo_url)} alt="" className="h-full w-full object-cover" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={`college-${college.id}`} className="break-words text-base font-semibold text-ink">{name}</h2>
            <p className="mt-1 text-xs font-medium text-ink-muted">{college.code || 'No code'} · {college.organizations_count} {college.organizations_count === 1 ? 'organization' : 'organizations'} · {totalMembers} {totalMembers === 1 ? 'member' : 'members'}{!college.is_active && ' · Archived'}</p>
            {college.description && <RichTextBody value={college.description} className="mt-2 break-words text-xs text-ink-muted" />}
          </div>
          <div className="-mr-2 -mt-1 shrink-0">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Logo file for ${name}`} className="sr-only" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(college, file); }} />
            <TableRowActions subject={name} actions={[
              { label: `View ${name}`, icon: Eye, onClick: () => onView(college) },
              { label: `Edit ${name}`, icon: Pencil, onClick: () => onEdit(college) },
              { label: `View organizations of ${name}`, icon: Building2, to: `/dashboard/super-admin/organizations?status=active&search=${encodeURIComponent(college.name)}` },
              college.is_active && head && { label: `Manage Department Head of ${name}`, icon: UserPlus, onClick: () => onManage(college) },
              college.is_active && !headIsActive && { label: `Invite Department Head to ${name}`, icon: UserPlus, onClick: () => onInvite(college) },
              { label: uploading ? 'Uploading logo…' : 'Upload logo', icon: ImagePlus, disabled: uploading, onClick: () => fileInput.current?.click() },
              { label: college.is_active ? 'Archive college' : 'Restore college', icon: college.is_active ? Archive : RotateCcw, onClick: () => onArchive(college) },
              college.can_delete === false
                ? { label: 'Delete college (has organizations or people)', icon: Trash2, danger: true, disabled: true }
                : { label: 'Delete college', icon: Trash2, danger: true, onClick: () => onDelete(college) },
            ]} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-muted">Department Head</p>
            {head ? (
              <>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="break-words text-sm font-semibold text-ink">{formatDisplayText(head.name)}</span>
                  {!headIsActive && <StatusBadge status={head.account_status} />}
                </div>
                <p className="mt-0.5 break-all text-xs font-medium text-ink-muted">{head.email}</p>
              </>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-sm text-ink-muted">No Department Head yet</p>
                {college.is_active && (
                  <Button size="sm" variant="secondary" className="max-md:min-h-[42px]" onClick={() => onInvite(college)}>
                    Invite Department Head
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <header className="border-t border-line px-4 pt-1">
        {agencyUnavailable ? (
          <p className="py-3 text-sm text-ink-muted">Organization details are unavailable until the agency overview loads.</p>
        ) : college.organizations_count ? (
          <>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-label={`Organizations of ${name}`}
              onClick={() => setExpanded((current) => !current)}
              className="flex min-h-11 items-center gap-2 text-left text-sm font-semibold text-ink"
            >
              <ChevronDown size={18} className={`shrink-0 text-brand-700 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
              Organizations
            </button>
            <OrganizationsSummary college={college} awaitingAdministrator={awaitingAdministrator} />
          </>
        ) : <p className="py-3 text-sm text-ink-muted">{NO_ORGANIZATIONS}</p>}
      </header>
      {!agencyUnavailable && college.organizations_count > 0 && expanded && (
        <div id={panelId} className="border-t border-line">
          <OrganizationsTable rows={college.organizations} caption={`Organizations of ${college.name}`} showAdmins={showAdmins} />
        </div>
      )}
    </article>
  );
}

export default function SystemCollegesPage() {
  const [colleges, setColleges] = useState([]);
  const [agency, setAgency] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agencyError, setAgencyError] = useState('');
  const [uploadingId, setUploadingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [inviting, setInviting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', description: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [managing, setManaging] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');

  const loadEpoch = useRef(0);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      loadEpoch.current += 1;
      setLoading(true);
    }
    const epoch = loadEpoch.current;
    try {
      const [collegesResult, agencyResult] = await Promise.allSettled([getSystemColleges(), getSystemAgency()]);
      if (silent && epoch !== loadEpoch.current) return;
      if (collegesResult.status === 'rejected') {
        if (!silent) setError(getApiErrorMessage(collegesResult.reason, 'Unable to load colleges.'));
        return;
      }
      const freshColleges = collegesResult.value;
      setColleges((current) => (silent && JSON.stringify(current) === JSON.stringify(freshColleges) ? current : freshColleges));
      if (agencyResult.status === 'fulfilled') {
        const freshAgency = agencyResult.value;
        setAgency((current) => (silent && JSON.stringify(current) === JSON.stringify(freshAgency) ? current : freshAgency));
        setAgencyError('');
      } else if (!silent) {
        setAgency(null);
        setAgencyError(getApiErrorMessage(agencyResult.reason, 'Unable to load the agency overview.'));
      }
      setError('');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRefetchOnReturn(() => load({ silent: true }));

  async function upload(college, file) {
    loadEpoch.current += 1;
    setUploadingId(college.id);
    setNotice('');
    setUploadError('');
    try {
      const saved = await uploadSystemCollegeLogo(college.id, file);
      setColleges((current) => current.map((item) => (item.id === college.id ? { ...item, logo_url: saved?.logo_url ?? item.logo_url } : item)));
      setNotice(`Logo updated for ${formatDisplayText(college.name)}.`);
    } catch (cause) {
      setUploadError(getApiErrorMessage(cause, 'Could not upload the logo.'));
    } finally {
      setUploadingId(null);
    }
  }

  function headChanged(collegeId, user, message) {
    loadEpoch.current += 1;
    if (user) setColleges((current) => current.map((item) => (item.id === collegeId ? { ...item, department_head: summarizeHead(user) } : item)));
    setUploadError('');
    setNotice(message);
  }

  async function saveEditCollege(event) {
    event.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setEditError('');
    setEditFieldErrors({});
    try {
      const saved = await updateSystemCollege(editing.id, { name: editForm.name.trim(), code: editForm.code.trim() || null, description: editForm.description.trim() || null });
      setEditing(null);
      setNotice(`${formatDisplayText(saved.name)} updated.`);
      await load();
    } catch (cause) {
      const fieldErrors = cause.response?.data?.errors || {};
      setEditError(Object.keys(fieldErrors).length ? 'Check the highlighted fields.' : getApiErrorMessage(cause, 'Could not update this college.'));
      setEditFieldErrors(fieldErrors);
    } finally {
      setEditBusy(false);
    }
  }

  async function addCollege(event) {
    event.preventDefault();
    setAddBusy(true);
    setAddError('');
    setAddFieldErrors({});
    try {
      const saved = await createSystemCollege({ name: addForm.name.trim(), code: addForm.code.trim() || null, color: addForm.color || null });
      setAdding(false);
      setNotice(`${formatDisplayText(saved.name)} added.`);
      await load();
    } catch (cause) {
      const fieldErrors = cause.response?.data?.errors || {};
      setAddError(Object.keys(fieldErrors).length ? 'Check the highlighted fields.' : getApiErrorMessage(cause, 'Could not add this college.'));
      setAddFieldErrors(fieldErrors);
    } finally {
      setAddBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await deleteSystemCollege(deleteTarget.id);
      setNotice(`${formatDisplayText(deleteTarget.name)} deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (cause) {
      setDeleteError(getApiErrorMessage(cause, 'Could not delete this college.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function changeLifecycle() {
    setLifecycleBusy(true);
    setLifecycleError('');
    try {
      await (archiveTarget.is_active ? archiveSystemCollege : restoreSystemCollege)(archiveTarget.id);
      setNotice(archiveTarget.is_active ? 'College archived. Sign-in is disabled; SAO can still view its files.' : 'College restored. Previously active organizations and accounts can sign in again.');
      setArchiveTarget(null);
      await load();
    } catch (cause) {
      setLifecycleError(getApiErrorMessage(cause, 'Could not update this college.'));
    } finally {
      setLifecycleBusy(false);
    }
  }

  const merged = useMemo(() => mergeColleges(colleges, agency), [colleges, agency]);
  const unassigned = agency?.unassigned_organizations || [];
  const showAdmins = [...merged.flatMap((college) => college.organizations || []), ...unassigned].some(hasAdministratorCount);
  const term = search.trim().toLowerCase();
  const visible = sortColleges(merged.filter((college) => [college.name, college.code].some((value) => String(value || '').toLowerCase().includes(term))));
  const invitable = colleges.filter((college) => college.is_active && college.department_head?.account_status !== 'active');
  const totals = agency?.totals || {};
  const byStatus = totals.by_lifecycle_status || {};
  const agencyUnavailable = Boolean(agencyError);

  return (
    <div className="space-y-5">
      <PageHeader
        primary={<Button leftIcon={Plus} disabled={loading} onClick={() => { setAddForm(EMPTY_ADD_FORM); setAddError(''); setAddFieldErrors({}); setAdding(true); }}>Add college</Button>}
      />
      {error && !loading ? <ErrorState description={error} onRetry={() => load()} /> : (
        <>
          {loading ? (
            <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-busy="true"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
          ) : agencyUnavailable ? (
            <ErrorState title="Agency overview unavailable" description={agencyError} onRetry={() => load()} className="rounded-card border border-line bg-surface" />
          ) : (
            <section aria-label="Agency totals" className="grid grid-cols-3 gap-2 sm:gap-4">
              <Stat className="p-3! sm:p-4!" label="Pending reviews" value={byStatus.pending || 0} to={PENDING_REVIEW_PATH} />
              <Stat className="p-3! sm:p-4!" label="Organizations" value={totals.organizations ?? 0} to="/dashboard/super-admin/organizations?status=active" />
              <Stat className="p-3! sm:p-4!" label="Archived" value={byStatus.archived || 0} to="/dashboard/super-admin/organizations?status=archived" />
            </section>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Search colleges" className="w-full sm:max-w-md sm:flex-1"><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="College name or code" /></Field>
            {term && <button type="button" onClick={() => setSearch('')} className="min-h-11 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
            <Button variant="secondary" leftIcon={UserPlus} disabled={loading || invitable.length === 0} onClick={() => setInviting({ collegeId: '' })}>Invite Department Head</Button>
            {!loading && colleges.length > 0 && invitable.length === 0 && <p className="self-center text-xs text-ink-muted">Every college has a Department Head.</p>}
          </div>
          {uploadError && <p role="alert" className="rounded-card border border-danger-strong/20 bg-danger-tint px-4 py-3 text-sm font-medium text-danger-strong">{uploadError}</p>}
          {notice && <p role="status" className="rounded-card border border-success-strong/20 bg-success-tint px-4 py-3 text-sm font-medium text-success-strong">{notice}</p>}
          {loading ? (
            <section aria-label="Loading colleges"><SkeletonTable columns={4} rows={4} /></section>
          ) : visible.length ? (
            <section className="space-y-3">{visible.map((college) => <CollegeCard key={college.id} college={college} showAdmins={showAdmins} agencyUnavailable={agencyUnavailable} uploading={uploadingId === college.id} onUpload={upload} onView={setViewing} onEdit={(item) => { setEditing(item); setEditForm({ name: item.name || '', code: item.code || '', description: item.description || '' }); setEditError(''); setEditFieldErrors({}); }} onInvite={(item) => setInviting({ collegeId: item.id })} onManage={setManaging} onArchive={(item) => { setLifecycleError(''); setArchiveTarget(item); }} onDelete={(item) => { setDeleteError(''); setDeleteTarget(item); }} />)}</section>
          ) : (
            colleges.length
              ? <EmptyState kind="filtered" title="No colleges match" description="No college has that name or code." onClearFilters={() => setSearch('')} />
              : <EmptyState kind="first-run" title="No colleges yet" description="Add a college, then invite its Department Head." />
          )}
          {!loading && unassigned.length > 0 && (
            <section aria-labelledby="unassigned-organizations" className="overflow-hidden rounded-card border border-line bg-surface">
              <header className="border-b border-line px-4 py-3">
                <h2 id="unassigned-organizations" className="text-base font-semibold text-ink">Organizations without a college</h2>
                <p className="mt-1 text-xs font-medium text-ink-muted">These organizations are not assigned to a college yet.</p>
              </header>
              <OrganizationsTable rows={unassigned} caption="Organizations without a college" showAdmins={showAdmins} />
            </section>
          )}
        </>
      )}
      <ConfirmModal open={Boolean(archiveTarget)} title={archiveTarget?.is_active ? 'Archive college' : 'Restore college'} message={archiveTarget?.is_active ? `Archive ${archiveTarget.name}? All college and organization profiles will be blocked from signing in. SAO can still view their files. Existing organization statuses are preserved.` : `Restore ${archiveTarget?.name}? Previously active organizations and accounts regain access. Individually archived organizations stay archived.`} confirmText={archiveTarget?.is_active ? 'Archive college' : 'Restore college'} error={lifecycleError} busy={lifecycleBusy} onCancel={() => setArchiveTarget(null)} onConfirm={changeLifecycle} />
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete college" message={`Delete ${deleteTarget?.name}? This cannot be undone. If it has organizations or people, archive it instead.`} confirmText="Delete college" error={deleteError} busy={deleteBusy} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
      {inviting && <InviteDepartmentHeadModal colleges={invitable} initialCollegeId={inviting.collegeId} onClose={() => setInviting(null)} onCreated={(message) => { setUploadError(''); setNotice(message); }} />}
      <Drawer open={Boolean(viewing)} title={viewing ? formatDisplayText(viewing.name) : 'College details'} width="max-w-3xl" onClose={() => setViewing(null)} footer={<Button variant="secondary" onClick={() => setViewing(null)}>Close</Button>}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid gap-3 border-y border-line py-3 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold text-ink-muted">Code</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">{viewing.code || 'No code'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-muted">Total members</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">{(viewing.organizations || []).reduce((sum, org) => sum + Number(org.member_counts?.total || 0), 0)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-muted">Organizations</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">{viewing.organizations_count || 0}</p>
              </div>
            </div>
            {(viewing.organizations || []).length > 0 ? (
              <div className="overflow-hidden rounded-card border border-line">
                <OrganizationsTable rows={viewing.organizations} caption={`Organizations in ${viewing.name}`} showAdmins={showAdmins} />
              </div>
            ) : (
              <p className="text-sm text-ink-muted">{NO_ORGANIZATIONS}</p>
            )}
          </div>
        )}
      </Drawer>
      <Drawer open={adding} title="Add college" onClose={addBusy ? undefined : () => setAdding(false)} footer={<><Button variant="secondary" disabled={addBusy} onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" form="add-college-form" loading={addBusy}>Add college</Button></>}>
        <form id="add-college-form" onSubmit={addCollege} className="space-y-4">
          <Field label="College name" required error={addFieldErrors.name?.[0]}><Input required maxLength={255} value={addForm.name} onChange={(event) => setAddForm((form) => ({ ...form, name: event.target.value }))} /></Field>
          <Field label="Code" optional error={addFieldErrors.code?.[0]}><Input maxLength={50} value={addForm.code} onChange={(event) => setAddForm((form) => ({ ...form, code: event.target.value }))} /></Field>
          <Field label="Color" optional error={addFieldErrors.color?.[0]}><input type="color" value={addForm.color || DEFAULT_COLLEGE_COLOR} onChange={(event) => setAddForm((form) => ({ ...form, color: event.target.value.toUpperCase() }))} className="h-10 w-20 cursor-pointer rounded-control border border-line bg-surface p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600" /></Field>
          {addError && <p role="alert" className="text-sm text-danger-strong">{addError}</p>}
        </form>
      </Drawer>
      <Drawer open={Boolean(editing)} title="Edit college" onClose={editBusy ? undefined : () => setEditing(null)} footer={<><Button variant="secondary" disabled={editBusy} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="edit-college-form" loading={editBusy}>Save changes</Button></>}>
        <form id="edit-college-form" onSubmit={saveEditCollege} className="space-y-4">
          <Field label="College name" required error={editFieldErrors.name?.[0]}><Input required maxLength={255} value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} /></Field>
          <Field label="Code" optional error={editFieldErrors.code?.[0]}><Input maxLength={50} value={editForm.code} onChange={(event) => setEditForm((form) => ({ ...form, code: event.target.value }))} /></Field>
          <Field label="Description" optional error={editFieldErrors.description?.[0]}><Textarea maxLength={3000} rows={3} value={editForm.description} onChange={(event) => setEditForm((form) => ({ ...form, description: event.target.value }))} /></Field>
          {editError && <p role="alert" className="text-sm text-danger-strong">{editError}</p>}
        </form>
      </Drawer>
      {managing?.department_head && <ManageDepartmentHeadModal college={managing} head={managing.department_head} onClose={() => setManaging(null)} onChanged={(user, message) => headChanged(managing.id, user, message)} />}
    </div>
  );
}
