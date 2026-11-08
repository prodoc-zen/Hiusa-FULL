import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, DataTable, EmptyState, PageHeader, Select, StatusBadge } from '../../../components/ui';
import PaginationControls from '../../../components/PaginationControls';
import { MessageSquareWarning } from 'lucide-react';
import { getGrievances, updateGrievanceStatus } from '../../../services/grievanceService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { relativeTime } from '../../../lib/format';
import notify from '../../../lib/notify';
import GrievanceDetailDrawer from './GrievanceDetailDrawer';
import TableRowActions from '../../../components/TableRowActions';
import { grievanceStageText, grievanceStatusTone, urgencyTone } from './grievanceLabels';
import useGrievanceRecord from './useGrievanceRecord';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const URGENCY_OPTIONS = [
  { value: '', label: 'All urgencies' },
  { value: 'Critical', label: 'Critical' },
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
];

export default function OrganizationGrievancesPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { selected, open, close, replace } = useGrievanceRecord();

  const filters = useMemo(() => ({
    status: status || undefined,
    urgency: urgency || undefined,
  }), [status, urgency]);

  const filtersActive = Boolean(status || urgency);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getGrievances({ ...filters, page })
      .then((res) => {
        setRows(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => setError('Failed to load grievances addressed to your organization.'))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filters]);

  function clearFilters() {
    setStatus('');
    setUrgency('');
  }

  async function handleTransition(id, data) {
    const res = await updateGrievanceStatus(id, data);
    replace(res.data);
    notify.success('Grievance updated. The student has been notified.');
    load();
  }

  const columns = [
    {
      key: 'title',
      header: 'Grievance',
      render: (row) => (
        <button type="button" onClick={() => open(row)} className="text-left font-medium text-ink hover:text-brand-700">
          {formatDisplayText(row.title)}
          <span className="block text-xs font-normal text-ink-muted">{row.category}</span>
        </button>
      ),
    },
    { key: 'urgency', header: 'Urgency', render: (row) => <StatusBadge tone={urgencyTone(row.urgency)} label={row.urgency} /> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.status} tone={grievanceStatusTone(row.status)} />
          <span className="text-xs text-ink-muted-strong">{grievanceStageText(row)}</span>
        </div>
      ),
    },
    {
      key: 'filer',
      header: 'Filed by',
      render: (row) => ('submitted_by' in row
        ? <span className="text-ink-muted">{row.submitter ? `${formatDisplayText(row.submitter.first_name)} ${formatDisplayText(row.submitter.last_name)}` : `Student ${row.submitted_by}`}</span>
        : <StatusBadge tone="info" label="Confidential" />),
    },
    { key: 'created_at', header: 'Filed', render: (row) => <span className="text-ink-muted">{relativeTime(row.created_at)}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader />

      <Card bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={rows}
          actions={(row) => <TableRowActions subject={formatDisplayText(row.title)} actions={[{ label: 'View details', onClick: () => open(row) }]} />}
          loading={loading}
          error={error}
          onRetry={load}
          filtersActive={filtersActive}
          filters={(
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 sm:p-4">
              <div className="w-40">
                <Select filter aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              <div className="w-40">
                <Select filter aria-label="Filter by urgency" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
                  {URGENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </div>
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="inline-flex min-h-10 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear filters</button>
              )}
              <p className="w-full text-xs tabular-nums text-ink-muted sm:ml-auto sm:w-auto">{meta.total} {meta.total === 1 ? 'grievance' : 'grievances'}</p>
            </div>
          )}
          emptyState={filtersActive ? (
            <EmptyState kind="filtered" title="No grievances match" onClearFilters={clearFilters} />
          ) : (
            <EmptyState
              kind="first-run"
              icon={MessageSquareWarning}
              title="No grievances to review"
              description="Confidential grievances from your members appear here."
            />
          )}
          pagination={<PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="grievances" />}
        />
      </Card>

      <GrievanceDetailDrawer grievance={selected} viewerRole="ADMIN" onClose={close} onTransition={handleTransition} onDeleted={load} />
    </div>
  );
}
