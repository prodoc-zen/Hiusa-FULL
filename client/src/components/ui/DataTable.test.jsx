import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable from './DataTable';

const COLUMNS = [
  { key: 'name', header: 'Name' },
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

  it('shows an empty state when there are no rows', () => {
    render(<DataTable columns={COLUMNS} rows={[]} emptyState={<p>No members yet.</p>} />);
    expect(screen.getByText('No members yet.')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('shows a loading skeleton instead of the table while loading', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} loading />);
    expect(screen.getByRole('status', { name: 'Loading table' })).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });
});
