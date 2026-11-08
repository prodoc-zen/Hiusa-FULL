import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataTable from './DataTable';

const COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'role', header: 'Role' },
];

const SORTABLE_COLUMNS = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'role', header: 'Role' },
];

const ROWS = [
  { id: 1, name: 'Maria Santos', role: 'Officer' },
  { id: 2, name: 'Juan Cruz', role: 'Student' },
];

describe('DataTable', () => {
  it('renders every row in both the table view and the mobile card view', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);
    expect(screen.getAllByText('Maria Santos')).toHaveLength(2);
    expect(screen.getAllByText('Juan Cruz')).toHaveLength(2);

    const tableView = document.querySelector('[data-view="table"]');
    const cardView = document.querySelector('[data-view="cards"]');
    expect(tableView).not.toBeNull();
    expect(cardView).not.toBeNull();
    expect(tableView.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(cardView.querySelectorAll('li')).toHaveLength(2);
  });

  it('shows a custom empty state when there are no rows', () => {
    render(<DataTable columns={COLUMNS} rows={[]} emptyState={<p>No members yet.</p>} />);
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('shows a neutral first-run empty state by default, and the filtered state only when filters are active', () => {
    const { rerender } = render(<DataTable columns={COLUMNS} rows={[]} />);
    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
    expect(screen.queryByText('No results')).not.toBeInTheDocument();

    rerender(<DataTable columns={COLUMNS} rows={[]} filtersActive />);
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to show yet')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton instead of the table while loading', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} loading />);
    expect(screen.getByRole('status', { name: 'Loading table' })).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('exposes aria-sort on sortable headers and flips it on sort change', () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable columns={SORTABLE_COLUMNS} rows={ROWS} sort={{ key: 'name', direction: 'asc' }} onSortChange={onSortChange} />,
    );

    const tableView = document.querySelector('[data-view="table"]');
    const nameHeader = screen.getByRole('button', { name: 'Sort by Name' }).closest('th');
    const roleHeader = within(tableView).getByText('Role').closest('th');
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(roleHeader).not.toHaveAttribute('aria-sort');

    screen.getByRole('button', { name: 'Sort by Name' }).click();
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });

    rerender(<DataTable columns={SORTABLE_COLUMNS} rows={ROWS} sort={{ key: 'name', direction: 'desc' }} onSortChange={onSortChange} />);
    expect(screen.getByRole('button', { name: 'Sort by Name' }).closest('th')).toHaveAttribute('aria-sort', 'descending');
  });

  it('keeps the desktop table wrapper free of its own horizontal scroll, so the sticky header sticks to the page and not to a scroll container it creates', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const tableView = document.querySelector('[data-view="table"]');
    expect(tableView.className).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(document.querySelector('thead').className).toMatch(/\bsticky\b/);
  });

  it('always renders a caption, falling back to a generic one, and can show it', () => {
    const { rerender } = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    expect(document.querySelector('caption')).toHaveTextContent('Records');
    expect(document.querySelector('caption').className).toMatch(/sr-only/);

    rerender(<DataTable columns={COLUMNS} rows={ROWS} caption="Members" captionVisible />);
    expect(document.querySelector('caption')).toHaveTextContent('Members');
    expect(document.querySelector('caption').className).not.toMatch(/sr-only/);
  });

  it('right-aligns numeric columns in a fixed width with tabular figures, and drops uppercase headers', () => {
    const columns = [{ key: 'name', header: 'Name' }, { key: 'amount', header: 'Amount', align: 'right' }];
    render(<DataTable columns={columns} rows={[{ id: 1, name: 'Maria', amount: 1111 }]} />);
    const tableView = document.querySelector('[data-view="table"]');
    const amountHeader = within(tableView).getByText('Amount').closest('th');
    expect(amountHeader).toHaveClass('text-right', 'w-28');
    expect(within(tableView).getByText('1111')).toHaveClass('text-right', 'tabular-nums');
    expect(within(tableView).getByText('Maria')).not.toHaveClass('text-right');
    expect(amountHeader.className).not.toMatch(/uppercase|tracking-wide|font-bold/);
    expect(within(tableView).getByText('Maria').className).toMatch(/font-normal/);
    expect(within(tableView).getByText('Maria').className).toMatch(/py-2\.5/);
  });

  it('pages itself at 20 rows when the caller supplies no pagination', () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({ id: index + 1, name: `Person ${index + 1}`, role: 'Student' }));
    render(<DataTable columns={COLUMNS} rows={rows} />);
    const tableView = document.querySelector('[data-view="table"]');
    expect(tableView.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(screen.getByText('Showing 1 to 20 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(tableView.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(screen.getByText('Showing 21 to 40 of 45')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(tableView.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('leaves rows alone when the caller supplies its own pagination, and does not page 20 rows', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `Person ${index + 1}`, role: 'Student' }));
    const { rerender } = render(<DataTable columns={COLUMNS} rows={rows} pagination={<p>Custom pager</p>} />);
    expect(document.querySelectorAll('[data-view="table"] tbody tr')).toHaveLength(30);
    expect(screen.getByText('Custom pager')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();

    rerender(<DataTable columns={COLUMNS} rows={rows.slice(0, 20)} />);
    expect(document.querySelectorAll('[data-view="table"] tbody tr')).toHaveLength(20);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('shows a table-shaped, non-shimmering skeleton while loading', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} loading />);
    const skeleton = screen.getByRole('status', { name: 'Loading table' });
    expect(skeleton.querySelectorAll('.skeleton-shimmer')).toHaveLength(0);
    expect(skeleton.children).toHaveLength(6);
  });

  it('offers Clear filters on the none-match state when the caller wires onClearFilters', () => {
    const onClearFilters = vi.fn();
    render(<DataTable columns={COLUMNS} rows={[]} filtersActive onClearFilters={onClearFilters} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});
