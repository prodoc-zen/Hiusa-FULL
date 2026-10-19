import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import FieldIcon from '../../../components/FieldIcon.jsx';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Building2, ClipboardCheck, ExternalLink, FileText, PencilLine, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { deleteSystemOrganization, getSystemAgency, getSystemOrganizationOverview, getSystemOrganizations, archiveSystemOrganization, restoreSystemOrganization, reviewSystemOrganization, updateSystemOrganization, uploadSystemOrganizationLogo } from '../../../services/systemAdministrationService';
import { getComplianceDocuments } from '../../../services/complianceService';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import ConfirmModal from '../../../components/ConfirmModal';
import PermanentDeleteModal from '../../../components/organizations/PermanentDeleteModal';
import Modal from '../../../components/Modal';
import TableRowActions from '../../../components/TableRowActions';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import CreateAdministratorModal from '../../../components/users/CreateAdministratorModal';
import ManageAccountProfilesModal from '../../../components/users/ManageAccountProfilesModal';
import { Button, Drawer, EmptyState, ErrorState, Field, Input, SkeletonCard, StatusBadge, Tabs, Textarea } from '../../../components/ui';
import { manilaDate } from '../../../lib/format';
import { fetchAllPages } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { RegistrationNextStep, RegistrationRowStatus, RegistrationStepper } from '../../../components/organizations/RegistrationFlow';
import { organizationOverviewPath } from './agencyStatus';

const PANEL_ID = 'sao-organizations-panel';
const SEARCH_DEBOUNCE_MS = 250;
const STATUS_TABS = [
  { key: 'pending', label: 'Pending review', panelId: PANEL_ID },
  { key: 'active', label: 'Active', panelId: PANEL_ID },
  { key: 'returned', label: 'Returned', panelId: PANEL_ID },
  { key: 'archived', label: 'Archived', panelId: PANEL_ID },
];
const STATUS_KEYS = STATUS_TABS.map((tab) => tab.key);
const DEFAULT_ORDER = ['pending', 'returned', 'active', 'archived'];
const FALLBACK_STATUS = 'active';
const EMPTY_COPY = {
  pending: 'No organizations are waiting for review.',
  active: 'No active student organizations match this view.',
  returned: 'No organizations are returned to their Department Head.',
  archived: 'No archived organizations.',
};
const EMPTY_HINT = {
  pending: 'Department Heads register the organizations of their college. New registrations appear here for your review.',
  active: 'Approved registrations appear here. Review the pending ones first.',
  returned: 'A returned registration waits for its Department Head to edit and resubmit it.',
  archived: 'Archive an active organization to keep it here as read only.',
};
const provisionPath = (organizationId) => `/dashboard/super-admin/admins?organization=${organizationId}&create=1`;
const needsAdministrator = (organization) => organization.lifecycle_status === 'active' && Number(organization.administrators_count ?? organization.administrators?.length ?? 0) === 0;
const inputClass = 'mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 font-normal outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20';

function LifecycleBadge({ status }) {
  if (status !== 'archived') return <StatusBadge status={status} className="h-fit" />;
  return <span role="img" aria-label="Archived, read only" className="h-fit"><StatusBadge status={status} /></span>;
}

function ReviewDrawer({ organization, open, onClose, onReviewed, onApproved, onStale }) {
  const [approved, setApproved] = useState(false);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [remarks, setRemarks] = useState('');
  const [remarksError, setRemarksError] = useState('');
  const [submitting, setSubmitting] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [openingId, setOpeningId] = useState(null);
  const [fileError, setFileError] = useState('');
  const remarksRef = useRef(null);

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
      remarksRef.current?.focus();
      remarksRef.current?.scrollIntoView?.({ block: 'center' });
      return;
    }
    setRemarksError('');
    setSubmitError('');
    setSubmitting(decision);
    try {
      await reviewSystemOrganization(organization.id, decision === 'return'
        ? { decision, remarks: trimmed, submitted_at: organization.submitted_at }
        : { decision, submitted_at: organization.submitted_at });
      if (decision === 'approve') {
        setApproved(true);
        onApproved(`${formatDisplayText(organization.name)} approved and activated.`);
      } else {
        onReviewed(`${formatDisplayText(organization.name)} returned to its Department Head.`);
      }
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

  const registration = approved
    ? { id: organization.id, name: organization.name, lifecycle_status: 'active', administrators_count: 0 }
    : { id: organization.id, name: organization.name, lifecycle_status: 'pending' };
  const submittedBy = details?.overview?.lifecycle?.submitted_by?.name;
  const documents = details?.documents || [];

  return (
    <Drawer
      open={open}
      title="Review registration"
      description={formatDisplayText(organization.name)}
      onClose={() => !submitting && onClose()}
      width="max-w-lg"
      footer={approved ? <Button variant="secondary" onClick={onClose}>Close</Button> : (
        <>
          {loadError && !loading && <p role="note" className="mr-auto text-xs font-semibold text-danger-strong">Approve is unavailable until the registration details load.</p>}
          <Button variant="secondary" onClick={() => decide('return')} loading={submitting === 'return'} disabled={Boolean(submitting) || loading}>Return</Button>
          <Button onClick={() => decide('approve')} loading={submitting === 'approve'} disabled={Boolean(submitting) || loading || Boolean(loadError)}>Approve</Button>
        </>
      )}
    >
      <div className="mb-5 space-y-3">
        <RegistrationStepper organization={registration} viewerRole="SUPER_ADMIN" />
        {approved && <RegistrationNextStep organization={registration} viewerRole="SUPER_ADMIN" />}
      </div>
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
                <Button variant="secondary" size="sm" leftIcon={ExternalLink} loading={openingId === document.open_url} disabled={!document.open_url} className="max-md:min-h-[42px]" onClick={() => openFile(document)} aria-label={`Open ${document.file_name || document.item}`}>Open</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!approved && <div className="mt-5 border-t border-line pt-4">
        <Field label="Remarks (required to return)" error={remarksError} hint="Shown to the Department Head when you return the registration.">
          <Textarea ref={remarksRef} rows={4} maxLength={3000} value={remarks} onChange={(event) => { setRemarks(event.target.value); setRemarksError(''); }} disabled={Boolean(submitting)} />
        </Field>
        {submitError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{submitError}</p>}
      </div>}
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
  const [parentLoading, setParentLoading] = useState(false);
  const [parentError, setParentError] = useState('');
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const requestToken = useRef(0);
  const handledReview = useRef(null);
  const reviewParam = searchParams.get('review');
  const [form, setForm] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [membershipOrganization, setMembershipOrganization] = useState(null);
  const [adminOrganization, setAdminOrganization] = useState(null);
  const [existingAdminOrganization, setExistingAdminOrganization] = useState(null);
  const [profileOrganization, setProfileOrganization] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCounts = useCallback(async () => {
    try {
      const agency = await getSystemAgency({ summary: 1 });
      const byStatus = agency?.totals?.by_lifecycle_status || {};
      setCounts(byStatus);
      return byStatus;
    } catch {
      setCounts(null);
      return null;
    }
  }, []);
  useEffect(() => {
    loadCounts().then((byStatus) => setDefaultStatus(DEFAULT_ORDER.find((key) => (byStatus?.[key] || 0) > 0) ?? (byStatus ? DEFAULT_ORDER[0] : FALLBACK_STATUS)));
  }, [loadCounts]);

  useEffect(() => {
    if (status && statusParam !== status) {
      setSearchParams((current) => { const next = new URLSearchParams(current); next.set('status', status); return next; }, { replace: true });
    }
  }, [status, statusParam, setSearchParams]);

  const load = useCallback(async (requestedPage = page) => {
    if (!status) return;
    const token = ++requestToken.current;
    setLoading(true);
    try {
      const data = await getSystemOrganizations({ search: debouncedSearch, lifecycle_status: status, per_page: 12, page: requestedPage });
      if (token !== requestToken.current) return;
      setItems([...(data.data || [])].sort((left, right) =>
        (left.college || '').localeCompare(right.college || '')
        || Number(needsAdministrator(right)) - Number(needsAdministrator(left))
        || Number(Boolean(left.parent_organization_id)) - Number(Boolean(right.parent_organization_id))
        || left.name.localeCompare(right.name)));
      setPage(data.current_page || requestedPage);
      setLastPage(data.last_page || 1);
      setError('');
    } catch (cause) {
      if (token !== requestToken.current) return;
      setError(getApiErrorMessage(cause, 'Unable to load organizations.'));
    } finally {
      if (token === requestToken.current) setLoading(false);
    }
  }, [page, debouncedSearch, status]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (search === debouncedSearch) return undefined;
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, debouncedSearch]);

  useEffect(() => {
    if (!reviewParam) {
      handledReview.current = null;
      return;
    }
    if (!status || loading || handledReview.current === reviewParam) return;
    handledReview.current = reviewParam;
    setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('review'); return next; }, { replace: true });
    const match = items.find((item) => String(item.id) === reviewParam);
    if (match) {
      setReviewTarget(match);
      setReviewOpen(true);
      return;
    }
    getSystemOrganizationOverview(reviewParam).then((overview) => {
      const { organization, lifecycle } = overview;
      if (lifecycle?.status === 'pending') {
        setReviewTarget({ id: organization.id, name: organization.name, acronym: organization.acronym, college: organization.college, description: organization.description, submitted_at: lifecycle.submitted_at });
        setReviewOpen(true);
      } else {
        setActionError(`${formatDisplayText(organization.name)} is no longer waiting for review.`);
      }
    }).catch((cause) => setActionError(getApiErrorMessage(cause, 'Could not open that registration for review.')));
  }, [reviewParam, status, loading, items, setSearchParams]);
  const loadParents = useCallback(async () => {
    setParentLoading(true);
    setParentError('');
    try {
      setParentItems(await fetchAllPages((params) => getSystemOrganizations({ ...params, lifecycle_status: 'active' })));
    } catch (cause) {
      setParentError(getApiErrorMessage(cause, 'Unable to load parent organizations.'));
    } finally {
      setParentLoading(false);
    }
  }, []);
  const formOpen = Boolean(form);
  useEffect(() => { if (formOpen) loadParents(); }, [formOpen, loadParents]);

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
        parent_organization_id: form.parent_organization_id || null,
        description: form.description,
        color: form.color,
      };
      saved = await updateSystemOrganization(form.id, payload);
      if (logoFile) await uploadSystemOrganizationLogo(saved.id, logoFile);
      setForm(null);
      setLogoFile(null);
      setNotice('Organization updated.');
      await load();
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

  function approvedReview(message) {
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
      setDeleteTarget(null);
      reloadAll();
    } catch (cause) {
      if (deleteTarget) {
        setLifecycleError(getApiErrorMessage(cause, 'Could not delete the organization.'));
      } else if (cause?.response?.status === 409) {
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
      <div {...(status ? { role: 'tabpanel', id: PANEL_ID, 'aria-label': STATUS_TABS.find((tab) => tab.key === status).label } : {})} className="space-y-6">
      <Field label="Search organizations" className="max-w-md"><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, code, or college" /></Field>
      {status === 'archived' && <p role="note" className="rounded-lg border border-line bg-subtle p-3 text-sm font-semibold text-ink">Archived organizations are read-only. Restore to make changes.</p>}
      {error && !form && <ErrorState description={error} onRetry={() => load()} />}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading && !error && <section aria-label="Loading organizations" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"><SkeletonCard /><SkeletonCard /></section>}
      {!loading && !error && items.length > 0 && <div className="max-w-full overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Student organizations, registration progress, membership, and actions</caption>
          <thead className="border-b border-line bg-subtle text-xs text-ink-muted"><tr>
            <th scope="col" className="px-4 py-3">Organization / college</th><th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="px-4 py-3">Registration progress</th><th scope="col" className="px-4 py-3">Membership</th><th scope="col" className="px-4 py-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-line">{items.map((org) => {
            const lifecycle = org.lifecycle_status || status;
            const name = formatDisplayText(org.name);
            return <tr key={org.id} className={lifecycle === 'archived' ? 'bg-subtle' : ''}>
              <th scope="row" className="max-w-80 px-4 py-4 align-top font-normal">
                <div className="flex items-start gap-3">
                  {org.logo_url && <img src={resolveAssetUrl(org.logo_url)} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />}
                  <div className="min-w-0"><h3 className="break-words font-bold text-ink">{name}</h3><p className="mt-1 text-xs text-ink-muted">{org.acronym} · {org.college || 'No college assigned'}</p>
                    {org.parent_organization && <p className="mt-1 text-xs text-ink-muted">Sub organization of {formatDisplayText(org.parent_organization.name)}</p>}
                  </div>
                </div>
              </th>
              <td className="px-4 py-4 align-top"><LifecycleBadge status={lifecycle} />{org.college_is_active === false && <p className="mt-2 text-xs text-danger-strong">College archived · sign-in disabled</p>}</td>
              <td className="max-w-80 px-4 py-4 align-top"><RegistrationRowStatus organization={{ ...org, lifecycle_status: lifecycle }} viewerRole="SUPER_ADMIN" />
                {lifecycle === 'pending' && org.submitted_at && <p className="mt-2 text-xs text-ink-muted">Submitted {manilaDate(org.submitted_at)}</p>}
                {lifecycle === 'returned' && <p className="mt-2 text-xs text-danger-strong">Returned with remarks: {org.review_remarks || 'No remarks were recorded.'}</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-4 align-top text-xs text-ink-muted">{org.users_count} members · {org.administrators_count ?? org.administrators?.length ?? 0} admins</td>
              <td className="px-4 py-3 align-top"><TableRowActions subject={name} label="Organization actions" actions={[
                { label: 'Open organization', icon: Building2, to: organizationOverviewPath(org.id) },
                lifecycle === 'pending' && { label: 'Review registration', icon: ClipboardCheck, disabled: org.college_is_active === false, onClick: () => { setReviewTarget(org); setReviewOpen(true); } },
                needsAdministrator({ ...org, lifecycle_status: lifecycle }) && { label: 'Provision administrator', icon: UserPlus, disabled: org.college_is_active === false, to: provisionPath(org.id) },
                lifecycle === 'archived' && { label: 'Restore organization', icon: RotateCcw, disabled: org.college_is_active === false, onClick: () => { setLifecycleError(''); setRestoreTarget(org); } },
                lifecycle === 'active' && { label: 'Edit organization', icon: PencilLine, disabled: org.college_is_active === false, onClick: () => { setLogoFile(null); setForm(org); } },
                lifecycle === 'active' && { label: 'Add existing user', icon: UserPlus, disabled: !org.is_active || !org.college || org.college_is_active === false, onClick: () => setMembershipOrganization(org) },
                lifecycle === 'active' && { label: 'Add administrator', icon: UserPlus, disabled: !org.is_active || org.college_is_active === false, onClick: () => setAdminOrganization(org) },
                lifecycle === 'active' && { label: 'Manage user profiles', icon: Users, disabled: org.college_is_active === false, onClick: () => setProfileOrganization(org) },
                lifecycle === 'active' && { label: 'Archive organization', icon: Archive, disabled: org.college_is_active === false, danger: true, onClick: () => { setLifecycleError(''); setArchiveTarget(org); } },
                { label: 'Delete organization', icon: Trash2, danger: true, onClick: () => { setLifecycleError(''); setDeleteTarget(org); } },
              ]} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      {!loading && !error && !items.length && <EmptyState icon={Building2} kind={debouncedSearch.trim() ? 'filtered' : 'first-run'} title={EMPTY_COPY[status]} description={debouncedSearch.trim() ? 'Try a different search term.' : EMPTY_HINT[status]} />}
      {lastPage > 1 && <nav aria-label="Organization pages" className="flex items-center justify-end gap-3 text-xs font-semibold text-slate-600"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-40">Previous</button><span>Page {page} of {lastPage}</span><button type="button" disabled={loading || page >= lastPage} onClick={() => setPage(page + 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-40">Next</button></nav>}
      </div>
      {form &&!membershipOrganization && !profileOrganization && <AccessibleOverlay label="Edit organization" onClose={() => !busy && setForm(null)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><form onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-2xl"><h3 className="text-lg font-black text-slate-900">Edit organization</h3>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="mt-5 grid gap-3">
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Organization name" />Organization name<input required value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Organization code" />Organization code<input required value={form.acronym || ''} onChange={(event) => setForm({ ...form, acronym: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-semibold text-slate-700"><FieldIcon label="Main organization" />Main organization<HiusaSelect disabled={parentLoading || Boolean(parentError)} value={form.parent_organization_id || ''} onChange={(event) => setForm({ ...form, parent_organization_id: event.target.value })} className={inputClass}><option value="">This is a main organization</option>{parents.filter((parent) => parent.id !== form.id).map((parent) => <option key={parent.id} value={parent.id}>{formatDisplayText(parent.name)}</option>)}</HiusaSelect></label>
        {parentLoading && <p role="status" className="text-xs text-ink-muted">Loading parent organizations...</p>}
        {parentError && <p role="alert" className="text-sm text-danger-strong">{parentError} <button type="button" onClick={loadParents} className="min-h-11 font-bold underline">Retry parent organizations</button></p>}
        <div className="text-sm font-semibold text-slate-700">College<p className="mt-1 flex h-11 items-center rounded-lg border border-[#DDE7EF] bg-subtle px-3 font-normal text-ink">{formatDisplayText(form.college) || 'Not assigned'}</p></div>
        <label className="text-sm font-semibold text-slate-700">Organization color<input type="color" value={form.color || '#0B8ED0'} onChange={(event) => setForm({ ...form, color: event.target.value })} className="mt-1 h-11 w-20 rounded-lg border border-[#DDE7EF] bg-white p-1" /></label>
        <label className="text-sm font-semibold text-slate-700">Organization logo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border border-[#DDE7EF] bg-white p-2 text-sm" />{logoFile && <span className="mt-1 block text-xs text-slate-500">{logoFile.name}</span>}</label>
        <div className="text-sm font-semibold text-slate-700"><label htmlFor="organization-description"><FieldIcon label="Description" />Description</label><RichTextEditor id="organization-description" value={form.description || ''} onChange={(description) => setForm({ ...form, description })} rows={4} /></div>      </div><div className="mt-5 border-t border-[#DDE7EF] pt-4"><h4 className="text-sm font-bold text-[#0F2F62]">Organization members</h4><p className="mt-1 text-xs text-[#64748B]">Add an existing user from this organization's college with a separate profile.</p><button type="button" disabled={busy || !editingBase?.is_active || !editingBase?.college_id} onClick={() => setMembershipOrganization(editingBase)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0878B7] disabled:opacity-50"><UserPlus size={16} aria-hidden="true" /> Add existing user</button><button type="button" disabled={busy} onClick={() => setProfileOrganization(editingBase)} className="ml-2 mt-3 min-h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0878B7]">Manage user profiles</button></div><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setForm(null)} className="min-h-11 rounded-lg px-4 text-sm font-bold text-slate-600 disabled:opacity-50">Cancel</button><button disabled={busy} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white">{busy ? 'Saving…' : 'Save organization'}</button></div></form></AccessibleOverlay>}
      {reviewTarget && <ReviewDrawer key={reviewTarget.id} organization={reviewTarget} open={reviewOpen} onClose={closeReview} onReviewed={finishReview} onApproved={approvedReview} onStale={staleReview} />}
      {deleteTarget && <PermanentDeleteModal key={deleteTarget.id} name={deleteTarget.name} kind="organization" busy={lifecycleBusy} error={lifecycleError} onClose={() => setDeleteTarget(null)} onConfirm={(name) => runLifecycle(() => deleteSystemOrganization(deleteTarget.id, name), deleteTarget, 'Organization, memberships, records, and files permanently deleted.')} />}
      {archiveTarget && <ArchiveModal organization={archiveTarget} busy={lifecycleBusy} error={lifecycleError} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => runLifecycle(() => archiveSystemOrganization(archiveTarget.id, reason ? { reason } : {}), archiveTarget, `${formatDisplayText(archiveTarget.name)} archived.`)} />}
      <ConfirmModal open={Boolean(restoreTarget)} title="Restore organization" message={restoreTarget ? `Restore ${formatDisplayText(restoreTarget.name)} so it can be edited and used again?` : ''} recordName={restoreTarget ? `Restore ${formatDisplayText(restoreTarget.name)}?` : ''} confirmText="Restore organization" variant="primary" busy={lifecycleBusy} onCancel={() => setRestoreTarget(null)} onConfirm={() => runLifecycle(() => restoreSystemOrganization(restoreTarget.id), restoreTarget, `${formatDisplayText(restoreTarget.name)} restored.`)} />
      {profileOrganization && <ManageAccountProfilesModal organization={profileOrganization} onClose={() => setProfileOrganization(null)} onDeleted={(result) => { setNotice(result.message); load(); }} />}
      {membershipOrganization && <AddExistingUserModal actorRole="SUPER_ADMIN" organization={membershipOrganization} onClose={() => setMembershipOrganization(null)} onAdded={() => { setNotice('User added to the organization.'); load(); }} />}
      {adminOrganization && <CreateAdministratorModal organization={adminOrganization} onClose={() => setAdminOrganization(null)} onCreated={() => { setNotice('Administrator account created.'); load(); }} onUseExisting={() => { setExistingAdminOrganization(adminOrganization); setAdminOrganization(null); }} />}
      {existingAdminOrganization && <AddExistingUserModal actorRole="SUPER_ADMIN" organization={existingAdminOrganization} initialRole="ADMIN" onClose={() => setExistingAdminOrganization(null)} onAdded={() => { setNotice('Admin profile added to the organization.'); load(); }} />}
    </div>
  );
}
