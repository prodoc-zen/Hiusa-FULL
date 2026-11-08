import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Button from './Button';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import { SkeletonTable } from './Skeleton';

const DEFAULT_PAGE_SIZE = 20;

// Poppins digits were measured on the served font (advance widths 1 = 320, 8 = 631
// of 1000) and it carries no tnum feature, so `tabular-nums` alone does not line
// numbers up. Numeric columns are therefore right-aligned in a fixed-width column
// (w-28) so the units digits share one right edge. `tabular-nums` stays for the
// day the font gains the feature.
const NUMERIC_CELL = 'text-right tabular-nums whitespace-nowrap';
const NUMERIC_HEADER_WIDTH = 'w-28';

function isNumeric(column) {
  return column.align === 'right' || column.numeric === true;
}

export default function DataTable({
  columns,
  rows,
  rowKey = (row) => row.id,
  loading = false,
  error = null,
  onRetry,
  emptyState,
  filtersActive = false,
  onClearFilters,
  sort,
  onSortChange,
  actions,
  actionsHeader = 'Actions',
  filters,
  pagination,
  pageSize = DEFAULT_PAGE_SIZE,
  caption,
  captionVisible = false,
  stickyHeader = true,
  minTableWidth = '',
}) {
  const [page, setPage] = useState(0);

  if (loading) {
    return (
      <div>
        {filters}
        <SkeletonTable columns={columns.length + (actions ? 1 : 0)} rows={Math.min(5, pageSize)} />
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
    const fallback = filtersActive ? (
      <EmptyState kind="filtered" description="Try a different search term or clear your filters." onClearFilters={onClearFilters} />
    ) : (
      <EmptyState kind="first-run" title="Nothing to show yet" description="Records will appear here once there's data." />
    );

    return (
      <div>
        {filters}
        {emptyState || fallback}
      </div>
    );
  }

  // A caller that passes its own `pagination` has already sliced rows (server side or
  // its own client paging). Otherwise the table pages itself at `pageSize` rows.
  const selfPaged = !pagination && pageSize > 0 && rows.length > pageSize;
  const pageCount = selfPaged ? Math.ceil(rows.length / pageSize) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = selfPaged ? rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : rows;
  const pagerNode = selfPaged ? (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3" aria-label="Pagination">
      <p className="text-xs font-normal text-ink-muted">
        Showing {currentPage * pageSize + 1} to {Math.min((currentPage + 1) * pageSize, rows.length)} of {rows.length}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
      </div>
    </nav>
  ) : pagination;

  function toggleSort(column) {
    if (!column.sortable || !onSortChange) return;
    const isActive = sort?.key === column.key;
    const nextDirection = isActive && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: column.key, direction: nextDirection });
  }

  function ariaSortFor(column) {
    if (!column.sortable) return undefined;
    if (sort?.key !== column.key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
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

      <div className={`hidden min-w-0 md:block ${minTableWidth ? 'overflow-x-auto' : ''}`} data-view="table">
        <table className={`w-full border-collapse text-sm ${minTableWidth}`}>
          <caption className={captionVisible ? 'pb-2 text-left text-sm font-semibold text-ink' : 'sr-only'}>
            {caption || 'Records'}
          </caption>
          <thead className={`${stickyHeader ? 'sticky top-0 z-10' : ''} bg-subtle`}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSortFor(column)}
                  className={`whitespace-nowrap border-b border-line px-4 py-2.5 text-xs font-semibold text-ink-muted ${isNumeric(column) ? `text-right ${NUMERIC_HEADER_WIDTH}` : 'text-left'}`}
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
                <th scope="col" className="border-b border-line px-4 py-2.5 text-right text-xs font-semibold text-ink-muted">
                  {actionsHeader}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line-soft transition-colors duration-150 hover:bg-subtle">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-2.5 align-middle text-sm font-normal text-ink ${isNumeric(column) ? NUMERIC_CELL : ''} ${column.className || ''}`}
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
                {actions && <td className="px-4 py-2.5 text-right">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col divide-y divide-line-soft md:hidden" data-view="cards">
        {visibleRows.map((row) => (
          <li key={rowKey(row)} className="py-3 first:pt-0 last:pb-0">
            <dl className="flex flex-col gap-2">
              {columns.map((column) => (
                <div key={column.key} className="flex items-start justify-between gap-3">
                  <dt className="text-xs font-semibold text-ink-muted">{column.header}</dt>
                  <dd className={`text-right text-sm font-normal text-ink ${isNumeric(column) ? 'tabular-nums' : ''}`}>{column.render ? column.render(row) : row[column.key]}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft pt-3">{actions(row)}</div>}
          </li>
        ))}
      </ul>

      {pagerNode}
    </div>
  );
}
