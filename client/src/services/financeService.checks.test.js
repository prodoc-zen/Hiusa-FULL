import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import {
  explainReportChecks,
  getFinancialReportDeadline,
  getReportChecks,
  ignoreReportCheck,
  setFinancialReportDeadline,
} from './financeService';

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

describe('report check and due date services', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the findings fresh, because they decide the next click', () => {
    getReportChecks(8);

    expect(api.get).toHaveBeenCalledWith('/financial-reports/8/checks', { cache: false });
  });

  it('asks for the explanation and sends the reason for ignoring a finding', () => {
    explainReportChecks(8);
    ignoreReportCheck(8, 'missing_receipt:11', 'Paid in cash.');

    expect(api.post).toHaveBeenCalledWith('/financial-reports/8/checks/explain');
    expect(api.post).toHaveBeenCalledWith('/financial-reports/8/checks/ignore', { key: 'missing_receipt:11', reason: 'Paid in cash.' });
  });

  it('reads and writes the due date', () => {
    getFinancialReportDeadline();
    setFinancialReportDeadline('2026-12-15', true);

    expect(api.get).toHaveBeenCalledWith('/financial-report-deadline', { cache: false });
    expect(api.put).toHaveBeenCalledWith('/financial-report-deadline', { deadline_at: '2026-12-15', new_round: true });
  });
});
