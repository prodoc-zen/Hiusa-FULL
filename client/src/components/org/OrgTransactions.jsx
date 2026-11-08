import { useCallback, useEffect, useState } from 'react';
import PaginationControls from '../PaginationControls';
import { Card, DataTable, EmptyState, SegmentedControl, Stat, StatusBadge } from '../ui';
import { manilaDate, peso } from '../../lib/format';
import { getOrganizationTransactions } from '../../services/orgSpaceService';
import { getApiErrorMessage } from '../../utils/apiError';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

const COLUMNS = [
  { key: 'transaction_date', header: 'Date', render: (row) => <span className="whitespace-nowrap">{manilaDate(row.transaction_date)}</span> },
  { key: 'description', header: 'Description', render: (row) => <span className="block min-w-0 break-words font-bold">{row.description || 'No description'}{row.budget_title && <span className="block text-xs font-medium text-ink-muted">{row.budget_title}</span>}</span> },
  { key: 'category', header: 'Category', render: (row) => <span className="capitalize">{row.category || 'None'}</span> },
  { key: 'type', header: 'Type', render: (row) => <StatusBadge status={row.type} /> },
  { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="font-bold tabular-nums">{peso(row.amount)}</span> },
  { key: 'recorded_by', header: 'Recorded by', render: (row) => row.recorded_by || 'Unknown' },
];

export default function OrgTransactions({ organizationId }) {
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getOrganizationTransactions(organizationId, { page, ...(type === 'all' ? {} : { type }) });
      setResult(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Could not load the transactions. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, page, type]);

  useEffect(() => { load(); }, [load]);

  function changeType(next) {
    setType(next);
    setPage(1);
  }

  const meta = result?.meta;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <Stat label="Total income" value={result ? peso(result.summary.income) : '...'} />
        <Stat label="Total expenses" value={result ? peso(result.summary.expense) : '...'} />
      </div>
      <Card
        title="Transactions"
        description="Everything this organization recorded. You can read it, not change it."
        actions={<SegmentedControl options={TYPE_OPTIONS} value={type} onChange={changeType} />}
      >
        <DataTable
          columns={COLUMNS}
          rows={result?.data}
          caption="Organization transactions"
          loading={loading}
          error={error}
          onRetry={load}
          filtersActive={type !== 'all'}
          emptyState={type === 'all'
            ? <EmptyState title="No transactions yet" description="Income and expenses show up here once the organization records them." />
            : undefined}
          pagination={meta && (
            <PaginationControls currentPage={meta.current_page} totalItems={meta.total} pageSize={meta.per_page} onPageChange={setPage} label="transactions" />
          )}
        />
      </Card>
    </div>
  );
}
