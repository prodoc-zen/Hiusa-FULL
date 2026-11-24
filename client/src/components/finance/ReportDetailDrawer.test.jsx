import { findRowAction } from '../../test/rowActions';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReportDetailDrawer from './ReportDetailDrawer';

const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
const finance = vi.hoisted(() => ({ getReportChecks: vi.fn(), explainReportChecks: vi.fn(), ignoreReportCheck: vi.fn() }));
const draft = vi.hoisted(() => ({ recordAiOutcome: vi.fn() }));
vi.mock('../../utils/openProtectedFile', () => openMocks);
vi.mock('../../services/financeService', () => finance);
vi.mock('../../services/aiDraftService', () => draft);

const report = {
  id: 8,
  title: 'September Income Statement',
  document_type: 'income_statement',
  submission_status: 'rejected',
  supporting_documents: [{ index: 0, name: 'receipts.pdf', open_url: '/financial-reports/8/documents/0' }],
};

describe('ReportDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finance.getReportChecks.mockResolvedValue({ data: { findings: [{ key: 'missing_receipt:11', code: 'missing_receipt', severity: 'medium', message: 'The expense of PHP 90.00 for Supplies on Sep 2, 2026 has no receipt reference.', ignored: null }] } });
    draft.recordAiOutcome.mockResolvedValue({});
  });

  it('shows a returned report’s submitted file and opens it for the admin', async () => {
    render(<ReportDetailDrawer report={report} viewerRole="ADMIN" onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getAllByText('receipts.pdf').length).toBeGreaterThan(0);
    expect(screen.getByText('Resubmit for review')).toBeInTheDocument();
    fireEvent.click(await findRowAction('View file'));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/financial-reports/8/documents/0'));
  });

  describe('before you send', () => {
    const unsent = { id: 9, title: 'October report', document_type: 'financial_report', submission_status: 'draft' };
    const explanation = { engine: 'claude', ai_output_id: 52, text: 'summary', summary: 'There is 1 thing to check.', items: [{ key: 'missing_receipt:11', sentence: 'Add the receipt reference.' }] };

    it('shows the checks to the Admin of a draft, with a way to ignore one', async () => {
      render(<ReportDetailDrawer report={unsent} viewerRole="ADMIN" onClose={vi.fn()} onSubmit={vi.fn()} />);

      expect(await screen.findByText(/has no receipt reference/)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Before you send' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ignore with a reason' })).toBeInTheDocument();
      expect(finance.getReportChecks).toHaveBeenCalledWith(9);
    });

    it('lets an officer read the checks but not ignore them', async () => {
      render(<ReportDetailDrawer report={unsent} viewerRole="SBO_OFFICER" onClose={vi.fn()} />);

      expect(await screen.findByText(/has no receipt reference/)).toBeInTheDocument();
      const ignore = screen.getByRole('button', { name: 'Ignore with a reason' });
      expect(ignore).toBeDisabled();
      expect(ignore).toHaveAttribute('title', 'An Admin decides which checks to ignore');
    });

    it('shows an officer without the finance switch the Submit button switched off, with the reason', () => {
      render(<ReportDetailDrawer report={unsent} viewerRole="SBO_OFFICER" onClose={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
      expect(screen.getByText('An Admin submits reports')).toBeInTheDocument();
    });

    it('shows a finance officer the Ignore button switched off, with the reason', async () => {
      render(<ReportDetailDrawer report={unsent} viewerRole="SBO_OFFICER" onClose={vi.fn()} />);

      const ignore = await screen.findByRole('button', { name: 'Ignore with a reason' });
      expect(ignore).toBeDisabled();
      expect(ignore).toHaveAttribute('title', 'An Admin decides which checks to ignore');
    });

    it('shows a finance officer the Submit button switched off, with the reason', () => {
      render(<ReportDetailDrawer report={unsent} viewerRole="SBO_OFFICER" onClose={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
      expect(screen.getByText('An Admin submits reports')).toBeInTheDocument();
    });

    it('asks nothing of a report that is already with the reviewers', () => {
      render(<ReportDetailDrawer report={{ ...unsent, submission_status: 'pending_sao' }} viewerRole="ADMIN" onClose={vi.fn()} />);

      expect(screen.queryByRole('region', { name: 'Before you send' })).not.toBeInTheDocument();
      expect(finance.getReportChecks).not.toHaveBeenCalled();
    });

    it('records the explanation as used once the report is sent', async () => {
      finance.explainReportChecks.mockResolvedValue({ data: explanation });
      const onSubmit = vi.fn().mockResolvedValue(true);
      render(<ReportDetailDrawer report={unsent} viewerRole="ADMIN" onClose={vi.fn()} onSubmit={onSubmit} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Explain and put in order' }));
      await screen.findByText('There is 1 thing to check.');

      fireEvent.click(screen.getByText('Submit for review'));

      await waitFor(() => expect(draft.recordAiOutcome).toHaveBeenCalledWith(52, 'summary'));
    });

    it('records nothing when the send fails', async () => {
      finance.explainReportChecks.mockResolvedValue({ data: explanation });
      const onSubmit = vi.fn().mockResolvedValue(false);
      render(<ReportDetailDrawer report={unsent} viewerRole="ADMIN" onClose={vi.fn()} onSubmit={onSubmit} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Explain and put in order' }));
      await screen.findByText('There is 1 thing to check.');

      fireEvent.click(screen.getByText('Submit for review'));

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(draft.recordAiOutcome).not.toHaveBeenCalled();
    });
  });

  describe('picking supporting files', () => {
    const draft = { id: 9, title: 'October report', document_type: 'financial_report', submission_status: 'draft' };
    const pick = (files) => {
      const onFilesChange = vi.fn();
      render(<ReportDetailDrawer report={draft} viewerRole="ADMIN" onClose={vi.fn()} onSubmit={vi.fn()} onFilesChange={onFilesChange} />);
      fireEvent.change(screen.getByLabelText('Supporting documents for October report'), { target: { files } });
      return onFilesChange;
    };
    const fileOf = (name, bytes = 1000) => Object.defineProperty(new File(['x'], name), 'size', { value: bytes });

    it('says a file of the wrong type cannot be attached and attaches nothing', () => {
      const onFilesChange = pick([fileOf('setup.exe')]);

      expect(screen.getByRole('alert')).toHaveTextContent('setup.exe is not a PDF, JPG, PNG, Word or Excel file.');
      expect(onFilesChange).not.toHaveBeenCalled();
    });

    it('says a file over 10 MB cannot be attached', () => {
      const onFilesChange = pick([fileOf('scan.pdf', 10 * 1024 * 1024 + 1)]);

      expect(screen.getByRole('alert')).toHaveTextContent('scan.pdf is larger than 10 MB.');
      expect(onFilesChange).not.toHaveBeenCalled();
    });

    it('says more than ten files cannot be attached', () => {
      const onFilesChange = pick(Array.from({ length: 11 }, (_, n) => fileOf(`proof${n}.pdf`)));

      expect(screen.getByRole('alert')).toHaveTextContent('Attach no more than 10 supporting files.');
      expect(onFilesChange).not.toHaveBeenCalled();
    });

    it('attaches ten files of exactly 10 MB each without a complaint', () => {
      const picked = Array.from({ length: 10 }, (_, n) => fileOf(`proof${n}.pdf`, 10 * 1024 * 1024));
      const onFilesChange = pick(picked);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(onFilesChange).toHaveBeenCalledWith(picked);
    });
  });
});
