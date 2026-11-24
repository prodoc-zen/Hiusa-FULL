import { findRowAction } from '../../../test/rowActions';
import { fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancePage from './FinancePage';
import { getEvents } from '../../../services/eventService';

const render = (ui) => renderUi(<MemoryRouter initialEntries={['/dashboard/finance']}>{ui}</MemoryRouter>);

const financeMocks = vi.hoisted(() => ({
  getTransactions: vi.fn(),
  getTransactionSummary: vi.fn(),
  getTransactionHistory: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  archiveTransaction: vi.fn(),
  getPersonalReceipts: vi.fn(),
  getInvoices: vi.fn(),
  getStudentDebts: vi.fn(),
  getForecasts: vi.fn(),
  getBudgets: vi.fn(),
  getFinancialReports: vi.fn(),
}));
vi.mock('../../../services/financeService', () => financeMocks);

const fileMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => fileMocks);

vi.mock('../../../services/clearanceService', () => ({ getMyClearances: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../services/collegeOrganizationService', () => ({ getCollegeOrganizations: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('../../../services/eventService', () => ({ getEvents: vi.fn(() => Promise.resolve({ data: [] })) }));

const plain = { id: 7, transaction_date: '2026-11-08T10:30:00.000000Z', description: 'Venue reservation', category: 'Events', type: 'expense', amount: 2500, event_id: 4, budget_id: null, receipt_reference: null, edit_count: 0, receipt_file_open_url: null };
const edited = { ...plain, id: 8, description: 'Sound system rental', edit_count: 2, last_edited_by_name: 'Maria Cruz', last_edited_at: '2026-11-20T06:30:00.000000Z', receipt_file_open_url: '/transactions/8/receipt-file', has_receipt_file: true };
const archivedRow = { ...plain, id: 9, description: 'Duplicate snacks', archived_at: '2026-11-21T01:00:00.000000Z', archived_by_name: 'Maria Cruz', archive_reason: 'Recorded twice', receipt_file_open_url: '/transactions/9/receipt-file' };

const page = (rows) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 10 } });

function pdf(name = 'or-1042.pdf', size = 2048, type = 'application/pdf') {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function openRecordForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Record transaction' }));
  return screen.findByRole('dialog', { name: 'Record transaction' });
}

function fillBasics(dialog) {
  fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Printing of posters' } });
  fireEvent.change(within(dialog).getByLabelText('Amount (₱)'), { target: { value: '350' } });
}

describe('FinancePage ledger: official receipt, edit trail and archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    financeMocks.getTransactions.mockResolvedValue(page([plain, edited]));
    financeMocks.getTransactionSummary.mockResolvedValue({ data: { total_income: 0, total_expense: 5000, net_balance: -5000 } });
    financeMocks.getPersonalReceipts.mockResolvedValue({ data: [] });
    financeMocks.getInvoices.mockResolvedValue({ data: [] });
    financeMocks.getStudentDebts.mockResolvedValue({ data: { data: [] } });
    financeMocks.getForecasts.mockResolvedValue({ data: [] });
    financeMocks.getBudgets.mockResolvedValue({ data: [] });
    financeMocks.getFinancialReports.mockResolvedValue({ data: [] });
    financeMocks.createTransaction.mockResolvedValue({ data: {} });
    financeMocks.updateTransaction.mockResolvedValue({ data: {} });
    financeMocks.archiveTransaction.mockResolvedValue({ data: {} });
    financeMocks.getTransactionHistory.mockResolvedValue({ data: { data: [
      { action: 'updated', at: '2026-11-20T06:30:00Z', by: { user_id: 3, name: 'Maria Cruz' }, reason: 'Typed the wrong amount', changes: [{ field: 'amount', label: 'Amount', from: '1,000.00', to: '1,200.00' }] },
    ] } });
    getEvents.mockResolvedValue({ data: [{ id: 4, title: 'Sports Fest 2024' }, { id: 5, title: 'Leadership Seminar 2024' }] });
  });

  describe('Record transaction with the official receipt', () => {
    it('will not save an expense without the official receipt, then sends the chosen file with it', async () => {
      render(<FinancePage initialTab="transactions" />);
      const dialog = await openRecordForm();
      fillBasics(dialog);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }));
      expect(await within(dialog).findByText('Attach the official receipt for this expense.')).toBeInTheDocument();
      expect(financeMocks.createTransaction).not.toHaveBeenCalled();

      const file = pdf();
      fireEvent.change(within(dialog).getByLabelText(/^Official receipt/), { target: { files: [file] } });
      expect(within(dialog).getByText('or-1042.pdf')).toBeInTheDocument();
      expect(within(dialog).getByText('2 KB')).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }));
      await waitFor(() => expect(financeMocks.createTransaction).toHaveBeenCalledTimes(1));
      expect(financeMocks.createTransaction.mock.calls[0][0]).toMatchObject({ description: 'Printing of posters', amount: 350, type: 'expense', receipt_file: file });
    });

    it('does not ask for a receipt on income, where the file is optional', async () => {
      render(<FinancePage initialTab="transactions" />);
      const dialog = await openRecordForm();
      fillBasics(dialog);
      fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'income' } });

      expect(within(dialog).getByLabelText(/^Official receipt/)).not.toHaveAttribute('aria-required');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }));
      await waitFor(() => expect(financeMocks.createTransaction).toHaveBeenCalledTimes(1));
      expect(financeMocks.createTransaction.mock.calls[0][0]).toMatchObject({ type: 'income', receipt_file: null });
    });

    it('refuses a file of the wrong type or over 5 MB with the server message and keeps nothing', async () => {
      render(<FinancePage initialTab="transactions" />);
      const dialog = await openRecordForm();
      fillBasics(dialog);

      fireEvent.change(within(dialog).getByLabelText(/^Official receipt/), { target: { files: [pdf('big.pdf', 6 * 1024 * 1024)] } });
      expect(await within(dialog).findByText('Attach the official receipt as a JPG, PNG, WEBP or PDF up to 5 MB.')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }));
      expect(financeMocks.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Editing with a reason', () => {
    async function openEdit() {
      render(<FinancePage initialTab="transactions" />);
      fireEvent.click(await findRowAction('Edit transaction'));
      return screen.findByRole('dialog', { name: 'Edit transaction' });
    }

    it('prefills the entry and keeps Update disabled until the reason has five characters', async () => {
      const dialog = await openEdit();
      expect(within(dialog).getByLabelText('Description')).toHaveValue('Venue reservation');

      const update = within(dialog).getByRole('button', { name: 'Update transaction' });
      expect(update).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Reason for this edit'), { target: { value: 'abcd' } });
      expect(update).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Reason for this edit'), { target: { value: 'Wrong amount typed' } });
      expect(update).toBeEnabled();
    });

    it('sends the reason with the change and can replace the receipt file', async () => {
      const dialog = await openEdit();
      fireEvent.change(within(dialog).getByLabelText('Amount (₱)'), { target: { value: '2600' } });
      fireEvent.change(within(dialog).getByLabelText('Reason for this edit'), { target: { value: '  Wrong amount typed  ' } });
      const file = pdf('or-new.pdf');
      fireEvent.change(within(dialog).getByLabelText(/^Official receipt/), { target: { files: [file] } });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Update transaction' }));
      await waitFor(() => expect(financeMocks.updateTransaction).toHaveBeenCalledTimes(1));
      expect(financeMocks.updateTransaction.mock.calls[0][0]).toBe(7);
      expect(financeMocks.updateTransaction.mock.calls[0][1]).toMatchObject({ amount: 2600, edit_reason: 'Wrong amount typed', receipt_file: file });
      await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalledTimes(2));
    });

    it('does not need a new receipt file to edit, and shows the server answer when nothing changed', async () => {
      financeMocks.updateTransaction.mockRejectedValue({ response: { status: 422, data: { message: 'Nothing changed.' } } });
      const dialog = await openEdit();
      fireEvent.change(within(dialog).getByLabelText('Reason for this edit'), { target: { value: 'Checked again' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Update transaction' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nothing changed.');
      expect(financeMocks.updateTransaction.mock.calls[0][1].receipt_file).toBeNull();
    });
  });

  describe('Edited rows and the history', () => {
    it('marks an edited row with an Edited badge, who edited it and when, and leaves other rows plain', async () => {
      render(<FinancePage initialTab="transactions" />);
      const table = await screen.findByRole('table', { name: 'Ledger transactions' });
      const rows = within(table).getAllByRole('row');
      const editedRow = rows.find((row) => within(row).queryByText('Sound system rental'));
      const plainRow = rows.find((row) => within(row).queryByText('Venue reservation'));

      expect(within(editedRow).getByRole('button', { name: 'Edited' })).toBeInTheDocument();
      expect(editedRow).toHaveTextContent('by Maria Cruz on Nov 20, 2026');
      expect(within(plainRow).queryByRole('button', { name: 'Edited' })).not.toBeInTheDocument();
    });

    it('opens the history from the Edited badge, with who, when, why and each field from and to', async () => {
      render(<FinancePage initialTab="transactions" />);
      const table = await screen.findByRole('table', { name: 'Ledger transactions' });
      fireEvent.click(within(table).getByRole('button', { name: 'Edited' }));

      const dialog = await screen.findByRole('dialog', { name: 'Transaction history' });
      expect(financeMocks.getTransactionHistory).toHaveBeenCalledWith(8);
      expect(await within(dialog).findByText('Reason: Typed the wrong amount')).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Edited by Maria Cruz');
      expect(dialog).toHaveTextContent('Amount');
      expect(dialog).toHaveTextContent('1,000.00');
      expect(dialog).toHaveTextContent('1,200.00');
    });

    it('opens the same history from View history in the row menu', async () => {
      render(<FinancePage initialTab="transactions" />);
      fireEvent.click(await findRowAction('View history'));

      expect(await screen.findByRole('dialog', { name: 'Transaction history' })).toBeInTheDocument();
      expect(financeMocks.getTransactionHistory).toHaveBeenCalled();
    });

    it('lets a role that cannot write open the history from the badge but gives it no row menu', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
      render(<FinancePage initialTab="transactions" />);
      const table = await screen.findByRole('table', { name: 'Ledger transactions' });

      expect(within(table).queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
      fireEvent.click(within(table).getByRole('button', { name: 'Edited' }));
      expect(await screen.findByRole('dialog', { name: 'Transaction history' })).toBeInTheDocument();
    });
  });

  describe('Row menu and archive', () => {
    it('offers Edit, View history, View receipt (only with a kept file) and Archive, and no Delete', async () => {
      render(<FinancePage initialTab="transactions" />);
      const triggers = await screen.findAllByRole('button', { name: /^Actions for/ });
      const labels = (trigger) => {
        fireEvent.click(trigger);
        const names = screen.getAllByRole('menuitem').map((item) => item.textContent);
        fireEvent.click(trigger);
        return names;
      };
      const [plainActions, editedActions] = [triggers.find((t) => t.getAttribute('aria-label') === 'Actions for Venue reservation'), triggers.find((t) => t.getAttribute('aria-label') === 'Actions for Sound system rental')].map(labels);

      expect(plainActions).toEqual(['Edit transaction', 'View history', 'Archive transaction']);
      expect(editedActions).toEqual(['Edit transaction', 'View history', 'View receipt', 'Archive transaction']);
      expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument();
    });

    it('opens the kept receipt through the protected download', async () => {
      render(<FinancePage initialTab="transactions" />);
      fireEvent.click(await findRowAction('View receipt'));

      await waitFor(() => expect(fileMocks.openProtectedFile).toHaveBeenCalledWith('/transactions/8/receipt-file'));
    });

    it('archives only once a reason of five characters is given, and sends that reason', async () => {
      render(<FinancePage initialTab="transactions" />);
      fireEvent.click(await findRowAction('Archive transaction', 'Venue reservation'));
      const dialog = await screen.findByRole('dialog', { name: 'Archive this transaction?' });
      const confirm = within(dialog).getByRole('button', { name: 'Archive transaction' });

      expect(confirm).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Reason for archiving'), { target: { value: 'oops' } });
      expect(confirm).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Reason for archiving'), { target: { value: 'Recorded twice' } });
      fireEvent.click(confirm);

      await waitFor(() => expect(financeMocks.archiveTransaction).toHaveBeenCalledWith(7, 'Recorded twice'));
      await waitFor(() => expect(financeMocks.getTransactions).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('dialog', { name: 'Archive this transaction?' })).not.toBeInTheDocument();
    });

    it('keeps the modal open with the server refusal when the entry cannot be archived', async () => {
      financeMocks.archiveTransaction.mockRejectedValue({ response: { status: 409, data: { message: 'This entry is in a submitted report.' } } });
      render(<FinancePage initialTab="transactions" />);
      fireEvent.click(await findRowAction('Archive transaction', 'Venue reservation'));
      const dialog = await screen.findByRole('dialog', { name: 'Archive this transaction?' });
      fireEvent.change(within(dialog).getByLabelText('Reason for archiving'), { target: { value: 'Recorded twice' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Archive transaction' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This entry is in a submitted report.');
      expect(financeMocks.getTransactions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Show archived', () => {
    async function showArchived() {
      financeMocks.getTransactions.mockImplementation((params) => Promise.resolve(params?.archived ? page([archivedRow]) : page([plain, edited])));
      render(<FinancePage initialTab="transactions" />);
      await screen.findByRole('table', { name: 'Ledger transactions' });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }));
      return screen.findAllByText('Duplicate snacks');
    }

    it('asks the server for archived rows only and never sends the switch to the totals', async () => {
      await showArchived();

      expect(financeMocks.getTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, archived: '1' }));
      const summaryCalls = financeMocks.getTransactionSummary.mock.calls.map(([query]) => query);
      expect(summaryCalls.every((query) => !('archived' in query))).toBe(true);
    });

    it('lists archived rows read only with an Archived badge, who archived it, when and why', async () => {
      await showArchived();
      const table = await screen.findByRole('table', { name: 'Ledger transactions' });
      const row = within(table).getAllByRole('row').find((candidate) => within(candidate).queryByText('Duplicate snacks'));

      expect(within(row).getByText('Archived')).toBeInTheDocument();
      expect(row).toHaveTextContent('by Maria Cruz on Nov 21, 2026');
      expect(row).toHaveTextContent('Reason: Recorded twice');
      fireEvent.click(within(row).getByRole('button', { name: /^Actions for/ }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['View history', 'View receipt']);
    });

    it('swaps the totals strip for a note that archived rows are not counted, and goes back with the switch', async () => {
      await showArchived();

      expect(screen.getByText('Archived entries are on record only. They are read only and are not counted in any total.')).toBeInTheDocument();
      expect(screen.queryByText('Net balance')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }));
      expect(await screen.findByText('Net balance')).toBeInTheDocument();
      expect((await screen.findAllByText('Venue reservation')).length).toBeGreaterThan(0);
    });
  });

  describe('Record transaction with an event preset and locked', () => {
    it('presets the event and locks it, so the entry stays in that event\'s own ledger', async () => {
      render(<FinancePage initialTab="transactions" startRecord={{ eventId: 4, lockEvent: true }} />);
      const dialog = await screen.findByRole('dialog', { name: 'Record transaction' });
      await waitFor(() => expect(within(dialog).getByLabelText(/^Linked event/)).toHaveValue('4'));

      expect(within(dialog).getByLabelText(/^Linked event/)).toBeDisabled();
      expect(within(dialog).getByText('This entry stays in the ledger of this event.')).toBeInTheDocument();

      fillBasics(dialog);
      fireEvent.change(within(dialog).getByLabelText(/^Official receipt/), { target: { files: [pdf()] } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }));
      await waitFor(() => expect(financeMocks.createTransaction).toHaveBeenCalledTimes(1));
      expect(financeMocks.createTransaction.mock.calls[0][0]).toMatchObject({ event_id: '4' });
    });

    it('only presets the event when it is not locked, so it can still be changed', async () => {
      render(<FinancePage initialTab="transactions" startRecord={{ eventId: 4 }} />);
      const dialog = await screen.findByRole('dialog', { name: 'Record transaction' });
      await waitFor(() => expect(within(dialog).getByLabelText(/^Linked event/)).toHaveValue('4'));

      expect(within(dialog).getByLabelText(/^Linked event/)).toBeEnabled();
    });

    it('opens a plain form, with no event locked, from the Record transaction button', async () => {
      render(<FinancePage initialTab="transactions" />);
      const dialog = await openRecordForm();

      expect(within(dialog).getByLabelText(/^Linked event/)).toBeEnabled();
      expect(within(dialog).getByLabelText(/^Linked event/)).toHaveValue('');
    });
  });
});
