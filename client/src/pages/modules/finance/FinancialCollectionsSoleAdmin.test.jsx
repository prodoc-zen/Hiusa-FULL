import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialCollectionsPage from './FinancialCollectionsPage';

const mocks = vi.hoisted(() => ({
  getFinancialDashboard: vi.fn(), getCollections: vi.fn(), createCollection: vi.fn(), verifyCollection: vi.fn(), recordRemittance: vi.fn(), getCashAdvances: vi.fn(),
}));
vi.mock('../../../services/financeService', () => mocks);

const dashboard = (overrides) => ({ data: { available_funds: 0, total_collections: 0, total_remitted: 0, unremitted_collections: 0, admin_count: 1, second_admin_named_by: 'Department Head', ...overrides } });
const SOLE = /You are the only admin/;

function renderPage() {
  return render(<MemoryRouter><FinancialCollectionsPage /></MemoryRouter>);
}

describe('FinancialCollectionsPage with one admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', school_id: 10 }));
    mocks.getCollections.mockResolvedValue({ data: [{ id: 1, source: 'Dues', reference: 'COL-1', status: 'pending', amount_collected: 100, collected_by: 10, unremitted_balance: 100, total_remitted: 0 }] });
    mocks.getCashAdvances.mockResolvedValue({ data: [] });
  });

  it('says in one line that the only admin cannot approve their own, and names the Department Head', async () => {
    mocks.getFinancialDashboard.mockResolvedValue(dashboard());
    renderPage();

    const notice = await screen.findByText(SOLE);
    expect(notice).toHaveTextContent('You are the only admin, so you cannot verify your own collections or approve your own cash advances. Ask your Department Head to name a second organization head under People and access.');
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
  });

  it('names the SAO for a university-wide organization', async () => {
    mocks.getFinancialDashboard.mockResolvedValue(dashboard({ second_admin_named_by: 'SAO' }));
    renderPage();

    expect(await screen.findByText(/Ask your SAO to name a second organization head/)).toBeInTheDocument();
  });

  it('says nothing when there is a second admin', async () => {
    mocks.getFinancialDashboard.mockResolvedValue(dashboard({ admin_count: 2 }));
    renderPage();

    expect((await screen.findAllByText('Dues')).length).toBeGreaterThan(0);
    expect(screen.queryByText(SOLE)).not.toBeInTheDocument();
  });

  it('says nothing while the page is still loading', async () => {
    mocks.getFinancialDashboard.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(await screen.findByText('Collections')).toBeInTheDocument();
    expect(screen.queryByText(SOLE)).not.toBeInTheDocument();
  });

  it('says nothing when the server does not report an admin count', async () => {
    mocks.getFinancialDashboard.mockResolvedValue(dashboard({ admin_count: null, second_admin_named_by: null }));
    renderPage();

    expect((await screen.findAllByText('Dues')).length).toBeGreaterThan(0);
    expect(screen.queryByText(SOLE)).not.toBeInTheDocument();
  });
});
