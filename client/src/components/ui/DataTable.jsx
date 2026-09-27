import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import { SkeletonTable } from './Skeleton';

export default function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id,
  loading = false,
  error = null,
  onRetry,
  emptyState,
  sort,
  onSortChange,
  actions,
  actionsHeader = 'Actions',
  filters,
  pagination,
  caption,
}) {
  if (loading) {
    return (
      <div>
        {filters}
        <SkeletonTable columns={columns.length + (actions ? 1 : 0)} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {filters}
        <ErrorState description={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div>
        {filters}
        {emptyState || <EmptyState kind="filtered" description="Nothing to show yet." />}
      </div>
    );
  }

  function toggleSort(column) {
    if (!column.sortable || !onSortChange) return;
    const isActive = sort?.key === column.key;
    const nextDirection = isActive && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: column.key, direction: nextDirection });
  }

  function SortIcon({ column }) {
    if (!column.sortable) return null;
    if (sort?.key !== column.key) return <ArrowUpDown size={13} className="text-ink-soft" aria-hidden="true" />;
    return sort.direction === 'asc'
      ? <ArrowUp size={13} className="text-brand-600" aria-hidden="true" />
      : <ArrowDown size={13} className="text-brand-600" aria-hidden="true" />;
  }

  return (
    <div>
      {filters}

      <div className="hidden overflow-x-auto md:block" data-view="table">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-subtle">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`border-b border-line px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-muted ${column.align === 'right' ? 'text-right' : ''}`}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1 hover:text-ink"
                      aria-label={`Sort by ${column.header}`}
                    >
                      {column.header}
                      <SortIcon column={column} />
                    </button>
                  ) : column.header}
                </th>
              ))}
              {actions && (
                <th scope="col" className="border-b border-line px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-ink-muted">
                  {actionsHeader}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line-soft transition-colors duration-150 hover:bg-subtle">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3.5 align-middle font-medium text-ink ${column.align === 'right' ? 'text-right tabular-nums' : ''} ${column.className || ''}`}
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
                {actions && <td className="px-4 py-3.5 text-right">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden" data-view="cards">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-card border border-line bg-surface p-4">
            <dl className="flex flex-col gap-2">
              {columns.map((column) => (
                <div key={column.key} className="flex items-start justify-between gap-3">
                  <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">{column.header}</dt>
                  <dd className="text-right text-sm font-semibold text-ink">{column.render ? column.render(row) : row[column.key]}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft pt-3">{actions(row)}</div>}
          </li>
        ))}
      </ul>

      {pagination}
    </div>
  );
}
