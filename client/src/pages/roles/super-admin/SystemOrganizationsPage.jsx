import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Building2, ClipboardCheck, ExternalLink, PencilLine, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import { deleteSystemOrganization, getSystemAgency, getSystemOrganizationOverview, getSystemOrganizations, archiveSystemOrganization, restoreSystemOrganization, reviewSystemOrganization, updateSystemOrganization, uploadSystemOrganizationLogo } from '../../../services/systemAdministrationService';
import { getComplianceDocuments } from '../../../services/complianceService';
import ConfirmModal from '../../../components/ConfirmModal';
import PermanentDeleteModal from '../../../components/organizations/PermanentDeleteModal';
import Modal from '../../../components/Modal';
import TableRowActions from '../../../components/TableRowActions';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import CreateUnifiedOrganizationModal from '../../../components/organizations/CreateUnifiedOrganizationModal';
import ManageAccountProfilesModal from '../../../components/users/ManageAccountProfilesModal';
import { Button, DataTable, Drawer, EmptyState, ErrorState, Field, Input, Select, StatusBadge, Tabs, Textarea } from '../../../components/ui';
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
  { key: 'active', label: 'Active', panelId: PANEL_ID },
  { key: 'pending', label: 'Pending review', panelId: PANEL_ID },
  { key: 'returned', label: 'Returned', panelId: PANEL_ID },
  { key: 'archived', label: 'Archived', panelId: PANEL_ID },
];
const STATUS_KEYS = STATUS_TABS.map((tab) => tab.key);
const DEFAULT_ORDER = ['active', 'pending', 'returned', 'archived'];
const FALLBACK_STATUS = 'active';
const EMPTY_COPY = {
  pending: 'No organizations are waiting for review.',
  active: 'No active organizations yet.',
  returned: 'No organizations are returned to their Department Head.',
  archived: 'No archived organizations.',
};
const EMPTY_HINT = {
  pending: 'Department Heads register the organizations of their college. New registrations appear here for your review.',
  active: 'Approved registrations appear here. Review the pending ones first.',
  returned: 'A returned registration waits for its Department Head to edit and resubmit it.',
  archived: 'Archive an active organization to keep it here as read only.',
};
const needsAdministrator = (organization) => organization.lifecycle_status === 'active' && Number(organization.administrators_count ?? organization.administrators?.length ?? 0) === 0;

function LifecycleBadge({ status }) {
  if (status === 'active') return null;
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
  const [fileRemarks, setFileRemarks] = useState({});
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
      const fileNotes = Object.entries(fileRemarks)
        .filter(([, note]) => note && note.trim())
        .map(([subId, note]) => {
          const doc = documents.find((d) => String(d.id || d.submission_id) === String(subId));
          return doc ? `• ${doc.item}: ${note.trim()}` : `• Document ${subId}: ${note.trim()}`;
        });
      const compiledRemarks = [trimmed, ...fileNotes].filter(Boolean).join('\n\n');
      const hasFileRemarks = Object.values(fileRemarks).some((v) => v && v.trim());
      await reviewSystemOrganization(organization.id, decision === 'return'
        ? {
            decision,
            remarks: compiledRemarks,
            ...(hasFileRemarks ? { file_remarks: fileRemarks } : {}),
            submitted_at: organization.submitted_at,
          }
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

  const hasAdminPayload = Boolean(details?.overview?.organization?.admin_payload);
  const registration = approved
    ? { id: organization.id, name: organization.name, lifecycle_status: 'active', administrators_count: hasAdminPayload ? 1 : 0 }
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
        <div><dt className="text-xs font-semibold text-ink-muted">Organization</dt><dd className="font-semibold text-ink">{formatDisplayText(organization.name)} {organization.acronym && `(${organization.acronym})`}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">College</dt><dd className="font-medium text-ink">{organization.is_university_wide ? 'All colleges' : organization.college || 'Not assigned'}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Description</dt><dd><RichTextBody value={organization.description || 'No description provided.'} className="text-sm text-ink" /></dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Submitted</dt><dd className="font-medium text-ink">{organization.submitted_at ? manilaDate(organization.submitted_at) : 'Not available'}</dd></div>
        <div><dt className="text-xs font-semibold text-ink-muted">Submitted by</dt><dd className="font-medium text-ink">{loading ? 'Loading...' : submittedBy || 'Not available'}</dd></div>
        {details?.overview?.organization?.admin_payload && (
          <div className="border-t border-line pt-3">
            <dt className="text-xs font-semibold text-ink-muted">Founding administrator, added when you approve</dt>
            <dd className="font-semibold text-ink">
              {details.overview.organization.admin_payload.first_name} {details.overview.organization.admin_payload.last_name}
            </dd>
            <dd className="text-xs text-ink-muted">
              ID {details.overview.organization.admin_payload.school_id} · {details.overview.organization.admin_payload.position_title || 'President'} · {details.overview.organization.admin_payload.email}
            </dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="registration-documents" className="mt-5 border-t border-line pt-4">
        <h3 id="registration-documents" className="text-sm font-semibold text-ink">Registration documents</h3>
        {loading && <p role="status" className="mt-2 text-sm text-ink-muted">Loading registration details...</p>}
        {!loading && loadError && <ErrorState className="py-6" description={loadError} onRetry={loadDetails} />}
        {!loading && !loadError && !documents.length && <p className="mt-2 text-sm font-medium text-ink-muted">No registration documents were submitted.</p>}
        {fileError && <p role="alert" className="mt-2 rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{fileError}</p>}
        {!loading && !loadError && documents.length > 0 && (
          <ul className="mt-2 divide-y divide-line-soft">
            {documents.map((document) => (
              <li key={`${document.source}-${document.open_url}`} className="space-y-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-ink">{document.item}</p>
                    <p className="mt-0.5 break-words text-xs font-medium text-ink-muted">{document.file_name || 'No file name'}{document.submitted_at ? ` · ${manilaDate(document.submitted_at)}` : ''}</p>
                  </div>
                  <Button variant="secondary" size="sm" leftIcon={ExternalLink} loading={openingId === document.open_url} disabled={!document.open_url} className="max-md:min-h-[42px]" onClick={() => openFile(document)} aria-label={`Open ${document.file_name || document.item}`}>Open</Button>
                </div>
                {!approved && (
                  <Input
                    type="text"
                    aria-label={`Correction note for ${document.item}`}
                    placeholder="Correction note for this file (optional)"
                    value={fileRemarks[document.id || document.submission_id] || ''}
                    onChange={(e) => setFileRemarks({ ...fileRemarks, [document.id || document.submission_id]: e.target.value })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!approved && <div className="mt-5 border-t border-line pt-4">
        <Field label="Remarks (required to return)" error={remarksError} hint="Shown to the Department Head when you return the registration.">
          <Textarea ref={remarksRef} rows={4} maxLength={3000} value={remarks} onChange={(event) => { setRemarks(event.target.value); setRemarksError(''); }} disabled={Boolean(submitting)} />
        </Field>
        {submitError && <p role="alert" className="mt-3 rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{submitError}</p>}
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
      {error && <p role="alert" className="mt-3 rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{error}</p>}
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
  // Bumped by every full load, so a silent counts poll that started before it cannot land on top of newer data.
  const countsEpoch = useRef(0);
  const handledReview = useRef(null);
  const reviewParam = searchParams.get('review');
  const [form, setForm] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [membershipOrganization, setMembershipOrganization] = useState(null);
  const [creatingUnified, setCreatingUnified] = useState(false);
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

  const loadCounts = useCallback(async ({ silent = false } = {}) => {
    const epoch = countsEpoch.current;
    try {
      const agency = await getSystemAgency({ summary: 1 });
      const byStatus = agency?.totals?.by_lifecycle_status || {};
      if (silent && epoch !== countsEpoch.current) return byStatus;
      setCounts((current) => (JSON.stringify(current) === JSON.stringify(byStatus) ? current : byStatus));
      return byStatus;
    } catch {
      if (!silent) setCounts(null);
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

  const load = useCallback(async (requestedPage = page, { silent = false } = {}) => {
    if (!status) return;
    const token = silent ? requestToken.current : ++requestToken.current;
    if (!silent) {
      countsEpoch.current += 1;
      setLoading(true);
    }
    try {
      const data = await getSystemOrganizations({ search: debouncedSearch, lifecycle_status: status, per_page: 20, page: requestedPage });
      if (token !== requestToken.current) return;
      const sorted = [...(data.data || [])].sort((left, right) =>
        (left.college || '').localeCompare(right.college || '')
        || Number(needsAdministrator(right)) - Number(needsAdministrator(left))
        || Number(Boolean(left.parent_organization_id)) - Number(Boolean(right.parent_organization_id))
        || left.name.localeCompare(right.name));
      setItems((current) => (silent && JSON.stringify(current) === JSON.stringify(sorted) ? current : sorted));
      if (silent) {
        setLastPage(data.last_page || 1);
        return;
      }
      setPage(data.current_page || requestedPage);
      setLastPage(data.last_page || 1);
      setError('');
    } catch (cause) {
      if (silent || token !== requestToken.current) return;
      setError(getApiErrorMessage(cause, 'Unable to load organizations.'));
    } finally {
      if (!silent && token === requestToken.current) setLoading(false);
    }
  }, [page, debouncedSearch, status]);
  useEffect(() => { load(); }, [load]);
  useRefetchOnReturn(() => Promise.all([load(page, { silent: true }), loadCounts({ silent: true })]));

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
  const showsProgress = (org) => {
    const lifecycle = org.lifecycle_status || status;
    return lifecycle === 'pending' || lifecycle === 'returned' || needsAdministrator({ ...org, lifecycle_status: lifecycle });
  };
  const columns = [
    {
      key: 'organization',
      header: 'Organization',
      render: (org) => {
        const lifecycle = org.lifecycle_status || status;
        return (
          <div className="flex min-w-0 items-start gap-3 text-left">
            {org.logo_url && <img src={resolveAssetUrl(org.logo_url)} alt="" className="h-10 w-10 shrink-0 rounded-control object-cover" />}
            <div className="min-w-0">
              <h3 className={`break-words text-sm font-semibold ${lifecycle === 'archived' ? 'text-ink-muted' : 'text-ink'}`}>{formatDisplayText(org.name)}</h3>
              <p className="mt-1 text-xs font-normal text-ink-muted">{org.acronym} · {org.is_university_wide ? 'All colleges' : org.college || 'No college assigned'}</p>
              {org.parent_organization && <p className="mt-1 text-xs font-normal text-ink-muted">Sub organization of {formatDisplayText(org.parent_organization.name)}</p>}
              {lifecycle !== 'active' && <div className="mt-2"><LifecycleBadge status={lifecycle} /></div>}
              {org.college_is_active === false && <p className="mt-2 text-xs font-normal text-danger-strong">College archived, sign-in disabled</p>}
            </div>
          </div>
        );
      },
    },
    ...(items.some(showsProgress) ? [{
      key: 'progress',
      header: 'Registration progress',
      render: (org) => {
        if (!showsProgress(org)) return null;
        const lifecycle = org.lifecycle_status || status;
        return (
          <div className="text-left">
            <RegistrationRowStatus organization={{ ...org, lifecycle_status: lifecycle }} viewerRole="SUPER_ADMIN" />
            {lifecycle === 'pending' && org.submitted_at && <p className="mt-2 text-xs font-normal text-ink-muted">Submitted {manilaDate(org.submitted_at)}</p>}
            {lifecycle === 'returned' && <p className="mt-2 text-xs font-normal text-danger-strong">Returned with remarks: {org.review_remarks || 'No remarks were recorded.'}</p>}
          </div>
        );
      },
    }] : []),
    { key: 'members', header: 'Members', align: 'right', render: (org) => org.users_count || 0 },
    { key: 'admins', header: 'Admins', align: 'right', render: (org) => org.administrators_count ?? org.administrators?.length ?? 0 },
  ];
  const rowActions = (org) => {
    const lifecycle = org.lifecycle_status || status;
    const name = formatDisplayText(org.name);
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {lifecycle === 'pending' && (
          <Button variant="secondary" size="sm" className="max-md:min-h-[42px]" aria-label={`Review ${name}`} onClick={() => { setReviewTarget(org); setReviewOpen(true); }}>Review</Button>
        )}
        <TableRowActions subject={name} label="Organization actions" actions={[
          { label: 'Open organization', icon: Building2, to: organizationOverviewPath(org.id) },
          lifecycle === 'pending' && { label: 'Review registration', icon: ClipboardCheck, disabled: org.college_is_active === false, onClick: () => { setReviewTarget(org); setReviewOpen(true); } },
          needsAdministrator({ ...org, lifecycle_status: lifecycle }) && { label: 'Add first administrator', icon: UserPlus, disabled: org.college_is_active === false, onClick: () => setExistingAdminOrganization(org) },
          lifecycle === 'archived' && { label: 'Restore organization', icon: RotateCcw, disabled: org.college_is_active === false, onClick: () => { setLifecycleError(''); setRestoreTarget(org); } },
          lifecycle === 'active' && { label: 'Edit organization', icon: PencilLine, disabled: org.college_is_active === false, onClick: () => { setLogoFile(null); setForm(org); } },
          lifecycle === 'active' && { label: 'Add existing student', icon: UserPlus, disabled: !org.is_active || (!org.college && !org.is_university_wide) || org.college_is_active === false, onClick: () => setMembershipOrganization(org) },
          lifecycle === 'active' && !needsAdministrator(org) && { label: 'Add administrator', icon: UserPlus, disabled: !org.is_active || org.college_is_active === false, onClick: () => setExistingAdminOrganization(org) },
          lifecycle === 'active' && { label: 'Manage user profiles', icon: Users, disabled: org.college_is_active === false, onClick: () => setProfileOrganization(org) },
          lifecycle === 'active' && { label: 'Archive organization', icon: Archive, disabled: org.college_is_active === false, danger: true, onClick: () => { setLifecycleError(''); setArchiveTarget(org); } },
          { label: 'Delete organization', icon: Trash2, danger: true, onClick: () => { setLifecycleError(''); setDeleteTarget(org); } },
        ]} />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {status && <div className="hidden sm:block"><Tabs tabs={tabs} value={status} onChange={selectStatus} /></div>}
      <div {...(status ? { role: 'tabpanel', id: PANEL_ID, 'aria-label': STATUS_TABS.find((tab) => tab.key === status).label } : {})} className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Search organizations" className="sm:w-full sm:max-w-md"><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, code, or college" /></Field>
        {status && <Field label="Status" className="sm:hidden"><Select value={status} onChange={(event) => selectStatus(event.target.value)}>{tabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}</Select></Field>}
        {search && <button type="button" onClick={() => setSearch('')} className="inline-flex min-h-11 items-center self-start rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 sm:self-end">Clear</button>}
      </div>
      {status === 'archived' && <p role="note" className="text-sm text-ink-muted-strong">Archived organizations are read-only. Restore to make changes.</p>}
      {actionError && <p role="alert" className="rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{actionError}</p>}
      {notice && <p role="status" className="rounded-control bg-success-tint p-3 text-sm font-medium text-success-strong">{notice}</p>}
      <DataTable
        caption="Student organizations, registration progress, membership, and actions"
        columns={columns}
        rows={items}
        rowKey={(org) => org.id}
        loading={loading && !error}
        error={error && !form ? error : null}
        onRetry={() => load()}
        stickyHeader={false}
        actions={rowActions}
        actionsHeader="Actions"
        emptyState={debouncedSearch.trim()
          ? <EmptyState kind="filtered" description="Try a different search term." onClearFilters={() => setSearch('')} />
          : <EmptyState kind="first-run" title={EMPTY_COPY[status]} description={EMPTY_HINT[status]} />}
      />
      {lastPage > 1 && <nav aria-label="Organization pages" className="flex items-center justify-end gap-3 text-xs text-ink-muted"><Button variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {lastPage}</span><Button variant="secondary" size="sm" disabled={loading || page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button></nav>}
      </div>
      {form && !membershipOrganization && !profileOrganization && (
        <Drawer
          open
          title="Edit organization"
          onClose={() => !busy && setForm(null)}
          width="max-w-lg"
          footer={(
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" form="edit-organization-form" loading={busy}>Save organization</Button>
            </>
          )}
        >
          <form id="edit-organization-form" onSubmit={save} className="space-y-4">
            {error && <p role="alert" className="rounded-control bg-danger-tint p-3 text-sm font-medium text-danger-strong">{error}</p>}
            <Field label="Organization name" required><Input value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Organization code" required><Input value={form.acronym || ''} onChange={(event) => setForm({ ...form, acronym: event.target.value })} /></Field>
            <Field label="Main organization">
              <Select disabled={parentLoading || Boolean(parentError)} value={form.parent_organization_id || ''} onChange={(event) => setForm({ ...form, parent_organization_id: event.target.value })}>
                <option value="">This is a main organization</option>
                {parents.filter((parent) => parent.id !== form.id).map((parent) => <option key={parent.id} value={parent.id}>{formatDisplayText(parent.name)}</option>)}
              </Select>
            </Field>
            {parentLoading && <p role="status" className="text-xs text-ink-muted">Loading parent organizations...</p>}
            {parentError && <p role="alert" className="text-sm text-danger-strong">{parentError} <button type="button" onClick={loadParents} className="min-h-10 font-medium underline">Retry parent organizations</button></p>}
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">College</span>
              <p className="flex h-10 items-center rounded-control border border-line bg-subtle px-3 text-sm text-ink">{formatDisplayText(form.college) || 'Not assigned'}</p>
            </div>
            <Field label="Organization color" optional><input type="color" value={form.color || '#0B8ED0'} onChange={(event) => setForm({ ...form, color: event.target.value })} className="h-10 w-20 cursor-pointer rounded-control border border-line bg-surface p-1" /></Field>
            <Field label="Organization logo" optional hint={logoFile ? logoFile.name : undefined}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} className="block w-full rounded-control border border-line bg-surface p-2 text-sm" /></Field>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="organization-description" className="text-[13px] font-medium text-ink">Description <span className="font-normal text-ink-muted">(optional)</span></label>
              <RichTextEditor id="organization-description" value={form.description || ''} onChange={(description) => setForm({ ...form, description })} rows={4} />
            </div>
            <div className="border-t border-line pt-4">
              <h4 className="text-sm font-semibold text-ink">Organization members</h4>
              <p className="mt-1 text-xs text-ink-muted">Add an eligible existing university user with a separate organization profile.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" leftIcon={UserPlus} disabled={busy || !editingBase?.is_active || (!editingBase?.college_id && !editingBase?.is_university_wide)} onClick={() => setMembershipOrganization(editingBase)}>Add existing student</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setProfileOrganization(editingBase)}>Manage user profiles</Button>
              </div>
            </div>
          </form>
        </Drawer>
      )}
      {reviewTarget && <ReviewDrawer key={reviewTarget.id} organization={reviewTarget} open={reviewOpen} onClose={closeReview} onReviewed={finishReview} onApproved={approvedReview} onStale={staleReview} />}
      {deleteTarget && <PermanentDeleteModal key={deleteTarget.id} name={deleteTarget.name} kind="organization" busy={lifecycleBusy} error={lifecycleError} onClose={() => setDeleteTarget(null)} onConfirm={(name) => runLifecycle(() => deleteSystemOrganization(deleteTarget.id, name), deleteTarget, 'Organization, memberships, records, and files permanently deleted.')} />}
      {archiveTarget && <ArchiveModal organization={archiveTarget} busy={lifecycleBusy} error={lifecycleError} onCancel={() => setArchiveTarget(null)} onConfirm={(reason) => runLifecycle(() => archiveSystemOrganization(archiveTarget.id, reason ? { reason } : {}), archiveTarget, `${formatDisplayText(archiveTarget.name)} archived.`)} />}
      <ConfirmModal open={Boolean(restoreTarget)} title="Restore organization" message={restoreTarget ? `Restore ${formatDisplayText(restoreTarget.name)} so it can be edited and used again?` : ''} recordName={restoreTarget ? `Restore ${formatDisplayText(restoreTarget.name)}?` : ''} confirmText="Restore organization" variant="primary" busy={lifecycleBusy} onCancel={() => setRestoreTarget(null)} onConfirm={() => runLifecycle(() => restoreSystemOrganization(restoreTarget.id), restoreTarget, `${formatDisplayText(restoreTarget.name)} restored.`)} />
      {profileOrganization && <ManageAccountProfilesModal organization={profileOrganization} onClose={() => setProfileOrganization(null)} onDeleted={(result) => { setNotice(result.message); load(); }} />}
      {creatingUnified && <CreateUnifiedOrganizationModal onClose={() => setCreatingUnified(false)} onCreated={(organization) => { setCreatingUnified(false); setNotice('Unified organization created. Add its first administrator to get started.'); setSearchParams({ status: 'active' }); setPage(1); load(); setExistingAdminOrganization(organization); }} />}
      {membershipOrganization && <AddExistingUserModal actorRole="SUPER_ADMIN" organization={membershipOrganization} onClose={() => setMembershipOrganization(null)} onAdded={() => { setNotice('User added to the organization.'); load(); }} />}
      {existingAdminOrganization && <AddExistingUserModal actorRole="SUPER_ADMIN" organization={existingAdminOrganization} initialRole="ADMIN" onClose={() => setExistingAdminOrganization(null)} onAdded={() => { setNotice('Admin profile added to the organization.'); load(); }} />}
    </div>
  );
}
