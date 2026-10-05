import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { downloadFinancialReportPdf, generateFinancialReport, updateInvoiceStatus } from './financeService';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('financial report service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends document fields and the letterhead as multipart data', () => {
    const header = new File(['header'], 'letterhead.png', { type: 'image/png' });
    generateFinancialReport({
      document_type: 'income_statement',
      report_type: 'monthly',
      letterhead: header,
      signatories: { treasurer: 'Taylor Treasurer', president: 'Pat President' },
    });

    const [, formData] = api.post.mock.calls[0];
    expect(api.post).toHaveBeenCalledWith('/financial-reports/generate', expect.any(FormData));
    expect(formData.get('document_type')).toBe('income_statement');
    expect(formData.get('letterhead')).toBe(header);
    expect(formData.get('signatories[treasurer]')).toBe('Taylor Treasurer');
    expect(formData.get('signatories[president]')).toBe('Pat President');
  });

  it('requests the saved document as a PDF blob', () => {
    downloadFinancialReportPdf(41);
    expect(api.get).toHaveBeenCalledWith('/financial-reports/41/pdf', { responseType: 'blob' });
  });
});

describe('invoice service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels or waives an invoice with a reason through its status route', () => {
    updateInvoiceStatus(7, { status: 'waived', reason: 'Scholar excused from the fee.' });
    expect(api.patch).toHaveBeenCalledWith('/invoices/7/status', { status: 'waived', reason: 'Scholar excused from the fee.' });
  });
});
