import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionHistoryModal from './TransactionHistoryModal';

const serviceMocks = vi.hoisted(() => ({ getTransactionHistory: vi.fn() }));
vi.mock('../../services/financeService', () => serviceMocks);

const transaction = { id: 12, description: 'Sound system rental' };

const history = [
  {
    action: 'updated',
    at: '2026-11-20T06:30:00.000000Z',
    by: { user_id: 3, name: 'Maria Cruz' },
    reason: 'Typed the wrong amount',
    changes: [
      { field: 'amount', label: 'Amount', from: '1,000.00', to: '1,200.00' },
      { field: 'receipt_reference', label: 'Receipt reference', from: null, to: 'OR 5521' },
    ],
  },
  { action: 'created', at: '2026-11-18T02:00:00.000000Z', by: { user_id: 3, name: 'Maria Cruz' }, reason: null, changes: [] },
];

describe('TransactionHistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists who changed the entry, when, why, and each field from its old value to its new one', async () => {
    serviceMocks.getTransactionHistory.mockResolvedValue({ data: { data: history } });
    render(<TransactionHistoryModal transaction={transaction} onClose={vi.fn()} />);

    const list = await screen.findByRole('list', { name: 'History' });
    expect(serviceMocks.getTransactionHistory).toHaveBeenCalledWith(12);
    const [edited, recorded] = within(list).getAllByRole('listitem').filter((item) => item.parentElement === list);
    expect(edited).toHaveTextContent('Edited by Maria Cruz on Nov 20, 2026, 2:30 PM');
    expect(edited).toHaveTextContent('Reason: Typed the wrong amount');
    expect(edited).toHaveTextContent('Amount');
    expect(edited).toHaveTextContent('1,000.00');
    expect(edited).toHaveTextContent('1,200.00');
    expect(edited).toHaveTextContent('Receipt reference');
    expect(edited).toHaveTextContent('Empty');
    expect(edited).toHaveTextContent('OR 5521');
    expect(recorded).toHaveTextContent('Recorded by Maria Cruz on Nov 18, 2026');
  });

  it('shows an archive entry with its reason', async () => {
    serviceMocks.getTransactionHistory.mockResolvedValue({ data: { data: [{ action: 'archived', at: '2026-11-21T01:00:00Z', by: { user_id: 3, name: 'Maria Cruz' }, reason: 'Recorded twice', changes: [] }] } });
    render(<TransactionHistoryModal transaction={transaction} onClose={vi.fn()} />);

    expect(await screen.findByText(/Archived/)).toBeInTheDocument();
    expect(screen.getByText('Reason: Recorded twice')).toBeInTheDocument();
  });

  it('says so when there is no history', async () => {
    serviceMocks.getTransactionHistory.mockResolvedValue({ data: { data: [] } });
    render(<TransactionHistoryModal transaction={transaction} onClose={vi.fn()} />);

    expect(await screen.findByText('No history is on record for this entry yet.')).toBeInTheDocument();
  });

  it('shows the failure and can try again', async () => {
    serviceMocks.getTransactionHistory
      .mockRejectedValueOnce({ response: { status: 500, data: { message: 'Server error.' } } })
      .mockResolvedValueOnce({ data: { data: history } });
    render(<TransactionHistoryModal transaction={transaction} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'History' })).toBeInTheDocument());
    expect(serviceMocks.getTransactionHistory).toHaveBeenCalledTimes(2);
  });

  it('closes from the footer button', async () => {
    serviceMocks.getTransactionHistory.mockResolvedValue({ data: { data: history } });
    const onClose = vi.fn();
    render(<TransactionHistoryModal transaction={transaction} onClose={onClose} />);

    await screen.findByRole('list', { name: 'History' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1));
    expect(onClose).toHaveBeenCalled();
  });
});
