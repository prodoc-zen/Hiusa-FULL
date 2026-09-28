import { render, screen, within } from '@testing-library/react';
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
});
