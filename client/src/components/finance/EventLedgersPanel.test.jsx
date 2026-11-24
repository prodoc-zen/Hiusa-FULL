import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EventLedgersPanel, { EventBudgetsList, EventLedgerHeader } from './EventLedgersPanel';

const seminar = {
  event_id: 1, title: 'Leadership Seminar 2024', start_time: '2024-09-10T01:00:00Z', status: 'completed',
  income: '2000.00', expense: '1500.00', net: '500.00', transaction_count: 3,
  budget: { id: 11, title: 'Seminar budget', submission_status: 'approved', is_released: true, allocated_amount: '5000.00', spent_amount: '1500.00', remaining_amount: '5500.00' },
};
const sports = {
  event_id: 2, title: 'Sports Fest 2024', start_time: '2024-10-01T01:00:00Z', status: 'completed',
  income: '0.00', expense: '0.00', net: '0.00', transaction_count: 0,
  budget: { id: 12, title: 'Sports Fest 2024 Budget', submission_status: 'pending_department_head', is_released: false, allocated_amount: '25000.00', spent_amount: '0.00', remaining_amount: '25000.00' },
};
const induction = {
  event_id: 3, title: 'Induction and Recognition Ceremony', start_time: '2024-11-05T01:00:00Z', status: 'upcoming',
  income: '300.00', expense: '100.00', net: '200.00', transaction_count: 2, budget: null,
};
const ledgers = {
  data: [seminar, sports, induction],
  unassigned: { income: '1000.00', expense: '400.00', net: '600.00', transaction_count: 4 },
  totals: { income: '3300.00', expense: '2000.00', net: '1300.00', transaction_count: 9 },
};

describe('EventLedgersPanel', () => {
  it('lists every event with income, expenses, net and count, including one with no transactions', () => {
    render(<EventLedgersPanel ledgers={ledgers} onOpenEvent={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Event ledgers' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByText(/Leadership|Sports|Induction|No event|All events/).textContent)).toEqual([
      'Leadership Seminar 2024', 'Sports Fest 2024', 'Induction and Recognition Ceremony', 'No event', 'All events',
    ]);
    const seminarRow = rows[0];
    expect(within(seminarRow).getByText('Income').nextSibling).toHaveTextContent('₱2,000.00');
    expect(within(seminarRow).getByText('Expenses').nextSibling).toHaveTextContent('₱1,500.00');
    expect(within(seminarRow).getByText('Net').nextSibling).toHaveTextContent('₱500.00');
    expect(within(seminarRow).getByText('Transactions').nextSibling).toHaveTextContent('3');
    expect(within(rows[1]).getByText('Transactions').nextSibling).toHaveTextContent('0');
  });

  it('puts the unassigned transactions under No event and the totals row last, equal to the sum of the rows above', () => {
    render(<EventLedgersPanel ledgers={ledgers} onOpenEvent={vi.fn()} />);

    const rows = within(screen.getByRole('list', { name: 'Event ledgers' })).getAllByRole('listitem');
    const noEvent = rows[3];
    const totals = rows[4];
    expect(within(noEvent).getByText('Income').nextSibling).toHaveTextContent('₱1,000.00');
    expect(within(noEvent).getByText('Transactions').nextSibling).toHaveTextContent('4');
    expect(within(totals).getByText('Income').nextSibling).toHaveTextContent('₱3,300.00');
    expect(within(totals).getByText('Expenses').nextSibling).toHaveTextContent('₱2,000.00');
    expect(within(totals).getByText('Net').nextSibling).toHaveTextContent('₱1,300.00');
    expect(within(totals).getByText('Transactions').nextSibling).toHaveTextContent('9');

    const sum = (key) => [...ledgers.data, ledgers.unassigned].reduce((total, row) => total + Number(row[key]), 0);
    expect(sum('income')).toBe(Number(ledgers.totals.income));
    expect(sum('expense')).toBe(Number(ledgers.totals.expense));
    expect(sum('transaction_count')).toBe(ledgers.totals.transaction_count);
  });

  it('opens an event ledger from its name', () => {
    const onOpenEvent = vi.fn();
    render(<EventLedgersPanel ledgers={ledgers} onOpenEvent={onOpenEvent} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sports Fest 2024' }));

    expect(onOpenEvent).toHaveBeenCalledWith(sports);
    expect(screen.queryByRole('button', { name: 'No event' })).not.toBeInTheDocument();
  });

  it('says so when the organization has no events', () => {
    render(<EventLedgersPanel ledgers={{ data: [], unassigned: { income: '0.00', expense: '0.00', net: '0.00', transaction_count: 0 }, totals: { income: '0.00', expense: '0.00', net: '0.00', transaction_count: 0 } }} onOpenEvent={vi.fn()} />);

    expect(screen.getByText('No events in this semester yet.')).toBeInTheDocument();
  });
});

describe('EventLedgerHeader', () => {
  it('shows the event totals, its budget figures and a way back', () => {
    const onBack = vi.fn();
    render(<EventLedgerHeader ledger={seminar} budget={null} onBack={onBack} />);

    expect(screen.getByRole('heading', { name: 'Leadership Seminar 2024' })).toBeInTheDocument();
    const totals = within(screen.getByLabelText('Event totals'));
    expect(totals.getByText('Income').nextSibling).toHaveTextContent('₱2,000.00');
    expect(totals.getByText('Expenses').nextSibling).toHaveTextContent('₱1,500.00');
    expect(totals.getByText('Net').nextSibling).toHaveTextContent('₱500.00');
    expect(totals.getByText('Transactions').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('5,000.00 allocated - 1,500.00 spent + 2,000.00 income = 5,500.00 remaining')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /All events/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('says there is no budget for an event without one', () => {
    render(<EventLedgerHeader ledger={induction} onBack={vi.fn()} />);

    expect(screen.getByText('No budget yet')).toBeInTheDocument();
  });

  it('records a transaction with the event preset and locked', () => {
    const onRecordTransaction = vi.fn();
    render(<EventLedgerHeader ledger={seminar} onBack={vi.fn()} onRecordTransaction={onRecordTransaction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record transaction' }));

    expect(onRecordTransaction).toHaveBeenCalledWith({ eventId: 1, lockEvent: true });
  });

  it('has no Record transaction button for someone who cannot record', () => {
    render(<EventLedgerHeader ledger={seminar} onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Record transaction' })).not.toBeInTheDocument();
  });
});

describe('EventBudgetsList', () => {
  const renderBudget = (budget) => <p>{`Card for ${budget.title}`}</p>;

  it('lists every event, with its budget, or No budget yet and a Create budget action', () => {
    const onCreateBudget = vi.fn();
    render(<EventBudgetsList rows={ledgers.data} renderBudget={renderBudget} canCreateBudget onCreateBudget={onCreateBudget} />);

    const rows = within(screen.getByRole('list', { name: 'Event budgets' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Card for Seminar budget')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Card for Sports Fest 2024 Budget')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Induction and Recognition Ceremony')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No budget yet')).toBeInTheDocument();
    expect(screen.getAllByText('No budget yet')).toHaveLength(1);

    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Create budget' }));
    expect(onCreateBudget).toHaveBeenCalledWith(3);
  });

  it('shows No budget yet without a Create budget action to someone who cannot create budgets', () => {
    render(<EventBudgetsList rows={[induction]} renderBudget={renderBudget} canCreateBudget={false} onCreateBudget={vi.fn()} />);

    expect(screen.getByText('No budget yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create budget' })).not.toBeInTheDocument();
  });
});
