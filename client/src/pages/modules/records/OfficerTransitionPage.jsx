import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmModal from '../../../components/ConfirmModal';
import Modal from '../../../components/Modal';
import { Button, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonTable, StatusBadge, Tabs, Textarea } from '../../../components/ui';
import { acknowledgeHandover, getHandover, getOfficers, getRenewalTracker, prepareHandover } from '../../../services/officerTransitionService';
import { getStoredRole } from '../../../lib/pageMeta';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDateTime } from '../../../utils/dateTime';
import { manilaDate } from '../../../lib/format';
import { openFileErrorMessage } from '../../../utils/openFileError';
import { openProtectedFile } from '../../../utils/openProtectedFile';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';
const LINK = 'min-h-10 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800';
const FILE_INPUT = 'block w-full text-sm text-ink file:mr-3 file:h-10 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle';

const TABS = [
  { key: 'officers', label: 'Officers' },
  { key: 'handover', label: 'Handover' },
  { key: 'renewal', label: 'Renewal' },
];

const OFFICER_STATUS = {
  upcoming: { label: 'Upcoming', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  ended: { label: 'Former', tone: 'neutral' },
};

const SIDE_LABELS = { incoming: 'Incoming', outgoing: 'Outgoing' };

const FLAG_LINES = {
  missing_deadline: 'No renewal deadline in Compliance yet',
  start_passed: 'Start date had already passed when the results became final',
};

const HANDOVER_LABELS = {
  finance: 'Finance',
  events: 'Events',
  tasks: 'Tasks',
  organization: 'Organization',
  election: 'Election',
  compliance: 'Compliance',
};

const HANDOVER_STATUS = {
  pending: { label: 'Pending', tone: 'warning' },
  prepared: { label: 'Prepared', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  acknowledged: { label: 'Acknowledged', tone: 'success' },
};

const ACKNOWLEDGE_TEXT = 'This confirms you received it. It does not certify that the information is correct or audited.';

// Each role reaches Compliance through its own route. An officer has none, so no link is shown.
const COMPLIANCE_PATH = {
  ADMIN: '/dashboard/compliance',
  DEPARTMENT_HEAD: '/dashboard/department-head/compliance',
  SUPER_ADMIN: '/dashboard/super-admin/compliance',
};

const EMPTY_FILTERS = { academic_year: '', position: '', status: '' };

function dayText(value) {
  return value ? manilaDate(value) : 'Not set';
}

function OfficersTab() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  // Typing waits a moment before it asks the server; Clear applies at once.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = { academic_year: filters.academic_year.trim(), position: filters.position.trim(), status: filters.status };
      setApplied((current) => (
        current.academic_year === next.academic_year && current.position === next.position && current.status === next.status ? current : next
      ));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    const params = Object.fromEntries(Object.entries(applied).filter(([, value]) => value));
    if (page > 1) params.page = page;

    async function run() {
      setLoading(true);
      setLoadError('');
      try {
        const next = await getOfficers(params);
        if (!cancelled) setResult(next);
      } catch {
        if (!cancelled) {
          setResult(null);
          setLoadError('Officers did not load.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [applied, page, retryKey]);

  const rows = Array.isArray(result?.data) ? result.data : [];
  const lastPage = Number(result?.last_page) || 1;
  const filtersActive = Boolean(filters.academic_year || filters.position || filters.status);

  const change = (key) => (event) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: event.target.value }));
  };

  const clear = () => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const columns = [
    { key: 'name', header: 'Name', render: (officer) => <span className="font-medium">{officer.name}</span> },
    { key: 'school_id', header: 'School ID', render: (officer) => officer.school_id },
    {
      key: 'position_title',
      header: 'Position',
      render: (officer) => (
        <div className="text-left">
          <span>{officer.position_title}</span>
          {SIDE_LABELS[officer.kind] && <span className="block text-xs text-ink-muted">{SIDE_LABELS[officer.kind]}</span>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (officer) => (officer.is_executive ? 'Executive' : 'Non-executive') },
    { key: 'academic_year', header: 'Academic year', render: (officer) => officer.academic_year || 'Not set' },
    { key: 'term_starts_on', header: 'Term start', render: (officer) => dayText(officer.term_starts_on) },
    { key: 'term_ends_on', header: 'Term end', render: (officer) => dayText(officer.term_ends_on) },
    {
      key: 'status',
      header: 'Status',
      render: (officer) => {
        const status = OFFICER_STATUS[officer.status] || { label: officer.status, tone: 'neutral' };
        return (
          <div className="text-left">
            <StatusBadge label={status.label} tone={status.tone} />
            {FLAG_LINES[officer.flag] && <p className="mt-1 max-w-prose text-xs text-ink-muted-strong">{FLAG_LINES[officer.flag]}</p>}
          </div>
        );
      },
    },
    { key: 'election', header: 'Election', render: (officer) => officer.election?.title || 'Not recorded' },
  ];

  const filterBar = (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="Academic year" className="w-full sm:w-48">
        <Input value={filters.academic_year} onChange={change('academic_year')} placeholder="2027-2028" maxLength={20} />
      </Field>
      <Field label="Position" className="w-full sm:w-56">
        <Input value={filters.position} onChange={change('position')} maxLength={100} />
      </Field>
      <Field label="Status" className="w-full sm:w-48">
        <Select value={filters.status} onChange={change('status')}>
          <option value="">All</option>
          {Object.entries(OFFICER_STATUS).map(([key, status]) => <option key={key} value={key}>{status.label}</option>)}
        </Select>
      </Field>
      {filtersActive && <button type="button" onClick={clear} className={LINK}>Clear</button>}
    </div>
  );

  return (
    <DataTable
      caption="Officers"
      columns={columns}
      rows={rows}
      pageSize={0}
      loading={loading && !result}
      error={loadError || null}
      onRetry={() => setRetryKey((key) => key + 1)}
      filters={filterBar}
      filtersActive={filtersActive}
      onClearFilters={clear}
      emptyState={filtersActive
        ? <EmptyState kind="filtered" title="No officers match" description="Change or clear the filters to see more." onClearFilters={clear} />
        : <EmptyState title="No officers yet" description="Winners of an election appear here as upcoming officers." />}
      pagination={lastPage > 1 ? (
        <nav className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft pt-3" aria-label="Pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button>
        </nav>
      ) : undefined}
    />
  );
}

function PrepareModal({ item, onClose, onSaved }) {
  const [remarks, setRemarks] = useState(item.remarks || '');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await prepareHandover(item.id, { remarks: remarks.trim(), reference_url: item.reference_url, attachmentFile });
      await onSaved();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Unable to save this item.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Prepare ${item.label || HANDOVER_LABELS[item.category]}`}
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={false}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save as prepared</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="Remarks" hint="Tell the incoming officers what to know.">
          <Textarea rows={4} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
        </Field>
        <Field label="Attachment (optional)">
          <input type="file" className={FILE_INPUT} onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)} />
        </Field>
        {error && <p role="alert" className={ALERT}>{error}</p>}
      </div>
    </Modal>
  );
}

function HandoverTab({ role }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [preparing, setPreparing] = useState(null);
  const [acknowledging, setAcknowledging] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');

  const load = useCallback(async () => {
    setData(await getHandover());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadError('');
      try {
        const next = await getHandover();
        if (!cancelled) setData(next);
      } catch {
        if (!cancelled) setLoadError('The handover did not load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  if (loading) return <SkeletonTable columns={3} rows={4} />;
  if (loadError) return <ErrorState description={loadError} onRetry={() => setRetryKey((key) => key + 1)} />;

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return <p className="text-sm text-ink-muted-strong">No transition is under way.</p>;

  // The Department Head and the SAO only look on, whatever side the server reports.
  const side = ['ADMIN', 'SBO_OFFICER'].includes(role) ? data?.my_side : null;

  const openFile = async (url) => {
    setFileError('');
    try {
      await openProtectedFile(url);
    } catch (openError) {
      setFileError(openFileErrorMessage(openError));
    }
  };

  const acknowledge = async () => {
    if (!acknowledging) return;
    setBusy(true);
    setError('');
    try {
      await acknowledgeHandover(acknowledging.id);
      setAcknowledging(null);
      await load();
    } catch (ackError) {
      setError(getApiErrorMessage(ackError, 'Unable to record this.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {fileError && <p role="alert" className={ALERT}>{fileError}</p>}
      <ul aria-label="Handover items" className="divide-y divide-line-soft rounded-card border border-line bg-surface">
        {items.map((item) => {
          const status = HANDOVER_STATUS[item.status] || { label: item.status, tone: 'neutral' };
          const done = item.status === 'acknowledged';
          return (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink">{item.label || HANDOVER_LABELS[item.category] || item.category}</h3>
                  <StatusBadge label={status.label} tone={status.tone} />
                </div>
                {item.remarks && <p className="max-w-prose break-words text-sm text-ink-muted-strong">{item.remarks}</p>}
                {item.prepared_by && <p className="text-xs text-ink-muted">Prepared by {item.prepared_by} on {formatDateTime(item.prepared_at)}</p>}
                {done && <p className="text-xs text-ink-muted">Acknowledged by {item.acknowledged_by} on {formatDateTime(item.acknowledged_at)}</p>}
                <div className="flex flex-wrap items-center gap-x-4">
                  {item.reference_url && <Link to={item.reference_url} className={`${LINK} leading-10`}>Open records</Link>}
                  {item.attachment_open_url && (
                    <button type="button" className={LINK} onClick={() => openFile(item.attachment_open_url)}>
                      {item.attachment_name || 'Attachment'}
                    </button>
                  )}
                </div>
              </div>
              {!done && side === 'outgoing' && <Button variant="secondary" size="sm" onClick={() => setPreparing(item)}>Prepare</Button>}
              {!done && side === 'incoming' && ['prepared', 'under_review'].includes(item.status) && (
                <Button size="sm" onClick={() => { setError(''); setAcknowledging(item); }}>Acknowledge receipt</Button>
              )}
            </li>
          );
        })}
      </ul>

      {preparing && (
        <PrepareModal
          item={preparing}
          onClose={() => setPreparing(null)}
          onSaved={async () => {
            setPreparing(null);
            await load();
          }}
        />
      )}

      <ConfirmModal
        open={Boolean(acknowledging)}
        title="Acknowledge receipt"
        message={ACKNOWLEDGE_TEXT}
        confirmText="Acknowledge receipt"
        variant="primary"
        busy={busy}
        error={error}
        onCancel={() => { if (!busy) setAcknowledging(null); }}
        onConfirm={acknowledge}
      />
    </div>
  );
}

function RenewalTab({ role }) {
  const [tracker, setTracker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadError('');
      try {
        const next = await getRenewalTracker();
        if (!cancelled) setTracker(next);
      } catch {
        if (!cancelled) setLoadError('The renewal tracker did not load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const compliancePath = COMPLIANCE_PATH[role];
  const requirements = useMemo(() => (Array.isArray(tracker?.requirements) ? tracker.requirements : []), [tracker]);

  if (loading) return <SkeletonTable columns={3} rows={4} />;
  if (loadError) return <ErrorState description={loadError} onRetry={() => setRetryKey((key) => key + 1)} />;

  const progress = tracker?.progress || { done: 0, total: requirements.length };
  const officers = Array.isArray(tracker?.assigned_officers) ? tracker.assigned_officers : [];

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-ink-muted">Official renewal deadline</p>
        <p className="text-sm font-semibold text-ink">{tracker?.deadline_at ? formatDateTime(tracker.deadline_at) : 'No renewal deadline in Compliance yet'}</p>
        {compliancePath && <Link to={compliancePath} className={LINK}>Set in Compliance</Link>}
      </div>

      <p className="text-sm text-ink">{progress.done} of {progress.total} requirements submitted</p>

      {requirements.length > 0 && (
        <ul aria-label="Renewal requirements" className="divide-y divide-line-soft rounded-card border border-line bg-surface">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-ink">{requirement.name}</p>
                {requirement.description && <p className="mt-0.5 break-words text-xs text-ink-muted">{requirement.description}</p>}
                <p className="mt-0.5 text-xs text-ink-muted">
                  {requirement.deadline_at ? `Due ${formatDateTime(requirement.deadline_at)}` : 'No due date'}
                  {requirement.submitted_at ? `. Submitted ${formatDateTime(requirement.submitted_at)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {requirement.overdue ? <StatusBadge status="overdue" /> : <StatusBadge status={requirement.status} />}
                {compliancePath && <Link to={compliancePath} className={LINK}>Open in Compliance</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {officers.length > 0 && (
        <section aria-label="Assigned officers">
          <h3 className="text-sm font-semibold text-ink">Assigned officers</h3>
          <ul className="mt-1">
            {officers.map((officer) => {
              const status = OFFICER_STATUS[officer.status] || { label: officer.status, tone: 'neutral' };
              return (
                <li key={`${officer.name}-${officer.position_title}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 text-sm last:border-b-0">
                  <span className="text-ink">{officer.name}<span className="text-ink-muted">, {officer.position_title}</span></span>
                  <StatusBadge label={status.label} tone={status.tone} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tracker?.last_updated && <p className="text-xs text-ink-muted">Last updated {formatDateTime(tracker.last_updated)}</p>}
    </div>
  );
}

export default function OfficerTransitionPage({ role = getStoredRole() }) {
  const [tab, setTab] = useState('officers');

  return (
    <div className="space-y-6">
      <PageHeader title="Officer transition" />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div role="tabpanel">
        {tab === 'officers' && <OfficersTab />}
        {tab === 'handover' && <HandoverTab role={role} />}
        {tab === 'renewal' && <RenewalTab role={role} />}
      </div>
    </div>
  );
}
