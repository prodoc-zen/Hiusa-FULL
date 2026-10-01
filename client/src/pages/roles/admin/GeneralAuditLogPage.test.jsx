import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralAuditLogPage from './GeneralAuditLogPage';
import { exportAuditLogs, getAuditLogs } from '../../../services/financeService';
import downloadBlob from '../../../utils/downloadBlob';

vi.mock('../../../services/financeService', () => ({ getAuditLogs: vi.fn(), exportAuditLogs: vi.fn() }));
vi.mock('../../../utils/downloadBlob', () => ({ default: vi.fn() }));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const page = {
  data: {
    data: [{ id: 9, created_at: '2026-10-01T08:00:00Z', module: 'events', module_label: 'Events', action_category_label: 'Update', subject: 'Foundation Week', description: 'Marco updated Foundation Week.', record_id: 4, actor: { name: 'Marco Dela Cruz', role: 'ADMIN' }, organization: { id: 1, name: 'Org Alpha' } }],
    total: 1,
    per_page: 10,
    current_page: 1,
  },
};

describe('GeneralAuditLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuditLogs).mockResolvedValue(page);
  });

  it('shows the SAO which organization each entry belongs to and no ledger module filters', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SUPER_ADMIN' }));
    render(<GeneralAuditLogPage />);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Organization' })).toBeInTheDocument();
    expect(within(table).getByText('Org Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Transactions/i })).not.toBeInTheDocument();
  });

  it('keeps the organization column off an organization admin view', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    render(<GeneralAuditLogPage />);

    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Organization' })).not.toBeInTheDocument();
  });

  it('exports every entry matching the current filters', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    vi.mocked(exportAuditLogs).mockResolvedValue({ data: new Blob(['csv']), headers: {} });
    render(<GeneralAuditLogPage />);

    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(exportAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ sort: 'newest', module: '' }));
  });
});
