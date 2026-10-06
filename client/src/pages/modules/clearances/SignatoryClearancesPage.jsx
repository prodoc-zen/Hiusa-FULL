import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Card, DataTable, Input, PageHeader, Select } from '../../../components/ui';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { getClearancePeriods, getClearanceSignatures, updateClearanceSignature } from '../../../services/clearanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import notify from '../../../lib/notify';
import SignAction from './SignAction';
import { humanizeRole } from './clearanceLabels';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'held', label: 'Held' },
  { value: 'cleared', label: 'Cleared' },
];

export default function SignatoryClearancesPage() {
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
          <p className="font-bold text-ink">{row.student ? `${formatDisplayText(row.student.first_name)} ${formatDisplayText(row.student.last_name)}` : `Student ${row.student_id}`}</p>
          <p className="text-xs font-medium text-ink-muted">{row.student_id}</p>
        </div>
      ),
    },
    { key: 'required_role', header: 'Role', render: (row) => humanizeRole(row.required_role) },
    { key: 'period', header: 'Period', render: (row) => row.clearancePeriod?.title || '-' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Clearance signing queue" description="Sign, hold, or clear a hold for your organization's students." />

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
                onSign={async (nextStatus, remarks) => {
                  await updateClearanceSignature(row.id, { status: nextStatus, remarks });
                  notify.success(nextStatus === 'cleared' ? 'Signature cleared.' : 'Signature put on hold.');
                  load();
                }}
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
          emptyState={(
            <div className="px-6 py-14 text-center">
              <ClipboardCheck size={34} strokeWidth={1.75} className="mx-auto text-brand-600" aria-hidden="true" />
              <p className="mt-3 text-lg font-bold text-ink">Nothing waiting on your signature</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm font-medium text-ink-muted">Once a clearance period opens, your organization's students needing your signature will show up here.</p>
            </div>
          )}
          pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="signatures" />}
        />
      </Card>

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
