import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancePage from './FinancePage';

const financeMocks = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  getTransactionSummary: vi.fn(),
  getEventLedgers: vi.fn(),
  getPersonalReceipts: vi.fn(),
  getInvoices: vi.fn(),
  getForecasts: vi.fn(),
  getBudgets: vi.fn(),
  getFinancialReports: vi.fn(),
}));

vi.mock('../../../services/financeService', () => ({
  ...financeMocks,
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  deleteBudget: vi.fn(),
  generateForecast: vi.fn(),
  generateBudgetAdvice: vi.fn(),
  getFinancialReport: vi.fn(),
  generateFinancialReport: vi.fn(),
  downloadFinancialReportPdf: vi.fn(),
  submitFinancialReport: vi.fn(),
}));

vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: vi.fn(() => Promise.resolve({ data: [] })) }));

const eventMocks = vi.hoisted(() => ({ getEvents: vi.fn() }));
vi.mock('../../../services/eventService', () => eventMocks);

const events = [
  { id: 1, title: 'Leadership Seminar 2024' },
  { id: 2, title: 'Sports Fest 2024' },
  { id: 3, title: 'Induction and Recognition Ceremony' },
];

const budgets = [
  { id: 11, title: 'Seminar budget', event_id: 1, approval_status: 'approved', submission_status: 'approved', is_released: true, allocated_amount: '5000.00', spent_amount: '1500.00', income_amount: '2000.00', remaining_amount: '5500.00', warning_threshold: 500 },
  { id: 12, title: 'Sports Fest 2024 Budget', event_id: 2, approval_status: 'pending', submission_status: 'pending_department_head', is_released: false, allocated_amount: '25000.00', spent_amount: '0.00', income_amount: '0.00', remaining_amount: '25000.00', warning_threshold: 2000 },
  { id: 13, title: 'General Operations Fund', event_id: null, approval_status: 'approved', submission_status: 'approved', is_released: true, allocated_amount: '50000.00', spent_amount: '13500.00', income_amount: '43500.00', remaining_amount: '80000.00', warning_threshold: 5000 },
];

const ledgers = {
  data: [
    { event_id: 1, title: 'Leadership Seminar 2024', start_time: '2024-09-10T01:00:00Z', status: 'completed', income: '2000.00', expense: '1500.00', net: '500.00', transaction_count: 3, budget: { id: 11, title: 'Seminar budget', submission_status: 'approved', is_released: true, allocated_amount: '5000.00', spent_amount: '1500.00', remaining_amount: '5500.00' } },
    { event_id: 2, title: 'Sports Fest 2024', start_time: '2024-10-01T01:00:00Z', status: 'completed', income: '0.00', expense: '0.00', net: '0.00', transaction_count: 0, budget: { id: 12, title: 'Sports Fest 2024 Budget', submission_status: 'pending_department_head', is_released: false, allocated_amount: '25000.00', spent_amount: '0.00', remaining_amount: '25000.00' } },
    { event_id: 3, title: 'Induction and Recognition Ceremony', start_time: '2024-11-05T01:00:00Z', status: 'upcoming', income: '300.00', expense: '100.00', net: '200.00', transaction_count: 2, budget: null },
  ],
  unassigned: { income: '1000.00', expense: '400.00', net: '600.00', transaction_count: 4 },
  totals: { income: '3300.00', expense: '2000.00', net: '1300.00', transaction_count: 9 },
};

const seminarRows = [
  { id: 101, description: 'Seminar venue', type: 'expense', category: 'Events', amount: '1500.00', transaction_date: '2024-09-10', event_id: 1 },
  { id: 102, description: 'Seminar tickets', type: 'income', category: 'Events', amount: '2000.00', transaction_date: '2024-09-09', event_id: 1 },
];
const allRows = [...seminarRows, { id: 103, description: 'Ream of bond paper', type: 'expense', category: 'Operations', amount: '400.00', transaction_date: '2024-09-01', event_id: null }];

function page(rows) {
  return { data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 10 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  financeMocks.getTransactions.mockImplementation((params = {}) => Promise.resolve(page(params.event_id === '1' ? seminarRows : allRows)));
  financeMocks.getTransactionSummary.mockImplementation((params = {}) => Promise.resolve({
    data: params.event_id === '1'
      ? { total_income: 2000, total_expense: 1500, net_balance: 500 }
      : { total_income: 3300, total_expense: 2000, net_balance: 1300 },
  }));
  financeMocks.getEventLedgers.mockResolvedValue({ data: ledgers });
  financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
  financeMocks.getInvoices.mockResolvedValue({ data: [] });
  financeMocks.getForecasts.mockResolvedValue({ data: [] });
  financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
  financeMocks.getBudgets.mockResolvedValue({ data: budgets });
  eventMocks.getEvents.mockResolvedValue({ data: events });
});

function renderPage(tab) {
  render(
    <MemoryRouter initialEntries={[tab === 'budgets' ? '/dashboard/finance/budget-allocation' : '/dashboard/finance/financial-ledger']}>
      <FinancePage initialTab={tab} />
    </MemoryRouter>,
  );
}

describe('Budgets tab', () => {
  it('lists every event under Event budgets, with No budget yet where an event has none', async () => {
    renderPage('budgets');

    const list = await screen.findByRole('list', { name: 'Event budgets' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Leadership Seminar 2024')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Seminar budget')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Sports Fest 2024')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Induction and Recognition Ceremony')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No budget yet')).toBeInTheDocument();
    expect(within(rows[2]).getByRole('button', { name: 'Create budget' })).toBeInTheDocument();
  });

  it('keeps budgets with no event under General budgets, and not under Event budgets', async () => {
    renderPage('budgets');

    const general = await screen.findByRole('list', { name: 'General budgets' });
    expect(within(general).getAllByRole('listitem')).toHaveLength(1);
    expect(within(general).getByText('General Operations Fund')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Event budgets' })).queryByText('General Operations Fund')).not.toBeInTheDocument();
  });

  it('lists every budget of an event inside that event, and none of them under General budgets', async () => {
    financeMocks.getBudgets.mockResolvedValue({ data: [
      ...budgets,
      { ...budgets[0], id: 14, title: 'Seminar snacks budget', approval_status: 'pending', submission_status: 'pending_department_head', is_released: false, allocated_amount: '800.00', spent_amount: '0.00', income_amount: '0.00', remaining_amount: '800.00' },
    ] });
    renderPage('budgets');

    const rows = within(await screen.findByRole('list', { name: 'Event budgets' })).getAllByRole('listitem');
    expect(within(rows[0]).getByText('Seminar budget')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Seminar snacks budget')).toBeInTheDocument();
    const general = screen.getByRole('list', { name: 'General budgets' });
    expect(within(general).getAllByRole('listitem')).toHaveLength(1);
    expect(within(general).queryByText('Seminar snacks budget')).not.toBeInTheDocument();
  });

  it('shows the four figures and the arithmetic on a budget card', async () => {
    renderPage('budgets');

    const general = await screen.findByRole('list', { name: 'General budgets' });
    expect(within(general).getByText('Spent').nextSibling).toHaveTextContent('₱13,500.00');
    expect(within(general).getByText('Income').nextSibling).toHaveTextContent('₱43,500.00');
    expect(within(general).getByText('50,000.00 allocated - 13,500.00 spent + 43,500.00 income = 80,000.00 remaining')).toBeInTheDocument();
  });

  it('shows a pending budget as not released, with Remaining equal to Allocated', async () => {
    renderPage('budgets');

    const rows = within(await screen.findByRole('list', { name: 'Event budgets' })).getAllByRole('listitem');
    expect(within(rows[1]).getByText('Remaining').nextSibling).toHaveTextContent('₱25,000.00');
    expect(within(rows[1]).getByText('Not released until approved. Nothing can be spent from it yet.')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Spent')).not.toBeInTheDocument();
  });

  it('opens the budget form with that event preselected from Create budget', async () => {
    renderPage('budgets');

    const rows = within(await screen.findByRole('list', { name: 'Event budgets' })).getAllByRole('listitem');
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Create budget' }));

    const dialog = await screen.findByRole('dialog', { name: 'Propose budget' });
    expect(within(dialog).getByLabelText(/Linked event/).value).toBe('3');
  });

  it('shows no Create budget action to an officer whose position cannot handle finance', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', can_handle_finance: false }));
    renderPage('budgets');

    const rows = within(await screen.findByRole('list', { name: 'Event budgets' })).getAllByRole('listitem');
    expect(within(rows[2]).getByText('No budget yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create budget' })).not.toBeInTheDocument();
  });

  it('still lists every event when the event ledgers cannot be read', async () => {
    financeMocks.getEventLedgers.mockRejectedValue(new Error('down'));
    renderPage('budgets');

    const rows = within(await screen.findByRole('list', { name: 'Event budgets' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Seminar budget')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No budget yet')).toBeInTheDocument();
  });
});

describe('Ledger by event', () => {
  async function openByEvent() {
    renderPage('transactions');
    fireEvent.click(await screen.findByRole('radio', { name: 'By event' }));
    return screen.findByRole('list', { name: 'Event ledgers' });
  }

  it('lists every event with its totals and a totals row equal to the All transactions totals', async () => {
    renderPage('transactions');
    const overall = await screen.findByText('Net balance');
    expect(overall.nextSibling).toHaveTextContent('₱1,300.00');

    fireEvent.click(screen.getByRole('radio', { name: 'By event' }));
    const rows = within(await screen.findByRole('list', { name: 'Event ledgers' })).getAllByRole('listitem');

    expect(rows).toHaveLength(5);
    const totals = rows[4];
    expect(within(totals).getByText('All events')).toBeInTheDocument();
    expect(within(totals).getByText('Income').nextSibling).toHaveTextContent('₱3,300.00');
    expect(within(totals).getByText('Expenses').nextSibling).toHaveTextContent('₱2,000.00');
    expect(within(totals).getByText('Net').nextSibling).toHaveTextContent('₱1,300.00');
    expect(within(rows[3]).getByText('No event')).toBeInTheDocument();
  });

  it('goes back to All transactions', async () => {
    await openByEvent();

    fireEvent.click(screen.getByRole('radio', { name: 'All transactions' }));

    expect(await screen.findByRole('list', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Event ledgers' })).not.toBeInTheDocument();
  });

  it('opens an event to show its own transactions, totals and budget, and nothing from the other events', async () => {
    const list = await openByEvent();

    fireEvent.click(within(list).getByRole('button', { name: 'Leadership Seminar 2024' }));

    const header = await screen.findByRole('region', { name: 'Event ledger' });
    expect(within(header).getByRole('heading', { name: 'Leadership Seminar 2024' })).toBeInTheDocument();
    expect(within(within(header).getByLabelText('Event totals')).getByText('Net').nextSibling).toHaveTextContent('₱500.00');
    expect(within(header).getByText('5,000.00 allocated - 1,500.00 spent + 2,000.00 income = 5,500.00 remaining')).toBeInTheDocument();

    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ event_id: '1' })));
    expect((await screen.findAllByText('Seminar venue')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Ream of bond paper')).not.toBeInTheDocument();
    expect(financeMocks.getTransactionSummary).toHaveBeenLastCalledWith(expect.objectContaining({ event_id: '1' }));
  });

  it('goes back to the list of events from an event ledger', async () => {
    const list = await openByEvent();
    fireEvent.click(within(list).getByRole('button', { name: 'Leadership Seminar 2024' }));
    fireEvent.click(await screen.findByRole('button', { name: /All events/ }));

    expect(await screen.findByRole('list', { name: 'Event ledgers' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Event ledger' })).not.toBeInTheDocument();
    await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenLastCalledWith(expect.not.objectContaining({ event_id: '1' })));
  });

  it('records a transaction from an event ledger with that event preset and locked', async () => {
    const list = await openByEvent();
    fireEvent.click(within(list).getByRole('button', { name: 'Leadership Seminar 2024' }));
    const header = await screen.findByRole('region', { name: 'Event ledger' });

    fireEvent.click(within(header).getByRole('button', { name: 'Record transaction' }));

    const dialog = await screen.findByRole('dialog', { name: 'Record transaction' });
    const eventField = within(dialog).getByLabelText(/Linked event/);
    expect(eventField.value).toBe('1');
    expect(eventField).toBeDisabled();
  });

  it('leaves the event free on a transaction recorded from the header of All transactions', async () => {
    renderPage('transactions');

    fireEvent.click(await screen.findByRole('button', { name: 'Record transaction' }));

    const dialog = await screen.findByRole('dialog', { name: 'Record transaction' });
    const eventField = within(dialog).getByLabelText(/Linked event/);
    expect(eventField.value).toBe('');
    expect(eventField).toBeEnabled();
  });

  it('records from the page header with no event preset while the list of events is showing', async () => {
    await openByEvent();

    fireEvent.click(screen.getByRole('button', { name: 'Record transaction' }));

    const dialog = await screen.findByRole('dialog', { name: 'Record transaction' });
    expect(within(dialog).getByLabelText(/Linked event/).value).toBe('');
    expect(within(dialog).getByLabelText(/Linked event/)).toBeEnabled();
  });
});
