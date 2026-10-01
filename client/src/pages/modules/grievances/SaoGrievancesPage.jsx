import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, DataTable, PageHeader, Select, StatusBadge } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import { getGrievances, updateGrievanceStatus } from '../../../services/grievanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { relativeTime } from '../../../lib/format';
import notify from '../../../lib/notify';
import GrievanceDetailDrawer from './GrievanceDetailDrawer';
import { CATEGORIES, grievanceStatusTone, urgencyRank, urgencyTone } from './grievanceLabels';

const STATUSES = ['submitted', 'under_review', 'resolved', 'dismissed'];
const URGENCIES = ['Critical', 'High', 'Medium', 'Low'];

const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...STATUSES.map((value) => ({ value, label: value === 'under_review' ? 'Under review' : value[0].toUpperCase() + value.slice(1) }))];
const URGENCY_OPTIONS = [{ value: '', label: 'All urgencies' }, ...URGENCIES.map((value) => ({ value, label: value }))];
const ADDRESSED_TO_OPTIONS = [
  { value: '', label: 'Organization + SAO' },
  { value: 'organization', label: 'Addressed to organizations' },
  { value: 'sao', label: 'Addressed to SAO' },
];

const EMPTY_COUNTS = { submitted: 0, under_review: 0, resolved: 0, dismissed: 0, Critical: 0, High: 0, Medium: 0, Low: 0 };

export default function SaoGrievancesPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 50 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');
  const [category, setCategory] = useState('');
  const [addressedTo, setAddressedTo] = useState('');
  const [sort, setSort] = useState({ key: 'urgency', direction: 'asc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [counts, setCounts] = useState(EMPTY_COUNTS);

  const filters = useMemo(() => ({
    status: status || undefined,
    urgency: urgency || undefined,
    category: category || undefined,
    addressed_to: addressedTo || undefined,
  }), [status, urgency, category, addressedTo]);

  const filtersActive = Boolean(status || urgency || category || addressedTo);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getGrievances({ ...filters, page, per_page: 50 })
      .then((res) => {
        setRows(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => setError('Failed to load grievances.'))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filters]);

  // The strip shows the full status/urgency distribution for the current
  // category + addressed_to scope, independent of the status/urgency selects
  // below (which narrow the table). There is no aggregate endpoint, so this
  // is eight lightweight per_page=1 requests read for their `total` only.
  useEffect(() => {
    const scope = { category: category || undefined, addressed_to: addressedTo || undefined };
    let cancelled = false;

    Promise.all([
      ...STATUSES.map((value) => getGrievances({ ...scope, status: value, per_page: 1 }).then((res) => [value, listMeta(res.data).total])),
      ...URGENCIES.map((value) => getGrievances({ ...scope, urgency: value, per_page: 1 }).then((res) => [value, listMeta(res.data).total])),
    ]).then((entries) => {
      if (!cancelled) setCounts({ ...EMPTY_COUNTS, ...Object.fromEntries(entries) });
    }).catch(() => { if (!cancelled) setCounts(EMPTY_COUNTS); });

    return () => { cancelled = true; };
  }, [category, addressedTo]);

  async function handleTransition(id, data) {
    const res = await updateGrievanceStatus(id, data);
    setSelected(res.data);
    notify.success('Grievance updated. The student has been notified.');
    load();
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort.key === 'urgency') {
        const diff = urgencyRank(a.urgency) - urgencyRank(b.urgency);
        return sort.direction === 'asc' ? diff : -diff;
      }
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sort.direction === 'asc' ? diff : -diff;
    });
    return copy;
  }, [rows, sort]);

  const columns = [
    {
      key: 'title',
      header: 'Grievance',
      render: (row) => (
        <button type="button" onClick={() => setSelected(row)} className="text-left font-bold text-ink hover:text-brand-700">
          {row.title}
          <span className="block text-xs font-medium text-ink-muted">{row.category} · {row.organization_id ? (row.organization?.name || 'Organization') : 'Student Affairs Office'}</span>
        </button>
      ),
    },
    { key: 'urgency', header: 'Urgency', sortable: true, render: (row) => <StatusBadge tone={urgencyTone(row.urgency)} label={row.urgency} /> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} tone={grievanceStatusTone(row.status)} /> },
    {
      key: 'filer',
      header: 'Filed by',
      render: (row) => (
        <span className="text-ink-muted">
          {row.submitter ? `${row.submitter.first_name} ${row.submitter.last_name}` : `Student ${row.submitted_by}`}
          {row.is_anonymous && <span className="ml-1.5 text-ink-soft">(anonymous to org)</span>}
        </span>
      ),
    },
    { key: 'created_at', header: 'Filed', sortable: true, render: (row) => <span className="text-ink-muted">{relativeTime(row.created_at)}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Grievances" description="Every confidential grievance university-wide, sorted by urgency first so what needs attention now is on top." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {STATUSES.map((value) => (
          <button key={value} type="button" onClick={() => setStatus(status === value ? '' : value)} className={`rounded-card border p-3 text-left transition-colors duration-150 ${status === value ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:bg-subtle'}`}>
            <p className="text-xs font-semibold text-ink-muted">{value === 'under_review' ? 'Under review' : value[0].toUpperCase() + value.slice(1)}</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{counts[value]}</p>
          </button>
        ))}
        {URGENCIES.map((value) => (
          <button key={value} type="button" onClick={() => setUrgency(urgency === value ? '' : value)} className={`rounded-card border p-3 text-left transition-colors duration-150 ${urgency === value ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:bg-subtle'}`}>
            <p className="text-xs font-semibold text-ink-muted">{value}</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{counts[value]}</p>
          </button>
        ))}
      </div>

      <Card bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={sortedRows}
          loading={loading}
          error={error}
          onRetry={load}
          sort={sort}
          onSortChange={setSort}
          filtersActive={filtersActive}
          filters={(
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
              <div className="w-44">
                <Select aria-label="Filter by addressed to" value={addressedTo} onChange={(event) => setAddressedTo(event.target.value)}>
                  {ADDRESSED_TO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              <div className="w-40">
                <Select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              <div className="w-40">
                <Select aria-label="Filter by urgency" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
                  {URGENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              <div className="w-48">
                <Select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">All categories</option>
                  {CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
                </Select>
              </div>
              {filtersActive && (
                <button type="button" onClick={() => { setStatus(''); setUrgency(''); setCategory(''); setAddressedTo(''); }} className="ml-auto text-xs font-bold text-brand-700 hover:text-navy-800">Clear filters</button>
              )}
              <p className="w-full text-xs font-semibold tabular-nums text-ink-muted sm:ml-auto sm:w-auto">{meta.total} {meta.total === 1 ? 'grievance' : 'grievances'}</p>
            </div>
          )}
          emptyState={filtersActive ? undefined : (
            <div className="px-6 py-14 text-center">
              <p className="text-lg font-bold text-ink">No grievances yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm font-medium text-ink-muted">Grievances filed anywhere in the university, whether anonymous or not, will appear here.</p>
            </div>
          )}
          pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="grievances" />}
        />
      </Card>

      <GrievanceDetailDrawer grievance={selected} viewerRole="SUPER_ADMIN" onClose={() => setSelected(null)} onTransition={handleTransition} />
    </div>
  );
}
