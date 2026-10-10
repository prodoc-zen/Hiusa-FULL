import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, FlowStepper, Input, NextStep, PageHeader, Select } from '../../../components/ui';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getClearancePeriods, getClearanceSignatures, updateClearanceSignature } from '../../../services/clearanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import notify from '../../../lib/notify';
import { clearanceLifecycle, toNextStepProps } from '../../../lib/lifecycle';
import useRecordParam from '../../../lib/useRecordParam';
import SignAction from './SignAction';
import { clearanceStageText, humanizeRole } from './clearanceLabels';

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
      <FlowStepper steps={stage.steps} ariaLabel="Clearance signature" />
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
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    getClearancePeriods({ per_page: 100 }).then((res) => setPeriods(unwrapList(res.data))).catch(() => setPeriods([]));
  }, []);

  const filters = useMemo(() => ({
    clearance_period_id: periodId || undefined,
    status: status || undefined,
  }), [periodId, status]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getClearanceSignatures({ ...filters, page })
      .then((res) => {
        setRows(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => setError('Failed to load your clearance signing queue.'))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [filters]);

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
    try {
      await Promise.all(Array.from(selectedIds).map((id) => updateClearanceSignature(id, { status: 'cleared' })));
      notify.success(`Cleared ${selectedIds.size} signature${selectedIds.size === 1 ? '' : 's'}.`);
      setSelectedIds(new Set());
      setBulkOpen(false);
      load();
    } catch {
      notify.error('Some signatures could not be cleared. Please review the queue and try again.');
    } finally {
      setBulkBusy(false);
    }
  }

  const columns = [
    {
      key: 'student',
      header: 'Student',
      render: (row) => (
        <div>
          <button type="button" onClick={() => { setPinned(row); setRecordId(row.id); }} className="text-left font-bold text-ink hover:text-brand-700">{studentName(row)}</button>
          <p className="text-xs font-medium text-ink-muted">{row.student_id}</p>
        </div>
      ),
    },
    { key: 'required_role', header: 'Role', render: (row) => humanizeRole(row.required_role) },
    { key: 'period', header: 'Period', render: (row) => row.clearancePeriod?.title || '-' },
    { key: 'stage', header: 'Stage', render: (row) => <span className="text-xs font-semibold text-ink-muted-strong">{clearanceStageText({ signatures: [row] })}</span> },
  ];

  async function sign(row, nextStatus, remarks) {
    await updateClearanceSignature(row.id, { status: nextStatus, remarks });
    notify.success(nextStatus === 'cleared' ? 'Signature cleared.' : 'Signature put on hold.');
    load();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader />

      <Card bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={visibleRows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={load}
          filtersActive={Boolean(periodId || status || search)}
          actions={(row) => (
            <div className="flex items-center justify-end gap-2">
              {row.status === 'pending' && (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.student ? `${formatDisplayText(row.student.first_name)} ${formatDisplayText(row.student.last_name)}` : row.student_id} for bulk clear`}
                  checked={selectedIds.has(row.id)}
                  onChange={() => toggleRow(row.id)}
                  className="h-4 w-4 accent-brand-700"
                />
              )}
              <SignAction
                signatureId={row.id}
                status={row.status}
                remarks={row.remarks}
                roleLabel={humanizeRole(row.required_role)}
                onSign={(nextStatus, remarks) => sign(row, nextStatus, remarks)}
              />
            </div>
          )}
          filters={(
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
              <div className="min-w-[180px] flex-1 sm:flex-none sm:w-56">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or school ID..." aria-label="Search students on this page" />
              </div>
              <div className="w-48">
                <Select aria-label="Filter by clearance period" value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
                  <option value="">All periods</option>
                  {periods.map((period) => <option key={period.id} value={period.id}>{formatDisplayText(period.title)}</option>)}
                </Select>
              </div>
              <div className="w-40">
                <Select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              {selectablePendingIds.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-xs font-bold text-brand-700 hover:text-navy-800">
                  {allSelected ? 'Clear selection' : `Select all pending (${selectablePendingIds.length})`}
                </button>
              )}
              {selectedIds.size > 0 && (
                <Button size="sm" onClick={() => setBulkOpen(true)}>Clear {selectedIds.size} selected</Button>
              )}
              <p className="w-full text-xs font-semibold tabular-nums text-ink-muted sm:ml-auto sm:w-auto">{meta.total} in queue{search ? ' · search applies to this page' : ''}</p>
            </div>
          )}
          emptyState={periodId || status || search ? (
            <EmptyState kind="filtered" title="No signatures match these filters" description="Try another period or status, or clear the filters." onClearFilters={() => { setPeriodId(''); setStatus(''); setSearch(''); }} />
          ) : (
            <EmptyState
              kind="first-run"
              icon={ClipboardCheck}
              title="Nothing waiting on your signature"
              description="The SAO opens a clearance period each semester. Once it does, your organization's students who need your signature show up here."
            />
          )}
          pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="signatures" />}
        />
      </Card>

      <Drawer open={Boolean(selected)} title={selected ? studentName(selected) : undefined} description={selected ? `${selected.clearancePeriod?.title || 'Clearance'} · ${humanizeRole(selected.required_role)}` : undefined} onClose={() => setRecordId(null)}>
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
