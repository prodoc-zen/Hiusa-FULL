import { useCallback, useEffect, useState } from 'react';
import PaginationControls from '../PaginationControls';
import { Card, DataTable, EmptyState, SegmentedControl, Stat } from '../ui';
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
  { key: 'description', header: 'Description', render: (row) => <span className="block min-w-0 break-words font-medium">{row.description || 'No description'}{row.budget_title && <span className="block text-xs font-normal text-ink-muted">{row.budget_title}</span>}</span> },
  { key: 'category', header: 'Category', render: (row) => <span className="capitalize">{row.category || 'None'}</span> },
  { key: 'type', header: 'Type', render: (row) => <span className="capitalize">{row.type}</span> },
  { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="tabular-nums">{peso(row.amount)}</span> },
  { key: 'recorded_by', header: 'Recorded by', render: (row) => row.recorded_by || 'Unknown' },
];

// On a phone each transaction is one block of two lines: what and when on the left, the amount and its
// direction in words on the right. The second line carries the date, category and who recorded it.
function TransactionList({ rows }) {
  return (
    <ul className="divide-y divide-line-soft md:hidden" aria-label="Organization transactions" data-view="transactions">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-ink">{row.description || 'No description'}</p>
            <p className="break-words text-xs text-ink-muted">{manilaDate(row.transaction_date)} · {row.category || 'None'} · {row.recorded_by || 'Unknown'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-medium tabular-nums text-ink">{peso(row.amount)}</p>
            <p className="text-xs capitalize text-ink-muted">{row.type}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

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
  const rows = result?.data;
  const pagination = meta && (
    <PaginationControls currentPage={meta.current_page} totalItems={meta.total} pageSize={meta.per_page} onPageChange={setPage} label="transactions" />
  );
  const hasRows = !loading && !error && rows?.length > 0;

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
        bodyClassName="max-md:p-3!"
      >
        {hasRows ? (
          <>
            <div className="hidden md:block">
              <DataTable columns={COLUMNS} rows={rows} caption="Organization transactions" pageSize={0} />
            </div>
            <TransactionList rows={rows} />
            {pagination}
          </>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            caption="Organization transactions"
            loading={loading}
            error={error}
            onRetry={load}
            filtersActive={type !== 'all'}
            emptyState={type === 'all'
              ? <EmptyState title="No transactions yet" description="Income and expenses show up here once the organization records them." />
              : undefined}
            pagination={pagination}
          />
        )}
      </Card>
    </div>
  );
}
