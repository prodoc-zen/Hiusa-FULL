import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialCollectionsPage from './FinancialCollectionsPage';

const mocks = vi.hoisted(() => ({
  getFinancialDashboard: vi.fn(), getCollections: vi.fn(), createCollection: vi.fn(), verifyCollection: vi.fn(), recordRemittance: vi.fn(),
}));
vi.mock('../../../services/financeService', () => mocks);

describe('FinancialCollectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 10 }));
    mocks.getFinancialDashboard.mockResolvedValue({ data: { available_funds: 850, total_collections: 1000, total_remitted: 200, unremitted_collections: 800 } });
    mocks.getCollections.mockResolvedValue({ data: [
      { id: 1, source: 'Event fee', reference: 'COL-1', status: 'pending', amount_collected: 100, collected_by: 10, unremitted_balance: 100, total_remitted: 0 },
      { id: 2, source: 'Membership', reference: 'COL-2', status: 'verified', amount_collected: 1000, collected_by: 11, unremitted_balance: 800, total_remitted: 200 },
    ] });
  });

  it('shows custody totals without offering self verification', async () => {
    render(<FinancialCollectionsPage />);
    expect(await screen.findByText('Membership')).toBeInTheDocument();
    expect(screen.getByText('Awaiting remittance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remit' })).toBeInTheDocument();
  });

  it('records a partial remittance against the selected collection', async () => {
    mocks.recordRemittance.mockResolvedValue({ data: { id: 9 } });
    render(<FinancialCollectionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remit' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record remittance' }));
    await waitFor(() => expect(mocks.recordRemittance).toHaveBeenCalledWith(2, { amount: '250' }));
  });

  it('records a collection from the modal and shows validation errors there', async () => {
    mocks.createCollection.mockRejectedValueOnce({ response: { status: 422, data: { errors: { source: ['Source is required.'] } } } })
      .mockResolvedValueOnce({ data: { id: 3 } });
    render(<FinancialCollectionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record collection' }));
    const dialog = screen.getByRole('dialog', { name: 'Record collection' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Club fees' } });
    fireEvent.change(screen.getByLabelText('Amount collected'), { target: { value: '125.00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record collection' }));
    expect(await screen.findByText('Source is required.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record collection' }));
    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
