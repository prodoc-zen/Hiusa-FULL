import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, FlowStepper, Input, NextStep, PageHeader, Select, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getClearancePeriods, getClearanceSignatures, updateClearanceSignature } from '../../../services/clearanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import notify from '../../../lib/notify';
import { clearanceLifecycle, toNextStepProps } from '../../../lib/lifecycle';
import useRecordParam from '../../../lib/useRecordParam';
import SignAction from './SignAction';
import { clearanceStatusTone, humanizeRole } from './clearanceLabels';

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

function studentName(row) {
  return row.student ? `${formatDisplayText(row.student.first_name)} ${formatDisplayText(row.student.last_name)}` : `Student ${row.student_id}`;
}

function periodTitle(row) {
  return formatDisplayText(row.clearance_period?.title || row.clearancePeriod?.title || '');
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'held', label: 'Held' },
  { value: 'cleared', label: 'Cleared' },
];

// The callout names the stage and who owns it; the buttons that do the work are SignAction's, below it.
function SignatureDetail({ row, role, onSign }) {
  const stage = clearanceLifecycle({ signatures: [row] }, role);
  const next = { ...toNextStepProps(stage), primary: undefined };

  return (
    <div className="flex flex-col gap-4">
      <FlowStepper variant="full" steps={stage.steps} ariaLabel="Clearance signature" />
      <NextStep {...next} />
      <SignAction signatureId={row.id} status={row.status} remarks={row.remarks} roleLabel={humanizeRole(row.required_role)} onSign={onSign} />
    </div>
  );
}

export default function SignatoryClearancesPage() {
  const role = useMemo(() => getCurrentRole(), []);
  const [recordId, setRecordId] = useRecordParam();
  const [pinned, setPinned] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const loadCounter = useRef(0);

  useEffect(() => {
    getClearancePeriods({ per_page: 100 }).then((res) => setPeriods(unwrapList(res.data))).catch(() => setPeriods([]));
  }, []);

  const filters = useMemo(() => ({
    clearance_period_id: periodId || undefined,
    status: status || undefined,
    q: searchQuery || undefined,
  }), [periodId, status, searchQuery]);

  const load = useCallback(() => {
    loadCounter.current += 1;
    const ticket = loadCounter.current;
    setLoading(true);
    setError(null);
    return getClearanceSignatures({ ...filters, page })
      .then((res) => {
        if (ticket !== loadCounter.current) return;
        const fresh = unwrapList(res.data);
        setRows(fresh);
        setMeta(listMeta(res.data));
        // A line someone else already acted on is no longer selectable.
        setSelectedIds((current) => (current.size === 0 ? current : new Set(fresh.filter((row) => row.status === 'pending' && current.has(row.id)).map((row) => row.id))));
      })
      .catch(() => { if (ticket === loadCounter.current) setError('Failed to load your clearance signing queue.'); })
      .finally(() => { if (ticket === loadCounter.current) setLoading(false); });
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  // A changed filter starts again from page one in the same update, so only one request goes out.
  function changeFilter(setter) {
    return (event) => {
      setter(event.target.value);
      setPage(1);
      setSelectedIds(new Set());
    };
  }

  function clearFilters() {
    setPeriodId('');
    setStatus('');
    setSearch('');
    setSearchQuery('');
    setPage(1);
    setSelectedIds(new Set());
  }

  useEffect(() => {
    const term = search.trim();
    if (term === searchQuery) return undefined;
    const timer = setTimeout(() => {
      setSearchQuery(term);
      setPage(1);
      setSelectedIds(new Set());
    }, 250);
    return () => clearTimeout(timer);
  }, [search, searchQuery]);

  const found = recordId ? rows.find((row) => String(row.id) === recordId) : null;
  const selected = recordId ? (found ?? (pinned && String(pinned.id) === recordId ? pinned : null)) : null;

  useEffect(() => {
    if (found) setPinned(found);
  }, [found]);

  // A deep link can name a signature on a later page, so walk the pages until it turns up.
  useEffect(() => {
    if (!recordId || selected || loading || error) return;
    if (page < meta.lastPage) {
      setPage(page + 1);
      return;
    }
    notify.error('That signature is not in your signing queue.');
    setRecordId(null);
  }, [recordId, selected, loading, error, page, meta.lastPage, setRecordId]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => `${row.student?.first_name || ''} ${row.student?.last_name || ''} ${row.student_id}`.toLowerCase().includes(term));
  }, [rows, search]);

  const selectablePendingIds = visibleRows.filter((row) => row.status === 'pending').map((row) => row.id);
  const allSelected = selectablePendingIds.length > 0 && selectablePendingIds.every((id) => selectedIds.has(id));

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectablePendingIds));
  }

  function toggleRow(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirmBulkClear() {
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => updateClearanceSignature(id, { status: 'cleared' })));
    const failed = results.map((result, index) => ({ result, id: ids[index] })).filter(({ result }) => result.status === 'rejected');
    const clearedCount = ids.length - failed.length;
    if (failed.length === 0) {
      notify.success(`Cleared ${clearedCount} signature${clearedCount === 1 ? '' : 's'}.`);
    } else {
      const reason = failed[0].result.reason?.response?.data?.message;
      notify.error(`Cleared ${clearedCount} of ${ids.length} signatures. ${failed.length} could not be cleared${reason ? `: ${reason}` : '.'} The queue is up to date, so you can try the rest again.`);
    }
    setSelectedIds(new Set(failed.map(({ id }) => id)));
    setBulkOpen(false);
    setBulkBusy(false);
    load();
  }

  // One period and one role usually cover the whole queue, so those columns appear only when they tell rows apart.
  const periodTitles = [...new Set(visibleRows.map((row) => periodTitle(row)).filter(Boolean))];
  const showPeriod = periodTitles.length > 1;
  const showRole = new Set(visibleRows.map((row) => row.required_role)).size > 1;

  const columns = [
    {
      key: 'student',
      header: 'Student',
      className: 'whitespace-nowrap',
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.status === 'pending' ? (
            <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
              <input type="checkbox" aria-label={`Select ${studentName(row)} for bulk clear`} checked={selectedIds.has(row.id)} onChange={() => toggleRow(row.id)} className="h-4 w-4 accent-brand-700" />
            </label>
          ) : selectablePendingIds.length > 0 && <span aria-hidden="true" className="hidden h-11 w-11 shrink-0 md:block" />}
          <div className="text-left">
            <button type="button" onClick={() => { setPinned(row); setRecordId(row.id); }} className="font-medium text-ink hover:text-brand-700">{studentName(row)}</button>
            <p className="text-xs text-ink-muted">{row.student_id}</p>
          </div>
        </div>
      ),
    },
    ...(showRole ? [{ key: 'required_role', header: 'Role', render: (row) => humanizeRole(row.required_role) }] : []),
    ...(showPeriod ? [{ key: 'period', header: 'Period', render: (row) => periodTitle(row) }] : []),
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          {row.status !== 'pending' && <StatusBadge status={row.status} tone={clearanceStatusTone(row.status)} />}
          {(row.remarks || row.status === 'pending') && (
            <p className={`text-xs ${row.status === 'held' ? 'text-ink' : 'text-ink-muted'}`}>{row.remarks || `Waiting for ${humanizeRole(row.required_role)} signature`}</p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end">
          <SignAction
            showStatus={false}
            signatureId={row.id}
            status={row.status}
            remarks={row.remarks}
            roleLabel={humanizeRole(row.required_role)}
            onSign={(nextStatus, remarks) => sign(row, nextStatus, remarks)}
          />
        </div>
      ),
    },
  ];

  async function sign(row, nextStatus, remarks) {
    await updateClearanceSignature(row.id, { status: nextStatus, remarks });
    setPinned({ ...row, status: nextStatus, remarks: remarks || null });
    notify.success(nextStatus === 'cleared' ? 'Signature cleared.' : nextStatus === 'pending' ? 'Clearance reopened.' : 'Signature put on hold.');
    load();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader />

      <Card bodyClassName="p-0">
        <DataTable
          caption="Clearance signatures to sign"
          columns={columns}
          rows={visibleRows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={load}
          filtersActive={Boolean(periodId || status || search)}
          filters={(
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
              <div className="w-full sm:w-56">
                <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or school ID" aria-label="Search students" />
              </div>
              <div className="w-full sm:w-48">
                <Select filter aria-label="Filter by clearance period" value={periodId} onChange={changeFilter(setPeriodId)}>
                  <option value="">All periods</option>
                  {periods.map((period) => <option key={period.id} value={period.id}>{formatDisplayText(period.title)}</option>)}
                </Select>
              </div>
              <div className="w-full sm:w-40">
                <Select filter aria-label="Filter by status" value={status} onChange={changeFilter(setStatus)}>
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              {(periodId || status || search) && (
                <button type="button" onClick={clearFilters} className="inline-flex min-h-[42px] items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>
              )}
              {selectablePendingIds.length > 0 && (
                <label className="inline-flex min-h-[42px] items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-brand-700" />
                  Select all pending ({selectablePendingIds.length})
                </label>
              )}
              {selectedIds.size > 0 && (
                <Button size="sm" onClick={() => setBulkOpen(true)}>Clear {selectedIds.size} selected</Button>
              )}
              <p className="w-full text-xs tabular-nums text-ink-muted sm:ml-auto sm:w-auto">{meta.total} in queue{!showPeriod && periodTitles[0] ? ` for ${periodTitles[0]}` : ''}</p>
            </div>
          )}
          emptyState={periodId || status || search ? (
            <EmptyState kind="filtered" title="No signatures match these filters" description="Try another period or status, or clear the filters." onClearFilters={clearFilters} />
          ) : (
            <EmptyState
              kind="first-run"
              icon={ClipboardCheck}
              title="Nothing waiting on your signature"
              description={role === 'DEPARTMENT_HEAD' ? 'The SAO opens a clearance period each semester, and students from your college appear here.' : 'The SAO opens a clearance period each semester, and students who need your signature appear here.'}
            />
          )}
          pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="signatures" />}
        />
      </Card>

      <Drawer open={Boolean(selected)} title={selected ? studentName(selected) : undefined} description={selected ? `${periodTitle(selected) || 'Clearance'} · ${humanizeRole(selected.required_role)}` : undefined} onClose={() => setRecordId(null)}>
        {selected && <SignatureDetail row={selected} role={role} onSign={(nextStatus, remarks) => sign(selected, nextStatus, remarks)} />}
      </Drawer>

      <Modal
        open={bulkOpen}
        title="Clear selected signatures"
        description={`Clear ${selectedIds.size} pending signature${selectedIds.size === 1 ? '' : 's'}? Every student affected will be notified.`}
        onClose={bulkBusy ? undefined : () => setBulkOpen(false)}
        maxWidth="max-w-md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>Cancel</Button>
            <Button onClick={confirmBulkClear} loading={bulkBusy}>Clear selected</Button>
          </>
        )}
      />
    </div>
  );
}
