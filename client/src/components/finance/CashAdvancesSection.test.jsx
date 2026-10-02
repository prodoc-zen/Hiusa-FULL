import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CashAdvancesSection from './CashAdvancesSection';
import { approveCashAdvance, createCashAdvance, getCashAdvances, releaseCashAdvance, repayCashAdvance } from '../../services/financeService';

vi.mock('../../services/financeService', () => ({
  getCashAdvances: vi.fn(),
  createCashAdvance: vi.fn(),
  approveCashAdvance: vi.fn(),
  releaseCashAdvance: vi.fn(),
  repayCashAdvance: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const advance = (id, status, extra = {}) => ({
  id,
  status,
  reference: `ADV-${id}`,
  purpose: `Venue deposit ${id}`,
  amount: '500.00',
  amount_repaid: 0,
  remaining_balance: 500,
  borrower_id: 900002,
  borrower: { school_id: 900002, first_name: 'Ana', last_name: 'Reyes' },
  created_at: '2026-10-01T08:00:00Z',
  ...extra,
});

describe('CashAdvancesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 900001 }));
  });

  it('offers the next step for each stage and hides approval on your own request', async () => {
    vi.mocked(getCashAdvances).mockResolvedValue({ data: [
      advance(1, 'pending'),
      advance(2, 'pending', { borrower_id: 900001, borrower: { school_id: 900001, first_name: 'Marco', last_name: 'Cruz' } }),
      advance(3, 'approved'),
      advance(4, 'partially_repaid', { amount_repaid: 200, remaining_balance: 300 }),
      advance(5, 'fully_repaid', { amount_repaid: 500, remaining_balance: 0 }),
    ] });
    render(<CashAdvancesSection />);

    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(rows[1]).getByText('Another admin approves your request.')).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[2]).getByRole('button', { name: 'Release funds' })).toBeInTheDocument();
    expect(within(rows[3]).getByRole('button', { name: 'Record repayment' })).toBeInTheDocument();
    expect(within(rows[3]).getByText('₱300.00 outstanding')).toBeInTheDocument();
    expect(within(rows[4]).queryByRole('button')).not.toBeInTheDocument();
  });

  it('approves, releases after confirmation, and records a repayment, refreshing the ledger totals', async () => {
    const onLedgerChange = vi.fn();
    vi.mocked(getCashAdvances).mockResolvedValue({ data: [advance(1, 'pending'), advance(3, 'approved'), advance(4, 'released')] });
    vi.mocked(approveCashAdvance).mockResolvedValue({ data: {} });
    vi.mocked(releaseCashAdvance).mockResolvedValue({ data: {} });
    vi.mocked(repayCashAdvance).mockResolvedValue({ data: {} });
    render(<CashAdvancesSection onLedgerChange={onLedgerChange} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveCashAdvance).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole('button', { name: 'Release funds' }));
    const confirm = await screen.findByRole('dialog', { name: 'Release funds' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Release funds' }));
    await waitFor(() => expect(releaseCashAdvance).toHaveBeenCalledWith(3));

    fireEvent.click(screen.getByRole('button', { name: 'Record repayment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record repayment' });
    fireEvent.change(within(dialog).getByLabelText(/Amount repaid/), { target: { value: '150' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record repayment' }));
    await waitFor(() => expect(repayCashAdvance).toHaveBeenCalledWith(4, { amount: '150', notes: null }));
    expect(onLedgerChange).toHaveBeenCalledTimes(2);
  });

  it('submits a request and keeps the dialog open with the reason when it is refused', async () => {
    vi.mocked(getCashAdvances).mockResolvedValue({ data: [] });
    vi.mocked(createCashAdvance).mockRejectedValueOnce({ response: { status: 422, data: { message: 'The selected event does not belong to this organization.' } } }).mockResolvedValue({ data: {} });
    render(<CashAdvancesSection />);

    expect(await screen.findByText(/No cash advances yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request cash advance' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request cash advance' });
    fireEvent.change(within(dialog).getByLabelText(/Amount/), { target: { value: '750' } });
    fireEvent.change(within(dialog).getByLabelText(/Purpose/), { target: { value: '  Sound system rental  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('does not belong to this organization');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request cash advance' })).not.toBeInTheDocument());
    expect(createCashAdvance).toHaveBeenLastCalledWith({ amount: '750', purpose: 'Sound system rental', notes: null });
  });
});
