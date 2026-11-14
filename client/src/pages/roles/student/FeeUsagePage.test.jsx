import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import FeeUsagePage from './FeeUsagePage';

const mocks = vi.hoisted(() => ({ getFeeUsage: vi.fn() }));
vi.mock('../../../services/feeUsageService', () => mocks);

const first = {
  id: 11,
  title: 'Financial Report - AY 2026-2027, 1st Semester',
  period_label: '1st Semester, AY 2026-2027',
  period_start: '2026-08-01',
  period_end: '2026-12-31',
  approved_at: '2026-11-03T02:00:00+00:00',
  totals: { collected: 12500, spent: 5000, opening: 1000.5, advances: 0, balance: 8500.5 },
  spending: [
    { category: 'Events', amount: 3750, share_percent: 75 },
    { category: 'Supplies', amount: 1250, share_percent: 25 },
  ],
  income: [
    { category: 'Membership fee', amount: 10000 },
    { category: 'Merchandise', amount: 2500 },
  ],
};
const second = {
  id: 7,
  title: 'Financial Report - Custom',
  period_label: 'Aug 1 to Oct 31, 2026',
  period_start: '2026-08-01',
  period_end: '2026-10-31',
  approved_at: '2026-09-01T02:00:00+00:00',
  totals: { collected: 900, spent: 300, opening: 0, advances: 0, balance: 600 },
  spending: [{ category: 'Printing', amount: 300, share_percent: 100 }],
  income: [{ category: 'Donations', amount: 900 }],
};
const usage = (reports) => ({ data: { organization: { id: 1, name: 'Computer Society' }, reports } });

function renderPage() {
  return render(<MemoryRouter><FeeUsagePage /></MemoryRouter>);
}

describe('FeeUsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFeeUsage.mockResolvedValue(usage([first]));
  });

  it('shows a loading skeleton, then the report', async () => {
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading where your fees go' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Where your fees go' })).toBeInTheDocument();
    await screen.findByText('Collected');
    expect(screen.queryByRole('status', { name: 'Loading where your fees go' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry that loads the figures', async () => {
    mocks.getFeeUsage.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderPage();

    expect(await screen.findByText('Could not load where your fees go.')).toBeInTheDocument();
    mocks.getFeeUsage.mockResolvedValueOnce(usage([first]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Collected')).toBeInTheDocument();
    expect(mocks.getFeeUsage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Could not load where your fees go.')).not.toBeInTheDocument();
  });

  it('tells the student figures appear after the SAO approves a report when there is none', async () => {
    mocks.getFeeUsage.mockResolvedValue(usage([]));
    renderPage();

    expect(await screen.findByText('No approved report yet')).toBeInTheDocument();
    expect(screen.getByText("Figures appear here after the SAO approves the organization's financial report.")).toBeInTheDocument();
    expect(screen.queryByText('Collected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('treats a student without an organization as empty', async () => {
    mocks.getFeeUsage.mockResolvedValue({ data: { organization: null, reports: [] } });
    renderPage();

    expect(await screen.findByText('No approved report yet')).toBeInTheDocument();
  });

  it('renders one report with amounts and shares as text, largest first, and no period picker', async () => {
    renderPage();

    expect(await screen.findByText('₱12,500.00')).toBeInTheDocument();
    expect(screen.getByText('₱5,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱8,500.50')).toBeInTheDocument();

    const spending = screen.getByRole('heading', { name: 'Spending by category' }).closest('section');
    const bars = within(spending).getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual(['Events', 'Supplies']);
    expect(within(spending).getByText('₱3,750.00 · 75%')).toBeInTheDocument();
    expect(within(spending).getByText('₱1,250.00 · 25%')).toBeInTheDocument();

    const income = screen.getByRole('heading', { name: 'Where the money came from' }).closest('section');
    expect(within(income).getByText('Membership fee')).toBeInTheDocument();
    expect(within(income).getByText('₱10,000.00')).toBeInTheDocument();
    expect(within(income).getByText('₱2,500.00')).toBeInTheDocument();

    expect(screen.getByText(/Financial Report - AY 2026-2027, 1st Semester, 1st Semester, AY 2026-2027\. Approved by the SAO on November 3, 2026\./)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download|export|print/i })).not.toBeInTheDocument();
  });

  it('switches between two reports from a labelled period select, newest first', async () => {
    mocks.getFeeUsage.mockResolvedValue(usage([first, second]));
    renderPage();

    const select = await screen.findByRole('combobox', { name: 'Period' });
    expect(select).toHaveValue('11');
    expect(screen.getByText('₱12,500.00')).toBeInTheDocument();

    fireEvent.click(select);
    const options = within(screen.getByRole('listbox', { name: 'Dropdown options' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['1st Semester, AY 2026-2027', 'Aug 1 to Oct 31, 2026']);
    fireEvent.click(options[1]);

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('7'));
    expect(screen.getAllByText('₱900.00')).toHaveLength(2);
    expect(screen.getByText('₱300.00 · 100%')).toBeInTheDocument();
    expect(screen.getByText('Donations')).toBeInTheDocument();
    expect(screen.queryByText('Events')).not.toBeInTheDocument();
    expect(screen.queryByText('₱12,500.00')).not.toBeInTheDocument();
    expect(screen.getByText(/Approved by the SAO on September 1, 2026\./)).toBeInTheDocument();
  });

  it('says so when a report has no spending or income', async () => {
    mocks.getFeeUsage.mockResolvedValue(usage([{ ...second, totals: { collected: 0, spent: 0, opening: 100, advances: 0, balance: 100 }, spending: [], income: [] }]));
    renderPage();

    expect(await screen.findByText('This report has no spending.')).toBeInTheDocument();
    expect(screen.getByText('This report has no income.')).toBeInTheDocument();
  });

  it('shows the carried-over opening balance so the three figures reconcile', async () => {
    renderPage();

    expect(await screen.findByText('Includes ₱1,000.50 carried over from before this period')).toBeInTheDocument();
  });

  it('says closing balance when nothing was carried over and adds cash advances when there are some', async () => {
    mocks.getFeeUsage.mockResolvedValue(usage([second]));
    const { unmount } = renderPage();
    expect(await screen.findByText('Closing balance')).toBeInTheDocument();
    unmount();

    mocks.getFeeUsage.mockResolvedValue(usage([{ ...second, totals: { ...second.totals, advances: -200 } }]));
    renderPage();
    expect(await screen.findByText(/Includes .*in cash advances returned or lent out/)).toBeInTheDocument();
  });
});
