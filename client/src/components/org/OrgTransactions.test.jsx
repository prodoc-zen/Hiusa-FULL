import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrgTransactions from './OrgTransactions';

const mocks = vi.hoisted(() => ({ getOrganizationTransactions: vi.fn() }));

vi.mock('../../services/orgSpaceService', () => ({ getOrganizationTransactions: mocks.getOrganizationTransactions }));

const rows = [
  { id: 1, transaction_date: '2026-10-05T00:00:00Z', description: 'Booth rental', category: 'venue', type: 'expense', amount: 1200, budget_title: 'Intramurals', recorded_by: 'Ana Reyes' },
  { id: 2, transaction_date: '2026-10-01T00:00:00Z', description: 'Membership dues', category: 'membership', type: 'income', amount: 500, budget_title: null, recorded_by: 'Ben Cruz' },
];

const page = (data, overrides = {}) => ({
  data: {
    data,
    meta: { current_page: 1, last_page: 1, per_page: 15, total: data.length, ...overrides.meta },
    summary: { income: 500, expense: 1200, ...overrides.summary },
  },
});

describe('OrgTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganizationTransactions.mockResolvedValue(page(rows));
  });

  it('shows the ledger with who recorded each line and the totals, with nothing to edit', async () => {
    render(<OrgTransactions organizationId={12} />);

    const table = await screen.findByRole('table', { name: 'Organization transactions' });
    expect(mocks.getOrganizationTransactions).toHaveBeenCalledWith(12, { page: 1 });
    expect(within(table).getByText('Booth rental')).toBeInTheDocument();
    expect(within(table).getByText('Intramurals')).toBeInTheDocument();
    expect(within(table).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(table).getByText('₱1,200.00')).toBeInTheDocument();
    expect(screen.getByText('Total income').closest('div')).toHaveTextContent('₱500.00');
    expect(screen.getByText('Total expenses').closest('div')).toHaveTextContent('₱1,200.00');
    expect(screen.queryByRole('button', { name: /delete|edit|add/i })).not.toBeInTheDocument();
  });

  it('gives each transaction one two-line block for phones, with the amount on the right and the direction in words', async () => {
    render(<OrgTransactions organizationId={12} />);

    const list = await screen.findByRole('list', { name: 'Organization transactions' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [expense, income] = items;
    expect(expense.querySelectorAll('p')).toHaveLength(4);
    expect(within(expense).getByText('Booth rental')).toBeInTheDocument();
    expect(within(expense).getByText('₱1,200.00').closest('div')).toHaveClass('text-right');
    expect(within(expense).getByText('expense')).toBeInTheDocument();
    expect(within(income).getByText('income')).toBeInTheDocument();
    expect(list).toHaveClass('md:hidden');
  });

  it('shows the date, category and who recorded it on the phone list, and lets a long description wrap', async () => {
    const longDescription = 'Van rental for Leadership Seminar and the overnight team building retreat';
    mocks.getOrganizationTransactions.mockResolvedValue(page([{ ...rows[0], description: longDescription }, rows[1]]));
    render(<OrgTransactions organizationId={12} />);

    const list = await screen.findByRole('list', { name: 'Organization transactions' });
    const [expense, income] = within(list).getAllByRole('listitem');
    expect(within(expense).getByText('Oct 5, 2026 · venue · Ana Reyes')).toBeInTheDocument();
    expect(within(income).getByText('Oct 1, 2026 · membership · Ben Cruz')).toBeInTheDocument();
    const description = within(expense).getByText(longDescription);
    expect(description).toHaveClass('break-words');
    expect(description).not.toHaveClass('truncate');
  });

  it('falls back to Unknown and a plain category on the phone list when the row has none', async () => {
    mocks.getOrganizationTransactions.mockResolvedValue(page([{ ...rows[0], category: null, recorded_by: null }]));
    render(<OrgTransactions organizationId={12} />);

    const list = await screen.findByRole('list', { name: 'Organization transactions' });
    expect(within(list).getByText('Oct 5, 2026 · None · Unknown')).toBeInTheDocument();
  });

  it('shows the pager once, outside both the table and the phone list', async () => {
    mocks.getOrganizationTransactions.mockResolvedValue(page(rows, { meta: { last_page: 2, total: 30 } }));
    render(<OrgTransactions organizationId={12} />);
    const table = await screen.findByRole('table', { name: 'Organization transactions' });

    expect(screen.getAllByText(/Showing/)).toHaveLength(1);
    expect(table.closest('div[data-view="table"]').textContent).not.toMatch(/Showing/);
  });

  it('filters by type and goes back to the first page', async () => {
    mocks.getOrganizationTransactions.mockResolvedValue(page(rows, { meta: { last_page: 2, total: 30 } }));
    render(<OrgTransactions organizationId={12} />);
    await screen.findByRole('table', { name: 'Organization transactions' });
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1-15 of 30 transactions');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(mocks.getOrganizationTransactions).toHaveBeenLastCalledWith(12, { page: 2 }));

    fireEvent.click(screen.getByRole('radio', { name: 'Income' }));
    await waitFor(() => expect(mocks.getOrganizationTransactions).toHaveBeenLastCalledWith(12, { page: 1, type: 'income' }));
  });

  it('says so when there are no transactions, and when a filter hides them', async () => {
    mocks.getOrganizationTransactions.mockResolvedValue(page([], { summary: { income: 0, expense: 0 } }));
    render(<OrgTransactions organizationId={12} />);
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Expense' }));
    expect(await screen.findByText(/different search term/)).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    mocks.getOrganizationTransactions.mockRejectedValueOnce({ response: { status: 500 } });
    render(<OrgTransactions organizationId={12} />);

    expect(await screen.findByText('Could not load the transactions. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table', { name: 'Organization transactions' })).toBeInTheDocument();
  });
});
