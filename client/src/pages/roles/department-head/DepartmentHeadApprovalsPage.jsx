import { formatDisplayText } from '../../../utils/displayText.js';
import DateTimeInput from '../../../components/ui/DateTimeInput.jsx';
import FieldIcon from '../../../components/FieldIcon.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Coins, Download, FileText, Megaphone, Package, Plus, Search, Vote, Clock } from 'lucide-react';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import notify from '../../../lib/notify';
import PaginationControls from '../../../components/PaginationControls';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { Button, EmptyState, FlowStepper, PageHeader, StatusBadge, Tabs } from '../../../components/ui';
import { getCollegeOrganizations } from '../../../services/collegeOrganizationService';
import useRecordParam from '../../../lib/useRecordParam';
import ApprovalDetailDrawer from '../../../components/approvals/ApprovalDetailDrawer';
import ApprovalReceipt from '../../../components/approvals/ApprovalReceipt';
import { ENTITY_LABEL, describeApproval, entityLink } from '../../../components/approvals/approvalStage';
import { formatDateTime, fullName, summaryLine } from '../../../components/approvals/approvalFormat';
import { findApprovalRequest } from '../../modules/approvals/approvalApi';

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch {
    return {};
  }
}

const ENTITY_ICON = {
  event: CalendarDays,
  budget: Coins,
  election: Vote,
  announcement: Megaphone,
  payment: Package,
  financial_report: FileText,
};

const REVIEW_STATUS_TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'all', label: 'All History' },
];

const SUBMITTED_STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const NEW_REQUEST_PATH = '/dashboard/approval-requests/new';

const REVIEW_EMPTY = {
  DEPARTMENT_HEAD: 'Events, budgets, elections and financial reports from the organizations in your college appear here for your decision. The organization Admin sends them.',
  ADMIN: 'Announcements your officers submit and student payments that need a check appear here for your decision. Officers send them from their own pages.',
};

function downloadCsv(rows, organizationNames) {
  const headers = ['Request ID', 'Organization', 'Type', 'Title', 'Status', 'Requester ID', 'Requester', 'Role', 'Position', 'Department', 'Program', 'Year Level', 'Section', 'Requested At', 'Reviewer', 'Reviewed At', 'Remarks'];
  const values = rows.map((item) => [item.id, organizationNames[item.organization_id] || '', item.entity_type, item.title, item.status, item.requester?.school_id, fullName(item.requester), item.requester?.role, item.requester?.position_title, item.requester?.department, item.requester?.program, item.requester?.year_level, item.requester?.section, item.requested_at, fullName(item.reviewer), item.reviewed_at, item.remarks]);
  const csv = [headers, ...values].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `approval-register-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
}

function ReviewModal({ open, request, action, onCancel, onConfirm, busy, organizationName }) {
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (open) setRemarks('');
  }, [open]);

  if (!open || !request) return null;

  const isReject = action === 'rejected';

  return (
    <AccessibleOverlay label={`${isReject ? 'Reject' : 'Approve'} request`} onClose={() => !busy && onCancel()} className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-[#0F172A]">
          {isReject ? 'Reject' : 'Approve'} "{formatDisplayText(request.title)}"
        </h3>
        <div className="mt-4"><ApprovalReceipt request={request} organizationName={organizationName} /></div>
        <div className="mt-4 space-y-1.5">
          <label htmlFor="approval-remarks" className="text-[13px] font-semibold text-[#0F172A]">
           <FieldIcon label="Remarks" /> Remarks {isReject ? '(required)' : '(optional)'}
          </label>
          <textarea
            id="approval-remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            rows={3}
            required={isReject}
            placeholder={isReject ? 'e.g. Budget not yet finalized.' : 'Optional note for the requester...'}
            className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={isReject ? 'danger' : 'primary'} onClick={() => onConfirm(remarks)} disabled={busy || (isReject && !remarks.trim())}>
            {busy ? 'Processing...' : isReject ? 'Reject' : 'Approve'}
          </Button>
        </div>
      </div>
    </AccessibleOverlay>
  );
}

function ApprovalRow({ request, role, organizationName, canAct, onOpen }) {
  const Icon = ENTITY_ICON[request.entity_type] || Clock;
  const info = describeApproval(request, role);
  const link = entityLink(request, role);
  const typeLabel = ENTITY_LABEL[request.entity_type] || request.entity_type;
  const summary = summaryLine(request.entity_type, request.summary);

  return (
    <li className="flex flex-col gap-3 p-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-navy-800">
          <Icon size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-ink">{formatDisplayText(request.title)}</p>
            <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink-muted-strong">{typeLabel}</span>
            {organizationName && <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-bold text-navy-800">{organizationName}</span>}
            <StatusBadge status={request.status} />
          </div>
          {summary && <p className="mt-1 text-xs text-ink-muted-strong">{summary}</p>}
          <p className="mt-1 text-xs text-ink-muted-strong">
            Requested by {request.requester ? `${formatDisplayText(request.requester.first_name)} ${formatDisplayText(request.requester.last_name)}` : 'Unknown'} ({request.requester?.school_id || 'No ID'}) | {formatDateTime(request.requested_at)}
          </p>
          <p className="mt-1 text-xs text-ink-muted-strong">{[request.requester?.role, request.requester?.position_title, request.requester?.program, request.requester?.year_level, request.requester?.section].filter(Boolean).join(' · ') || 'No requester profile details'}</p>
          <div className="mt-3 max-w-md">
            {info.kind === 'lifecycle' && <FlowStepper variant="compact" steps={info.steps} ariaLabel={`${typeLabel} progress for ${formatDisplayText(request.title)}`} />}
            {(info.kind === 'lifecycle' || request.status === 'pending') && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-bold text-ink">
                {info.kind === 'chip' ? <StatusBadge label={info.stageText} tone={info.tone} /> : <span>{info.stageText}</span>}
                {info.waitingOn && <span className="font-semibold text-ink-muted-strong">Waiting on {info.waitingOn}</span>}
              </p>
            )}
          </div>
          {request.status !== 'pending' && request.remarks && (
            <p className="mt-2 rounded-md bg-subtle px-2.5 py-1.5 text-xs text-ink-muted-strong">
              <span className="font-semibold">Remarks:</span> {request.remarks}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="secondary" aria-label={`${canAct ? 'Review' : 'Details'}: ${formatDisplayText(request.title)}`} onClick={() => onOpen(request)}>{canAct ? 'Review' : 'Details'}</Button>
        {link && <Button variant="secondary" to={link.to} aria-label={`${link.label}: ${formatDisplayText(request.title)}`}>{link.label}</Button>}
      </div>
    </li>
  );
}

export default function DepartmentHeadApprovalsPage() {
  const user = useMemo(() => getCurrentUser(), []);
  const role = user.role || '';
  const isDepartmentHead = role === 'DEPARTMENT_HEAD';
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [opened, setOpened] = useState(null);
  const [modalState, setModalState] = useState({ open: false, request: null, action: null });
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [organizations, setOrganizations] = useState([]);
  const [organizationFilter, setOrganizationFilter] = useState('all');
  const loadCounter = useRef(0);
  const organizationNames = useMemo(() => Object.fromEntries(organizations.map((organization) => [organization.id, organization.name])), [organizations]);
  const statusTabs = tab === 'submitted' ? SUBMITTED_STATUS_TABS : REVIEW_STATUS_TABS;
  const filtersActive = Boolean(search || entityFilter !== 'all' || from || to || organizationFilter !== 'all');

  useEffect(() => {
    if (!isDepartmentHead) return;
    fetchAllPages((params) => getCollegeOrganizations(params).then((res) => res.data))
      .then(setOrganizations)
      .catch(() => notify.error('Could not load the organizations of your college.'));
  }, [isDepartmentHead]);

  // Hoisted so the CSV export can reuse the exact same filter set as the
  // loaded page, without page/per_page, via fetchAllPages.
  const queryParams = useMemo(() => ({
    status: statusFilter,
    scope: tab === 'submitted' ? 'submitted' : undefined,
    entity_type: entityFilter === 'all' ? undefined : entityFilter,
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
    sort,
    organization_id: organizationFilter === 'all' ? undefined : organizationFilter,
  }), [statusFilter, tab, entityFilter, search, from, to, sort, organizationFilter]);

  const load = useCallback(() => {
    const ticket = loadCounter.current + 1;
    loadCounter.current = ticket;
    setLoading(true);
    setError(null);
    setForbidden(false);
    // The "Pending (n)" button always names the pending queue, even while
    // viewing "All History", so it is read from its own totals-only request
    // rather than from whichever status is currently loaded into `requests`.
    // An Admin on "Submitted by me" also needs the To review count for its tab.
    const reviewCountRequest = isAdmin && tab === 'submitted' ? getApprovalRequests({ status: 'pending', per_page: 1 }) : null;
    Promise.all([
      getApprovalRequests({ ...queryParams, page }),
      getApprovalRequests({ status: 'pending', per_page: 1, organization_id: queryParams.organization_id, scope: queryParams.scope }),
      reviewCountRequest,
    ])
      .then(([listRes, pendingRes, reviewRes]) => {
        if (ticket !== loadCounter.current) return;
        const pending = listMeta(pendingRes.data).total;
        setRequests(unwrapList(listRes.data));
        setMeta(listMeta(listRes.data));
        setPendingTotal(pending);
        if (tab === 'review') setReviewCount(pending);
        else if (reviewRes) setReviewCount(listMeta(reviewRes.data).total);
      })
      .catch((err) => {
        if (ticket !== loadCounter.current) return;
        if (err?.response?.status === 403) setForbidden(true);
        else setError('Failed to load approval requests.');
      })
      .finally(() => {
        if (ticket === loadCounter.current) setLoading(false);
      });
  }, [queryParams, page, tab, isAdmin]);

  async function handleExport() {
    setExporting(true);
    try {
      const all = await fetchAllPages((params) => getApprovalRequests(params).then((res) => res.data), queryParams);
      downloadCsv(all, organizationNames);
    } catch {
      setError('Failed to export approval requests.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [statusFilter, tab, entityFilter, search, from, to, sort, organizationFilter]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  // ?record= opens the drawer. The row is taken from the loaded list when it is there; otherwise
  // (a notification link, a filter hiding it, another page of results) it is looked up by id in the
  // scopes the viewer can see.
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
    const scopes = isOfficer ? [{ scope: 'submitted' }]
      : isAdmin ? (tab === 'submitted' ? [{ scope: 'submitted' }, {}] : [{}, { scope: 'submitted' }])
        : [{}];
    findApprovalRequest(opened.id, scopes)
      .then((found) => {
        if (!cancelled) setOpened({ id: opened.id, request: found, state: found ? 'ready' : 'missing' });
      })
      .catch(() => {
        if (!cancelled) setOpened({ id: opened.id, request: null, state: 'missing' });
      });
    return () => { cancelled = true; };
  }, [opened, isOfficer, isAdmin, tab]);

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
    setFrom('');
    setTo('');
    setSort('newest');
  }

  const canAct = (request) => request.status === 'pending' && Boolean(role) && request.required_role === role && request.requested_by !== user.school_id;

  async function handleReview(remarks) {
    const { request, action } = modalState;
    setSubmitting(true);
    try {
      const { data } = await reviewApprovalRequest(request.id, { status: action, remarks: remarks.trim() || null });
      const updated = { ...request, ...data, requester: { ...request.requester, ...data?.requester }, reviewer: { ...request.reviewer, ...data?.reviewer } };
      setModalState({ open: false, request: null, action: null });
      setOpened({ id: String(request.id), request: updated, state: 'ready' });
      notify.success(`Request ${action}.`);
      load();
    } catch {
      setError('Failed to submit review. Please try again.');
      notify.error('Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function renderEmpty() {
    if (forbidden) {
      return <EmptyState kind="restricted" title="Approvals are for the Admin and the Department Head" description="Only they can decide requests. Ask the person who sent the request to follow it under Submitted by me." />;
    }

    if (filtersActive) {
      return <EmptyState kind="filtered" title="No requests match these filters" description="Try a different type, date range or search." onClearFilters={resetFilters} />;
    }

    if (tab === 'submitted') {
      if (statusFilter !== 'all') {
        const label = statusTabs.find((option) => option.value === statusFilter)?.label.toLowerCase();
        return <EmptyState kind="filtered" title={`No ${label} requests`} description="Nothing your organization submitted is in this state." onClearFilters={() => setStatusFilter('all')} />;
      }

      return (
        <EmptyState
          icon={Clock}
          title="Nothing submitted yet"
          description="Events, budgets, elections, announcements and reports your organization sends for approval are tracked here, with the stage each one is at and who it is waiting on."
          action={<Button variant="secondary" to={NEW_REQUEST_PATH}>Start a new request</Button>}
        />
      );
    }

    if (statusFilter === 'pending') {
      return <EmptyState icon={Clock} title="Nothing to review" description={REVIEW_EMPTY[role] ?? 'Requests sent to you for a decision appear here.'} />;
    }

    return <EmptyState icon={Clock} title="No approval history yet" description="Requests you approve or reject are listed here afterwards." />;
  }

  const headerPrimary = isAdmin || isOfficer ? <Button to={NEW_REQUEST_PATH} leftIcon={Plus}>New request</Button> : undefined;
  const listLabel = tab === 'submitted' ? 'Requests submitted by my organization' : 'Requests to review';

  return (
    <div className="space-y-6">
      <PageHeader primary={headerPrimary} />

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

      <div id="approvals-panel" role={isAdmin ? 'tabpanel' : undefined} aria-label={isAdmin ? listLabel : undefined} className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {statusTabs.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={statusFilter === option.value}
              onClick={() => { setStatusFilter(option.value); setPage(1); }}
              className={`h-11 rounded-lg px-4 text-[13px] font-bold transition-all ${
                statusFilter === option.value
                  ? 'bg-brand-700 text-white'
                  : 'border border-line bg-surface text-ink-muted-strong hover:bg-subtle'
              }`}
            >
              {option.value === 'pending' && tab === 'review' ? `Pending${pendingTotal ? ` (${pendingTotal})` : ''}` : option.label}
            </button>
          ))}
        </div>

        <section className="rounded-lg border border-[#DDE7EF] bg-white p-4 shadow-sm">
          <div className={`grid gap-3 md:grid-cols-2 ${isDepartmentHead ? 'xl:grid-cols-7' : 'xl:grid-cols-6'}`}>
            <label className="relative xl:col-span-2">
              <Search size={15} className="absolute left-3 top-3.5 text-slate-500" aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requester, ID, remarks..." aria-label="Search requests" className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]" />
            </label>
            <select aria-label="Request type" value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
              <option value="all">All request types</option>{Object.entries(ENTITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {isDepartmentHead && (
              <select aria-label="Organization" value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm">
                <option value="all">All organizations</option>{organizations.map((organization) => <option key={organization.id} value={String(organization.id)}>{organization.name}</option>)}
              </select>
            )}
            <DateTimeInput type="date" aria-label="Requested from" value={from} onChange={(event) => setFrom(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <DateTimeInput type="date" aria-label="Requested to" value={to} onChange={(event) => setTo(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <select aria-label="Sort order" value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-500">{meta.total} matching request{meta.total === 1 ? '' : 's'} · {pendingTotal} awaiting action</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={resetFilters}>Reset</Button>
              <Button variant="secondary" leftIcon={Download} onClick={handleExport} disabled={!meta.total || exporting}>{exporting ? 'Exporting...' : 'Export CSV'}</Button>
            </div>
          </div>
        </section>

        {error && (
          <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-4 text-center">
            <p className="text-sm font-semibold text-red-700">{error}</p>
          </div>
        )}

        <section className="rounded-lg border border-[#DDE7EF] bg-white shadow-sm">
          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : requests.length === 0 ? (
            renderEmpty()
          ) : (
            <ul aria-label={listLabel} className="divide-y divide-[#DDE7EF]">
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
        organizationName={organizationNames[modalState.request?.organization_id]}
        onCancel={() => setModalState({ open: false, request: null, action: null })}
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
        onApprove={(request) => setModalState({ open: true, request, action: 'approved' })}
        onReject={(request) => setModalState({ open: true, request, action: 'rejected' })}
      />
    </div>
  );
}
