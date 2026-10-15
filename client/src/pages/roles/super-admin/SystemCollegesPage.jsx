import { formatDisplayText } from '../../../utils/displayText.js';
import { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Building2, ImagePlus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonCard, StatusBadge, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import TableRowActions from '../../../components/TableRowActions';
import PermanentDeleteModal from '../../../components/organizations/PermanentDeleteModal';
import { archiveSystemCollege, restoreSystemCollege, permanentlyDeleteCollege, createSystemCollege, deleteSystemCollege, getSystemColleges, uploadSystemCollegeLogo } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { AssignDepartmentHeadModal, ManageDepartmentHeadModal, summarizeHead } from './DepartmentHeadDialogs';

function CollegeCard({ college, uploading, onUpload, onAssign, onManage, onDelete, onArchive, onPurge }) {
  const fileInput = useRef(null);
  const name = formatDisplayText(college.name);
  const head = college.department_head;
  const headIsActive = head?.account_status === 'active';

  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#EEF6FB] text-[#0F2F62]">
          {college.logo_url ? <img src={resolveAssetUrl(college.logo_url)} alt="" className="h-full w-full object-cover" /> : <Building2 size={19} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-bold text-ink">{name}</h2>
          <p className="mt-1 text-xs font-medium text-ink-muted">{college.code || 'No code'} · {college.organizations_count} {college.organizations_count === 1 ? 'organization' : 'organizations'} · {college.is_active ? 'Active' : 'Archived'}</p>
          {college.description && <RichTextBody value={college.description} className="mt-2 break-words text-xs text-ink-muted" />}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Logo file for ${name}`} className="sr-only" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(college, file); }} />
        <TableRowActions subject={name} actions={[
          { label: `View organizations of ${name}`, icon: Building2, to: `/dashboard/super-admin/organizations?status=active&search=${encodeURIComponent(college.name)}` },
          college.is_active && head && { label: `Manage Department Head of ${name}`, icon: UserPlus, onClick: () => onManage(college) },
          college.is_active && !headIsActive && { label: `Assign Department Head to ${name}`, icon: UserPlus, onClick: () => onAssign(college) },
          { label: uploading ? 'Uploading logo…' : 'Upload logo', icon: ImagePlus, disabled: uploading, onClick: () => fileInput.current?.click() },
          { label: college.is_active ? 'Archive college' : 'Restore college', icon: college.is_active ? Archive : RotateCcw, onClick: () => onArchive(college) },
          { label: 'Delete college and transfer users', icon: Trash2, danger: true, onClick: () => onDelete(college) },
          { label: 'Delete with all data', icon: Trash2, danger: true, onClick: () => onPurge(college) },
        ]} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-muted">Department Head</p>
          {head ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="break-words text-sm font-bold text-ink">{formatDisplayText(head.name)}</span>
                <StatusBadge status={head.account_status} />
              </div>
              <p className="mt-0.5 break-all text-xs font-medium text-ink-muted">{head.email}</p>
            </>
          ) : <p className="mt-1 text-sm font-medium text-ink-muted">No Department Head yet</p>}
        </div>
      </div>
    </article>
  );
}

export default function SystemCollegesPage() {
  const [colleges, setColleges] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingId, setUploadingId] = useState(null);
  const [notice, setNotice] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [managing, setManaging] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', code: '', description: '' });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [addFieldErrors, setAddFieldErrors] = useState({});

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

  async function upload(college, file) {
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
    if (user) setColleges((current) => current.map((item) => (item.id === collegeId ? { ...item, department_head: summarizeHead(user) } : item)));
    setUploadError('');
    setNotice(message);
  }

  async function addCollege(event) {
    event.preventDefault();
    setAddBusy(true);
    setAddError('');
    setAddFieldErrors({});
    try {
      const saved = await createSystemCollege({ name: addForm.name.trim(), code: addForm.code.trim() || null, description: addForm.description.trim() || null });
      setAdding(false);
      setAddForm({ name: '', code: '', description: '' });
      setNotice(`${formatDisplayText(saved.name)} added. You can now assign a Department Head.`);
      await load();
    } catch (cause) {
      const fieldErrors = cause.response?.data?.errors || {};
      setAddError(Object.keys(fieldErrors).length ? 'Please correct the highlighted fields.' : getApiErrorMessage(cause, 'Could not add this college.'));
      setAddFieldErrors(fieldErrors);
    } finally {
      setAddBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await deleteSystemCollege(deleteTarget.id, transferTo);
      setDeleteTarget(null);
      setNotice(transferTo ? 'College deleted. Its organizations and users were moved to the replacement college.' : 'Empty college deleted.');
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
      if (purgeTarget) {
        await permanentlyDeleteCollege(purgeTarget.id, purgeTarget.name);
        setNotice('College, its organizations, memberships, and files permanently deleted.');
      } else {
        await (archiveTarget.is_active ? archiveSystemCollege : restoreSystemCollege)(archiveTarget.id);
        setNotice(archiveTarget.is_active ? 'College archived. Sign-in is disabled; SAO can still view its files.' : 'College restored. Previously active organizations and accounts can sign in again.');
      }
      setPurgeTarget(null);
      setArchiveTarget(null);
      await load();
    } catch (cause) {
      setLifecycleError(getApiErrorMessage(cause, 'Could not update this college.'));
    } finally {
      setLifecycleBusy(false);
    }
  }

  const term = search.trim().toLowerCase();
  const visible = colleges.filter((college) => [college.name, college.code].some((value) => String(value || '').toLowerCase().includes(term)));
  const replacements = colleges.filter((college) => college.id !== deleteTarget?.id && college.can_receive_transfer);

  return (
    <div className="space-y-5">
      <PageHeader purpose="Add colleges, assign Department Heads, and manage each college's organizations." />
      <Button onClick={() => { setAddError(''); setAddFieldErrors({}); setAdding(true); }}>Add college</Button>
      {error && !loading ? <ErrorState description={error} onRetry={load} /> : (
        <>
          <Field label="Search colleges" className="max-w-md"><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="College name or code" /></Field>
          {uploadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uploadError}</p>}
          {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
          {loading ? (
            <section aria-label="Loading colleges" className="grid gap-3 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></section>
          ) : visible.length ? (
            <section className="grid gap-3 md:grid-cols-2">{visible.map((college) => <CollegeCard key={college.id} college={college} uploading={uploadingId === college.id} onUpload={upload} onAssign={setAssigning} onManage={setManaging} onArchive={(item) => { setLifecycleError(''); setArchiveTarget(item); }} onPurge={(item) => { setLifecycleError(''); setPurgeTarget(item); }} onDelete={(item) => { setDeleteTarget(item); setTransferTo(''); setDeleteError(''); }} />)}</section>
          ) : (
            <EmptyState kind={colleges.length ? 'filtered' : 'first-run'} icon={Building2} title="No colleges found" description={colleges.length ? 'No colleges match your search.' : 'Add the first college to begin assigning Department Heads.'} />
          )}
        </>
      )}
      {purgeTarget && <PermanentDeleteModal key={purgeTarget.id} name={purgeTarget.name} kind="college" busy={lifecycleBusy} error={lifecycleError} onClose={() => setPurgeTarget(null)} onConfirm={changeLifecycle} />}
      <ConfirmModal open={Boolean(archiveTarget)} title={archiveTarget?.is_active ? 'Archive college' : 'Restore college'} message={archiveTarget?.is_active ? `Archive ${archiveTarget.name}? All college and organization profiles will be blocked from signing in. SAO can still view their files. Existing organization statuses are preserved.` : `Restore ${archiveTarget?.name}? Previously active organizations and accounts regain access. Individually archived organizations stay archived.`} confirmText={archiveTarget?.is_active ? 'Archive college' : 'Restore college'} error={lifecycleError} busy={lifecycleBusy} onCancel={() => setArchiveTarget(null)} onConfirm={changeLifecycle} />
      {assigning && <AssignDepartmentHeadModal college={assigning} onClose={() => setAssigning(null)} onAssigned={(user, message) => headChanged(assigning.id, user, message)} />}
      {managing?.department_head && <ManageDepartmentHeadModal college={managing} head={managing.department_head} onClose={() => setManaging(null)} onChanged={(user, message) => headChanged(managing.id, user, message)} />}
      <Modal open={adding} title="Add college" onClose={addBusy ? undefined : () => setAdding(false)} footer={<><Button variant="secondary" disabled={addBusy} onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" form="add-college-form" loading={addBusy}>Add college</Button></>}>
        <form id="add-college-form" onSubmit={addCollege} className="space-y-4">
          <Field label="College name" required error={addFieldErrors.name?.[0]}><Input required maxLength={255} value={addForm.name} onChange={(event) => setAddForm((form) => ({ ...form, name: event.target.value }))} /></Field>
          <Field label="Code" error={addFieldErrors.code?.[0]}><Input maxLength={50} value={addForm.code} onChange={(event) => setAddForm((form) => ({ ...form, code: event.target.value }))} /></Field>
          <Field label="Description" error={addFieldErrors.description?.[0]}><Textarea maxLength={3000} rows={3} value={addForm.description} onChange={(event) => setAddForm((form) => ({ ...form, description: event.target.value }))} /></Field>
          {addError && <p role="alert" className="text-sm text-danger-strong">{addError}</p>}
        </form>
      </Modal>
      <Modal open={Boolean(deleteTarget)} title={`Delete ${deleteTarget?.name || 'college'}`} onClose={deleteBusy ? undefined : () => setDeleteTarget(null)} footer={<><Button variant="secondary" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" loading={deleteBusy} disabled={Boolean(deleteTarget?.has_assignments && !transferTo)} onClick={confirmDelete}>Delete college</Button></>}>
        <p className="text-sm text-ink-muted">{deleteTarget?.has_assignments ? 'This college has organizations or users. Choose an empty active college to receive them before deleting it. Their accounts will stay active, but they will need to sign in again.' : 'This college has no assigned organizations or users and can be deleted.'}</p>
        {deleteTarget?.has_assignments && <Field label="Replacement college" required className="mt-4"><Select required value={transferTo} onChange={(event) => setTransferTo(event.target.value)}><option value="">Select an empty college</option>{replacements.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}</Select></Field>}
        {deleteTarget?.has_assignments && !replacements.length && <p className="mt-3 text-sm text-ink-muted">No empty college is available. Cancel this dialog and add a new college first.</p>}
        {deleteError && <p role="alert" className="mt-3 text-sm text-danger-strong">{deleteError}</p>}
      </Modal>
    </div>
  );
}
