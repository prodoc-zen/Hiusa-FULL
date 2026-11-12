import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialCollectionsPage from './FinancialCollectionsPage';

const mocks = vi.hoisted(() => ({
  getFinancialDashboard: vi.fn(), getCollections: vi.fn(), createCollection: vi.fn(), verifyCollection: vi.fn(), recordRemittance: vi.fn(), getCashAdvances: vi.fn(),
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
    expect((await screen.findAllByText('Membership')).length).toBeGreaterThan(0);
    expect(screen.getByText('Awaiting remittance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remit' }).length).toBeGreaterThan(0);
  });

  it('says which figures cover every semester and which follow the one selected at the top', async () => {
    render(<FinancialCollectionsPage />);

    expect(await screen.findByText('Awaiting remittance')).toBeInTheDocument();
    expect(screen.getByText('Available funds and Awaiting remittance are running balances across all semesters. Remitted and the collections below follow the semester selected at the top.')).toBeInTheDocument();
  });

  it('asks in the app, not the browser, before verifying a collection', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    mocks.verifyCollection.mockResolvedValue({ data: { id: 1 } });
    mocks.getCollections.mockResolvedValue({ data: [
      { id: 1, source: 'Event fee', reference: 'COL-1', status: 'pending', amount_collected: 1000, collected_by: 11, unremitted_balance: 1000, total_remitted: 0 },
    ] });
    render(<FinancialCollectionsPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Verify' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Verify this collection?' });
    expect(within(dialog).getByText(/COL-1 for/)).toBeInTheDocument();
    expect(mocks.verifyCollection).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Verify this collection?' })).not.toBeInTheDocument();
    expect(mocks.verifyCollection).not.toHaveBeenCalled();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Verify' }))[0]);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Verify this collection?' })).getByRole('button', { name: 'Verify collection' }));
    await waitFor(() => expect(mocks.verifyCollection).toHaveBeenCalledWith(1));
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it('records a partial remittance against the selected collection', async () => {
    mocks.recordRemittance.mockResolvedValue({ data: { id: 9 } });
    render(<FinancialCollectionsPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remit' }))[0]);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record remittance' }));
    await waitFor(() => expect(mocks.recordRemittance).toHaveBeenCalledWith(2, { amount: '250' }));
  });

  it('records a collection from the drawer and shows validation errors there', async () => {
    mocks.createCollection.mockRejectedValueOnce({ response: { status: 422, data: { errors: { source: ['Source is required.'] } } } })
      .mockResolvedValueOnce({ data: { id: 3 } });
    render(<FinancialCollectionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record collection' }));
    const dialog = screen.getByRole('dialog', { name: 'Record collection' });
    expect(screen.getAllByRole('button', { name: 'Record collection' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Club fees' } });
    fireEvent.change(screen.getByLabelText('Amount collected'), { target: { value: '125.00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record collection' }));
    expect(await screen.findByText('Source is required.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record collection' }));
    await waitFor(() => expect(mocks.createCollection).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('FinancialCollectionsPage header and empty states', () => {
  const renderPage = () => render(<MemoryRouter initialEntries={['/dashboard/finance/collections']}><FinancialCollectionsPage /></MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 10 }));
    mocks.getFinancialDashboard.mockResolvedValue({ data: { available_funds: 0, total_collections: 0, total_remitted: 0, unremitted_collections: 0 } });
    mocks.getCollections.mockResolvedValue({ data: [] });
    mocks.getCashAdvances.mockResolvedValue({ data: [] });
  });

  it('uses the shared header: one h1 from the menu label, no lead line and one primary action', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Collections and advances' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText(/Track money received, its verification and remittance/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Record collection' })).toHaveLength(1);
  });

  it('explains what a collection is and what happens after it is recorded when there are none', async () => {
    renderPage();

    expect(await screen.findByText('No collections recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/Choose Record collection above; another admin then verifies it/)).toBeInTheDocument();
    expect(screen.queryByText('No collections match this status.')).not.toBeInTheDocument();
  });

  it('offers Clear filters when the status filter hides every collection', async () => {
    renderPage();
    await screen.findByText('No collections recorded yet');

    fireEvent.change(screen.getAllByLabelText('Status')[0], { target: { value: 'verified' } });
    expect(await screen.findByText('No collections match this status')).toBeInTheDocument();
    mocks.getCollections.mockResolvedValue({ data: [{ id: 2, source: 'Membership', reference: 'COL-2', status: 'verified', amount_collected: 1000, collected_by: 11, unremitted_balance: 0, total_remitted: 1000 }] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect((await screen.findAllByText('Membership')).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Status')[0]).toHaveValue('all');
  });
});
