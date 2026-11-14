import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, DataTable, EmptyState, PageHeader, Select } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import { MessageSquareWarning } from 'lucide-react';
import { getGrievances, updateGrievanceClassification, updateGrievanceStatus } from '../../../services/grievanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { relativeTime } from '../../../lib/format';
import notify from '../../../lib/notify';
import GrievanceDetailDrawer from './GrievanceDetailDrawer';
import { StatusCell, UrgencyCell } from './GrievanceCells';
import useGrievanceRecord from './useGrievanceRecord';

const STATUSES = ['submitted', 'under_review', 'resolved', 'dismissed'];
const URGENCIES = ['Critical', 'High', 'Medium', 'Low'];
// The three tiles are the queue that needs a person: new, in progress and most urgent.
const TILE_STATUSES = ['submitted', 'under_review'];
const TILE_URGENCIES = ['Critical'];
// The API reads a multi-value filter as a JSON list (App\Support\FilterValues), never a comma list.
const OPEN_STATUSES = JSON.stringify(TILE_STATUSES);

const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...STATUSES.map((value) => ({ value, label: value === 'under_review' ? 'Under review' : value[0].toUpperCase() + value.slice(1) }))];
const URGENCY_OPTIONS = [{ value: '', label: 'All urgencies' }, ...URGENCIES.map((value) => ({ value, label: value }))];
const UNAVAILABLE_COUNTS = { submitted: null, under_review: null, Critical: null };

export default function SaoGrievancesPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 50 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');
  const [sort, setSort] = useState({ key: 'urgency', direction: 'asc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { selected, open, close, replace } = useGrievanceRecord();
  const [counts, setCounts] = useState(UNAVAILABLE_COUNTS);
  const loadCounter = useRef(0);

  const filters = useMemo(() => ({
    status: status || undefined,
    urgency: urgency || undefined,
  }), [status, urgency]);

  const filtersActive = Boolean(status || urgency);

  const load = useCallback(() => {
    loadCounter.current += 1;
    const ticket = loadCounter.current;
    setLoading(true);
    setError(null);
    return getGrievances({ ...filters, sort: sort.key, direction: sort.direction, page, per_page: 50 })
      .then((res) => {
        if (ticket !== loadCounter.current) return;
        setRows(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => { if (ticket === loadCounter.current) setError('Failed to load grievances.'); })
      .finally(() => { if (ticket === loadCounter.current) setLoading(false); });
  }, [filters, page, sort]);

  useEffect(() => { load(); }, [load]);

  // A changed filter starts again from page one in the same update, so only one request goes out.
  function changeStatus(value) {
    setStatus(value);
    setPage(1);
  }

  function changeUrgency(value) {
    setUrgency(value);
    setPage(1);
  }

  // The tiles count the queue that needs a person, independent of the status and urgency selects
  // below (which narrow the table). There is no aggregate endpoint, so this is three lightweight
  // per_page=1 requests read for their `total` only.
  const loadCounts = useCallback(() => Promise.allSettled([
    ...TILE_STATUSES.map((value) => getGrievances({ status: value, per_page: 1 }).then((res) => [value, listMeta(res.data).total])),
    ...TILE_URGENCIES.map((value) => getGrievances({ urgency: value, status: OPEN_STATUSES, per_page: 1 }).then((res) => [value, listMeta(res.data).total])),
  ]).then((results) => setCounts({
    ...UNAVAILABLE_COUNTS,
    ...Object.fromEntries(results.filter((result) => result.status === 'fulfilled').map((result) => result.value)),
  })), []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  function changeSort(next) {
    setSort(next);
    setPage(1);
  }

  function clearFilters() {
    setStatus('');
    setUrgency('');
    setPage(1);
  }

  async function handleTransition(id, data) {
    const res = await updateGrievanceStatus(id, data);
    replace(res.data);
    notify.success('Grievance updated. The student has been notified.');
    load();
    loadCounts();
  }

  async function handleClassify(id, data) {
    const res = await updateGrievanceClassification(id, data);
    replace(res.data);
    notify.success('Classification corrected.');
    load();
    loadCounts();
  }

  function handleDeleted() {
    load();
    loadCounts();
  }

  const columns = [
    {
      key: 'title',
      header: 'Grievance',
      render: (row) => (
        <button type="button" onClick={() => open(row)} className="min-h-10 text-left font-medium text-ink hover:text-brand-700">
          {formatDisplayText(row.title)}
          <span className="block text-xs font-normal text-ink-muted">{row.category} · {row.organization_id ? (formatDisplayText(row.organization?.name) || 'Organization') : 'Student Affairs Office'}</span>
        </button>
      ),
    },
    { key: 'urgency', header: 'Urgency', sortable: true, render: (row) => <UrgencyCell urgency={row.urgency} /> },
    { key: 'status', header: 'Status', render: (row) => <StatusCell grievance={row} /> },
    {
      key: 'filer',
      header: 'Filed by',
      render: (row) => (
        <span className="text-ink-muted">
          {row.submitter ? `${formatDisplayText(row.submitter.first_name)} ${formatDisplayText(row.submitter.last_name)}` : `Student ${row.submitted_by}`}
          {row.is_anonymous && <span className="ml-1.5 text-ink-soft">(anonymous to org)</span>}
        </span>
      ),
    },
    { key: 'created_at', header: 'Filed', sortable: true, render: (row) => <span className="text-ink-muted">{relativeTime(row.created_at)}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader />

      <div className="grid grid-cols-3 gap-3">
        {TILE_STATUSES.map((value) => (
          <button key={value} type="button" onClick={() => changeStatus(status === value ? '' : value)} className={`min-h-11 rounded-card border p-3 text-left transition-colors duration-150 ${status === value ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:bg-subtle'}`}>
            <p className="text-xs font-medium text-ink-muted">{value === 'under_review' ? 'Under review' : value[0].toUpperCase() + value.slice(1)}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink" title={counts[value] === null ? 'Count unavailable' : undefined}>{counts[value] ?? '–'}</p>
          </button>
        ))}
        {TILE_URGENCIES.map((value) => (
          <button key={value} type="button" onClick={() => changeUrgency(urgency === value ? '' : value)} className={`min-h-11 rounded-card border p-3 text-left transition-colors duration-150 ${urgency === value ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:bg-subtle'}`}>
            <p className="text-xs font-medium text-ink-muted">{value}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink" title={counts[value] === null ? 'Count unavailable' : undefined}>{counts[value] ?? '–'}</p>
          </button>
        ))}
      </div>

      <Card bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={rows}
          caption="Grievances, most urgent first"
          loading={loading}
          error={error}
          onRetry={load}
          sort={sort}
          onSortChange={changeSort}
          filtersActive={filtersActive}
          filters={(
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
              <div className="w-40">
                <Select filter aria-label="Filter by status" value={status} onChange={(event) => changeStatus(event.target.value)}>
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              <div className="w-40">
                <Select filter aria-label="Filter by urgency" value={urgency} onChange={(event) => changeUrgency(event.target.value)}>
                  {URGENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="inline-flex min-h-10 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>
              )}
              {!error && <p className="w-full text-xs tabular-nums text-ink-muted sm:ml-auto sm:w-auto">{meta.total} {meta.total === 1 ? 'grievance' : 'grievances'}</p>}
            </div>
          )}
          emptyState={filtersActive ? (
            <EmptyState kind="filtered" title="No grievances match" onClearFilters={clearFilters} />
          ) : (
            <EmptyState
              kind="first-run"
              icon={MessageSquareWarning}
              title="No grievances to review"
              description="Grievances from students appear here."
            />
          )}
          pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="grievances" />}
        />
      </Card>

      <GrievanceDetailDrawer grievance={selected} viewerRole="SUPER_ADMIN" onClose={close} onTransition={handleTransition} onClassify={handleClassify} onDeleted={handleDeleted} />
    </div>
  );
}
