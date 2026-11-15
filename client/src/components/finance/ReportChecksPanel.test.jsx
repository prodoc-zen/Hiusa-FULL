import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReportChecksPanel from './ReportChecksPanel';

const finance = vi.hoisted(() => ({
  getReportChecks: vi.fn(),
  explainReportChecks: vi.fn(),
  ignoreReportCheck: vi.fn(),
}));
const draft = vi.hoisted(() => ({ recordAiOutcome: vi.fn() }));

vi.mock('../../services/financeService', () => finance);
vi.mock('../../services/aiDraftService', () => draft);

const receipt = { key: 'missing_receipt:11', code: 'missing_receipt', severity: 'medium', message: 'The expense of PHP 1,200.50 for Supplies on Sep 2, 2026 has no receipt reference.', ignored: null };
const overspent = { key: 'budget_overspent:3', code: 'budget_overspent', severity: 'high', message: 'Budget "Foundation Day budget" is over by PHP 200.50. It was allocated PHP 1,000.00.', ignored: null };

describe('ReportChecksPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finance.getReportChecks.mockResolvedValue({ data: { findings: [overspent, receipt] } });
    draft.recordAiOutcome.mockResolvedValue({});
  });

  it('lists what the checks found with how urgent each is', async () => {
    render(<ReportChecksPanel reportId={8} canIgnore />);

    expect(await screen.findByText(overspent.message)).toBeInTheDocument();
    expect(screen.getByText(receipt.message)).toBeInTheDocument();
    expect(screen.getByText('Fix first')).toBeInTheDocument();
    expect(screen.getByText('Check')).toBeInTheDocument();
    expect(screen.getByText(/do not stop you from sending/)).toBeInTheDocument();
    expect(finance.getReportChecks).toHaveBeenCalledWith(8);
  });

  it('says plainly when nothing was found and offers no explanation', async () => {
    finance.getReportChecks.mockResolvedValue({ data: { findings: [] } });
    render(<ReportChecksPanel reportId={8} canIgnore />);

    expect(await screen.findByText('The checks found nothing to fix.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explain and put in order' })).not.toBeInTheDocument();
  });

  it('keeps the page usable when the checks cannot be loaded', async () => {
    finance.getReportChecks.mockRejectedValue(new Error('offline'));
    render(<ReportChecksPanel reportId={8} canIgnore />);

    expect(await screen.findByText(/The checks could not be loaded/)).toBeInTheDocument();
    finance.getReportChecks.mockResolvedValue({ data: { findings: [receipt] } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(receipt.message)).toBeInTheDocument();
  });

  it('puts the findings in the order of the explanation, shows the engine and the draft line, and reports it up', async () => {
    const onExplained = vi.fn();
    finance.explainReportChecks.mockResolvedValue({ data: {
      engine: 'claude', ai_output_id: 44, text: 'summary and lines',
      summary: 'There are 2 things to check. Fix the receipt first.',
      items: [{ key: 'missing_receipt:11', sentence: 'Add the receipt reference for the PHP 1,200.50 Supplies expense.' }, { key: 'budget_overspent:3', sentence: 'Foundation Day budget is over by PHP 200.50.' }],
    } });
    render(<ReportChecksPanel reportId={8} canIgnore onExplained={onExplained} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Explain and put in order' }));

    expect(await screen.findByText('There are 2 things to check. Fix the receipt first.')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText('Draft. Read and edit before you send.')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toContain('Add the receipt reference');
    expect(rows[1]).toContain('Foundation Day budget is over by PHP 200.50.');
    expect(onExplained).toHaveBeenCalledWith({ aiOutputId: 44, text: 'summary and lines' });
  });

  it('keeps the rules list when the explanation fails', async () => {
    finance.explainReportChecks.mockRejectedValue({ response: { data: { message: 'Too many requests.' } } });
    render(<ReportChecksPanel reportId={8} canIgnore />);

    fireEvent.click(await screen.findByRole('button', { name: 'Explain and put in order' }));

    expect(await screen.findByText('Too many requests.')).toBeInTheDocument();
    expect(screen.getByText(overspent.message)).toBeInTheDocument();
  });

  it('records that the explanation was dropped when it is hidden', async () => {
    const onExplained = vi.fn();
    finance.explainReportChecks.mockResolvedValue({ data: { engine: 'template', ai_output_id: 45, text: 't', summary: 'The checks found 2 things to look at before you send this report.', items: [] } });
    render(<ReportChecksPanel reportId={8} canIgnore onExplained={onExplained} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Explain and put in order' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Hide the explanation' }));

    expect(draft.recordAiOutcome).toHaveBeenCalledWith(45, null);
    expect(onExplained).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('Draft. Read and edit before you send.')).not.toBeInTheDocument();
  });

  it('sets a finding aside only with a typed reason and shows the reason afterwards', async () => {
    finance.ignoreReportCheck.mockResolvedValue({ data: { findings: [overspent, { ...receipt, ignored: { reason: 'Paid in cash, no receipt was issued.' } }] } });
    render(<ReportChecksPanel reportId={8} canIgnore />);
    const row = (await screen.findByText(receipt.message)).closest('li');

    fireEvent.click(within(row).getByRole('button', { name: 'Ignore with a reason' }));
    const confirm = within(row).getByRole('button', { name: 'Ignore this check' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(row).getByLabelText('Why can this be ignored?'), { target: { value: 'Paid in cash, no receipt was issued.' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(finance.ignoreReportCheck).toHaveBeenCalledWith(8, 'missing_receipt:11', 'Paid in cash, no receipt was issued.'));
    expect(await screen.findByText('Reason: Paid in cash, no receipt was issued.')).toBeInTheDocument();
    expect(screen.getByText('Set aside')).toBeInTheDocument();
  });

  it('offers no way to ignore a finding to a viewer who cannot', async () => {
    render(<ReportChecksPanel reportId={8} heading="Checks on this report" />);

    expect(await screen.findByText(receipt.message)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Checks on this report' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ignore with a reason' })).not.toBeInTheDocument();
  });
});
