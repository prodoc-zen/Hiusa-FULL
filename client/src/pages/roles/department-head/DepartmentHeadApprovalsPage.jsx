import HiusaSelect from '../../../components/ui/Select';
import { ROLE_LABELS, formatDisplayText } from '../../../utils/displayText.js';
import { manilaDateStamp } from '../../../utils/dateTime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus, Search } from 'lucide-react';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import notify from '../../../lib/notify';
import { getApiErrorMessage } from '../../../utils/apiError';
import PaginationControls from '../../../components/PaginationControls';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { Button, EmptyState, Field, FlowStepper, Input, PageHeader, SkeletonTable, StatusBadge, Tabs, Textarea } from '../../../components/ui';
import { getCollegeOrganizations } from '../../../services/collegeOrganizationService';
import * as systemAdminService from '../../../services/systemAdministrationService';
import useRecordParam from '../../../lib/useRecordParam';
import { useRefetchOnReturn } from '../../../hooks/useRefetchOnReturn';
import ApprovalDetailDrawer from '../../../components/approvals/ApprovalDetailDrawer';
import ApprovalReceipt from '../../../components/approvals/ApprovalReceipt';
import { ENTITY_LABEL, describeApproval, entityLink } from '../../../components/approvals/approvalStage';
import { formatDateTime, fullName, summaryLine } from '../../../components/approvals/approvalFormat';
import { findApprovalRequest } from '../../modules/approvals/approvalApi';
import useActiveSubAccount from '../../../hooks/useActiveSubAccount';
import { isOfficeStaff } from '../../../utils/collegeIdentity';
import { buildCsv } from '../../../utils/csv';

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch {
    return {};
  }
}

const REVIEW_STATUS_TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'all', label: 'All history' },
];

const SUBMITTED_STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const NEW_REQUEST_PATH = '/dashboard/approval-requests/new';

const REVIEW_EMPTY = {
  SUPER_ADMIN: 'Nothing from the colleges needs your decision right now.',
  DEPARTMENT_HEAD: 'Nothing from the organizations in your college needs your decision right now.',
  ADMIN: 'Nothing from your officers or students needs your decision right now.',
};

function downloadCsv(rows, organizationNames) {
  const headers = ['Request ID', 'Organization', 'Type', 'Title', 'Status', 'Requester ID', 'Requester', 'Role', 'Position', 'Department', 'Program', 'Year Level', 'Section', 'Requested At', 'Reviewer', 'Reviewed At', 'Remarks'];
  const values = rows.map((item) => [item.id, organizationNames[item.organization_id] || '', item.entity_type, item.title, item.status, item.requester?.school_id, fullName(item.requester), item.requester?.role, item.requester?.position_title, item.requester?.department, item.requester?.program, item.requester?.year_level, item.requester?.section, item.requested_at, fullName(item.reviewer), item.reviewed_at, item.remarks]);
  const csv = buildCsv(headers, values);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `approval-register-${manilaDateStamp()}.csv`; link.click(); URL.revokeObjectURL(url);
}

function ReviewModal({ open, request, action, onCancel, onConfirm, busy, organizationName, error }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (open) setRemarks('');
  }, [open]);

  if (!open || !request) return null;

  const isReject = action === 'rejected';

  return (
    <AccessibleOverlay label={`${isReject ? 'Reject' : 'Approve'} request`} onClose={() => !busy && onCancel()} className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-line bg-surface p-6">
        <h3 className="text-lg font-semibold text-ink">
          {isReject ? 'Reject' : 'Approve'} "{formatDisplayText(request.title)}"
        </h3>
        <div className="mt-4"><ApprovalReceipt request={request} organizationName={organizationName} /></div>
        <Field className="mt-4" label={isReject ? 'Remarks (required)' : 'Remarks'} optional={!isReject} required={isReject}>
          <Textarea
            id="approval-remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            rows={3}
            placeholder={isReject ? 'e.g. Budget not yet finalized.' : 'A note for the requester'}
            className="resize-none"
          />
        </Field>
        {error && <p role="alert" className="mt-4 text-sm font-semibold text-danger-strong">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={isReject ? 'danger' : 'primary'} onClick={() => onConfirm(remarks)} disabled={busy || request.status !== 'pending' || (isReject && !remarks.trim())}>
            {busy ? 'Saving...' : isReject ? 'Reject' : 'Approve'}
          </Button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

function ApprovalRow({ request, role, organizationName, canAct, onOpen }) {
  const info = describeApproval(request, role);
  const link = entityLink(request, role);
  const typeLabel = ENTITY_LABEL[request.entity_type] || request.entity_type;
  const summary = summaryLine(request.entity_type, request.summary);
  const requesterRole = request.requester?.role ? (ROLE_LABELS[request.requester.role] ?? formatDisplayText(request.requester.role)) : null;
  const requesterDetail = [requesterRole, request.requester?.position_title, request.requester?.program, request.requester?.year_level, request.requester?.section].filter(Boolean).join(' · ');
  // The Review button already says what to do, so a request this viewer decides gets no second line saying "Review this ...".
  const showStage = info.kind === 'lifecycle' ? !canAct : request.status === 'pending';

  return (
    <li className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-ink">{formatDisplayText(request.title)}</p>
          {request.status !== 'pending' && <StatusBadge status={request.status} />}
        </div>
        <p className="mt-1 text-xs text-ink-muted-strong">{[typeLabel, organizationName].filter(Boolean).join(' · ')}</p>
        {summary && <p className="mt-1 text-xs text-ink-muted-strong">{summary}</p>}
        <p className="mt-1 text-xs text-ink-muted-strong">
          Requested by {request.requester ? `${formatDisplayText(request.requester.first_name)} ${formatDisplayText(request.requester.last_name)}` : 'Unknown'} · {formatDateTime(request.requested_at)}
        </p>
        {requesterDetail && <p className="mt-1 text-xs text-ink-muted-strong">{requesterDetail}</p>}
        <div className="mt-3 max-w-md">
          {info.kind === 'lifecycle' && <FlowStepper variant="compact" steps={info.steps} ariaLabel={`${typeLabel} progress for ${formatDisplayText(request.title)}`} />}
          {showStage && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-ink">
              {info.kind === 'chip' ? <StatusBadge label={info.stageText} tone={info.tone} /> : <span>{info.stageText}</span>}
              {info.waitingOn && <span className="font-normal text-ink-muted-strong">Waiting on {info.waitingOn}</span>}
            </p>
          )}
        </div>
        {request.status !== 'pending' && request.remarks && (
          <p className="mt-2 rounded-control bg-subtle px-2.5 py-1.5 text-xs text-ink-muted-strong">
            <span className="font-medium">Remarks:</span> {request.remarks}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" aria-label={`${canAct ? 'Review' : 'Details'}: ${formatDisplayText(request.title)}`} onClick={() => onOpen(request)}>
          {canAct ? 'Review' : 'Details'}
        </Button>
        {link && (
          <Button variant="ghost" to={link.to} aria-label={`${link.label}: ${formatDisplayText(request.title)}`}>
            {link.label}
          </Button>
        )}
      </div>
    </li>
  );
}

export default function DepartmentHeadApprovalsPage() {
  const user = useMemo(() => getCurrentUser(), []);
  const role = (isOfficeStaff(user) ? 'DEPARTMENT_HEAD' : user.role) || '';
  const isDepartmentHead = role === 'DEPARTMENT_HEAD';
  const isSao = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN';
  const isOfficer = role === 'SBO_OFFICER';
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = isOfficer || (isAdmin && searchParams.get('tab') === 'submitted') ? 'submitted' : 'review';
  const [recordId, setRecordId] = useRecordParam();

  const [requests, setRequests] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [pendingTotal, setPendingTotal] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [statusFilter, setStatusFilter] = useState(tab === 'submitted' ? 'all' : 'pending');
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(null);
  const [modalState, setModalState] = useState({ open: false, request: null, action: null });
  const [decisionError, setDecisionError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [organizations, setOrganizations] = useState([]);
  const { subAccountId } = useActiveSubAccount();
  const [organizationFilter, setOrganizationFilter] = useState(() => (subAccountId ? String(subAccountId) : 'all'));
  useEffect(() => {
    setOrganizationFilter(subAccountId ? String(subAccountId) : 'all');
  }, [subAccountId]);
  const loadCounter = useRef(0);
  const organizationNames = useMemo(() => Object.fromEntries(organizations.map((organization) => [organization.id, organization.name])), [organizations]);
  const statusTabs = tab === 'submitted' ? SUBMITTED_STATUS_TABS : REVIEW_STATUS_TABS;
  const filtersActive = Boolean(search || entityFilter !== 'all' || organizationFilter !== 'all');

  useEffect(() => {
    if (!isDepartmentHead && !isSao) return;
    fetchAllPages((params) => isSao ? systemAdminService.getSystemOrganizations(params) : getCollegeOrganizations(params).then((res) => res.data))
      .then(setOrganizations)
      .catch(() => notify.error('Could not load organizations.'));
  }, [isDepartmentHead, isSao]);

  // Hoisted so the CSV export can reuse the exact same filter set as the
  // loaded page, without page/per_page, via fetchAllPages.
  const queryParams = useMemo(() => ({
    status: statusFilter,
    scope: tab === 'submitted' ? 'submitted' : undefined,
    entity_type: entityFilter === 'all' ? undefined : entityFilter,
    search: search || undefined,
    organization_id: organizationFilter === 'all' ? undefined : organizationFilter,
  }), [statusFilter, tab, entityFilter, search, organizationFilter]);

  // A silent refresh re-reads the page the user is looking at without touching the loading flag,
  // the shared error or anything typed. It yields to any newer full load and to a changed view.
  const viewSignature = JSON.stringify([queryParams, page, tab, isAdmin]);
  const currentView = useRef(viewSignature);
  useEffect(() => { currentView.current = viewSignature; });

  const load = useCallback(({ silent = false } = {}) => {
    const signature = JSON.stringify([queryParams, page, tab, isAdmin]);
    let ticket = loadCounter.current;
    if (!silent) {
      ticket += 1;
      loadCounter.current = ticket;
      setLoading(true);
      setError(null);
      setForbidden(false);
    }
    const isStale = () => ticket !== loadCounter.current || (silent && signature !== currentView.current);
    const reviewCountRequest = isAdmin && tab === 'submitted' ? getApprovalRequests({ status: 'pending', per_page: 1 }) : null;
    return Promise.all([
      getApprovalRequests({ ...queryParams, page }),
      getApprovalRequests({ status: 'pending', per_page: 1, organization_id: queryParams.organization_id, scope: queryParams.scope }),
      reviewCountRequest,
    ])
      .then(([listRes, pendingRes, reviewRes]) => {
        if (isStale()) return;
        const pending = listMeta(pendingRes.data).total;
        const nextRequests = unwrapList(listRes.data);
        const nextMeta = listMeta(listRes.data);
        setRequests((current) => (silent && JSON.stringify(current) === JSON.stringify(nextRequests) ? current : nextRequests));
        setMeta((current) => (silent && JSON.stringify(current) === JSON.stringify(nextMeta) ? current : nextMeta));
        setPendingTotal(pending);
        if (tab === 'review') setReviewCount(pending);
        else if (reviewRes) setReviewCount(listMeta(reviewRes.data).total);
      })
      .catch((err) => {
        if (silent || isStale()) return;
        if (err?.response?.status === 403) setForbidden(true);
        else setError('Could not load approval requests.');
      })
      .finally(() => {
        if (!silent && ticket === loadCounter.current) setLoading(false);
      });
  }, [queryParams, page, tab, isAdmin]);

  async function handleExport() {
    setExporting(true);
    try {
      const all = await fetchAllPages((params) => getApprovalRequests(params).then((res) => res.data), queryParams);
      downloadCsv(all, organizationNames);
    } catch {
      setError('Could not export approval requests.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [statusFilter, tab, entityFilter, search, organizationFilter]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  useRefetchOnReturn(() => load({ silent: true }));

  useEffect(() => {
    if (!recordId) {
      setOpened(null);
      return;
    }
    setOpened((current) => (current?.id === recordId ? current : { id: recordId, request: null, state: 'loading' }));
  }, [recordId]);

  useEffect(() => {
    if (opened?.state !== 'loading' || loading) return;
    const local = requests.find((request) => String(request.id) === opened.id);
    setOpened(local ? { id: opened.id, request: local, state: 'ready' } : { id: opened.id, request: null, state: 'searching' });
  }, [opened, loading, requests]);

  useEffect(() => {
    if (opened?.state !== 'searching') return undefined;
    let cancelled = false;
    findApprovalRequest(opened.id)
      .then((found) => {
        if (!cancelled) setOpened({ id: opened.id, request: found, state: found ? 'ready' : 'missing' });
      })
      .catch(() => {
        if (!cancelled) setOpened({ id: opened.id, request: null, state: 'missing' });
      });
    return () => { cancelled = true; };
  }, [opened]);

  function changeTab(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'submitted') params.set('tab', 'submitted');
    else params.delete('tab');
    params.delete('record');
    setSearchParams(params, { replace: true });
    setStatusFilter(next === 'submitted' ? 'all' : 'pending');
    setPage(1);
  }

  function resetFilters() {
    setSearch('');
    setEntityFilter('all');
    setOrganizationFilter('all');
  }

  const canAct = (request) => request.status === 'pending' && Boolean(role) && request.required_role === role && request.requested_by !== user.school_id;

  async function handleReview(remarks) {
    const { request, action, files } = modalState;
    setSubmitting(true);
    setDecisionError(null);
    try {
      const { data } = await reviewApprovalRequest(request.id, { status: action, remarks: remarks.trim() || null, ...(files ? { files } : {}) });
      const updated = { ...request, ...data, requester: { ...request.requester, ...data?.requester }, reviewer: { ...request.reviewer, ...data?.reviewer } };
      setModalState({ open: false, request: null, action: null });
      setOpened({ id: String(request.id), request: updated, state: 'ready' });
      notify.success(`Request ${action}.`);
      load();
    } catch (cause) {
      const message = getApiErrorMessage(cause, 'Could not save your decision. Try again.');
      setDecisionError(message);
      if (cause?.response?.status === 409) {
        load();
        const fresh = await findApprovalRequest(request.id).catch(() => null);
        if (fresh) {
          setOpened((current) => (current?.id === String(fresh.id) ? { id: current.id, request: fresh, state: 'ready' } : current));
          setModalState((current) => (current.request?.id === fresh.id ? { ...current, request: fresh } : current));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  // An election is decided from the drawer itself (approve, ask for changes, reject for good), so it skips the remarks
  // dialog. A failure goes back to the drawer, which shows it beside the buttons.
  async function decideElection(request, payload) {
    const { data } = await reviewApprovalRequest(request.id, payload);
    const updated = { ...request, ...data, requester: { ...request.requester, ...data?.requester }, reviewer: { ...request.reviewer, ...data?.reviewer } };
    setOpened({ id: String(request.id), request: updated, state: 'ready' });
    notify.success(payload.final ? 'Election rejected for good.' : `Request ${payload.status}.`);
    load();
  }

  function renderEmpty() {
    if (forbidden) {
      return <EmptyState kind="restricted" title="Approvals are for the Admin and the Department Head" description="Only they can decide requests." />;
    }

    if (filtersActive) {
      return <EmptyState kind="filtered" title="No requests match these filters" description="Try a different type, organization or search." onClearFilters={resetFilters} />;
    }

    if (tab === 'submitted') {
      if (statusFilter !== 'all') {
        const label = statusTabs.find((option) => option.value === statusFilter)?.label.toLowerCase();
        return <EmptyState kind="filtered" title={`No ${label} requests`} description="Nothing your organization submitted is in this state." onClearFilters={() => setStatusFilter('all')} />;
      }

      return (
        <EmptyState
          title="Nothing submitted yet"
          description="Requests your organization sends for approval show here, with who each one is waiting on."
          action={<Button variant="secondary" to={NEW_REQUEST_PATH}>Start a new request</Button>}
        />
      );
    }

    if (statusFilter === 'pending') {
      return <EmptyState title="No requests to review" description={REVIEW_EMPTY[role] ?? 'Requests sent to you for a decision appear here.'} />;
    }

    return <EmptyState title="No approval history yet" description="Requests you approve or reject are listed here afterwards." />;
  }

  const headerPrimary = isAdmin || isOfficer ? <Button to={NEW_REQUEST_PATH} leftIcon={Plus}>New request</Button> : undefined;
  const headerActions = meta.total > 0 ? (
    <Button variant="secondary" leftIcon={Download} onClick={handleExport} disabled={exporting}>
      {exporting ? 'Exporting...' : 'Export CSV'}
    </Button>
  ) : undefined;
  const listLabel = tab === 'submitted' ? 'Requests submitted by my organization' : 'Requests to review';

  return (
    <div className="space-y-6">
      <PageHeader actions={headerActions} primary={headerPrimary} />

      {isAdmin && (
        <Tabs
          value={tab}
          onChange={changeTab}
          tabs={[
            { key: 'review', label: `To review${reviewCount ? ` (${reviewCount})` : ''}`, panelId: 'approvals-panel' },
            { key: 'submitted', label: 'Submitted by me', panelId: 'approvals-panel' },
          ]}
        />
      )}

      <div id="approvals-panel" role={isAdmin ? 'tabpanel' : undefined} aria-label={isAdmin ? listLabel : undefined} className="space-y-4">
        {!isAdmin && (
          <Tabs
            value={statusFilter}
            onChange={(next) => { setStatusFilter(next); setPage(1); }}
            tabs={statusTabs.map((option) => ({
              key: option.value,
              label: option.value === 'pending' && tab === 'review' ? `Pending${pendingTotal ? ` (${pendingTotal})` : ''}` : option.label,
              panelId: 'approvals-panel',
            }))}
          />
        )}

        <div className={`grid grid-cols-1 items-center gap-3 md:grid-cols-2 ${(isDepartmentHead || isSao || isAdmin) ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          <label className="relative min-w-0 xl:col-span-2">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-ink-muted" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requester or remarks" aria-label="Search requests" className="pl-9" />
          </label>
          <HiusaSelect filter aria-label="Request type" value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
            <option value="all">All request types</option>{Object.entries(ENTITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </HiusaSelect>
          {isAdmin && (
            <HiusaSelect aria-label="Status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
              {statusTabs.map((option) => <option key={option.value} value={option.value}>{option.value === 'pending' && tab === 'review' ? 'Pending' : option.label}</option>)}
            </HiusaSelect>
          )}
          {(isDepartmentHead || isSao) && (
            <HiusaSelect filter aria-label="Organization" value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)}>
              <option value="all">All organizations</option>{organizations.map((organization) => <option key={organization.id} value={String(organization.id)}>{organization.name}</option>)}
            </HiusaSelect>
          )}
          {filtersActive && <button type="button" onClick={resetFilters} className="inline-flex min-h-11 items-center justify-self-start rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
        </div>

        {error && (
          <div role="alert" className="rounded-card border border-danger/40 bg-danger-tint px-4 py-3">
            <p className="text-sm font-semibold text-danger-strong">{error}</p>
          </div>
        )}

        <section className="rounded-card border border-line bg-surface">
          {loading ? (
            <SkeletonTable rows={3} columns={3} className="border-0" />
          ) : requests.length === 0 ? (
            <div className="px-4">{renderEmpty()}</div>
          ) : (
            <ul aria-label={listLabel} className="divide-y divide-line">
              {requests.map((request) => (
                <ApprovalRow
                  key={request.id}
                  request={request}
                  role={role}
                  organizationName={organizationNames[request.organization_id]}
                  canAct={canAct(request)}
                  onOpen={(selected) => setRecordId(selected.id)}
                />
              ))}
            </ul>
          )}
          {!loading && requests.length > 0 && (
            <PaginationControls
              currentPage={meta.currentPage}
              totalItems={meta.total}
              pageSize={meta.perPage}
              onPageChange={setPage}
              label="requests"
            />
          )}
        </section>
      </div>

      <ReviewModal
        open={modalState.open}
        request={modalState.request}
        action={modalState.action}
        busy={submitting}
        error={decisionError}
        organizationName={organizationNames[modalState.request?.organization_id]}
        onCancel={() => { setDecisionError(null); setModalState({ open: false, request: null, action: null }); }}
        onConfirm={handleReview}
      />

      <ApprovalDetailDrawer
        open={Boolean(opened)}
        request={opened?.request ?? null}
        status={opened?.state === 'missing' ? 'missing' : 'loading'}
        role={role}
        canAct={Boolean(opened?.request) && canAct(opened.request)}
        organizationName={organizationNames[opened?.request?.organization_id]}
        onClose={() => { if (!modalState.open) setRecordId(null); }}
        onApprove={(request, files) => setModalState({ open: true, request, action: 'approved', files })}
        onReject={(request, files) => setModalState({ open: true, request, action: 'rejected', files })}
        onDecide={decideElection}
      />
    </div>
  );
}
