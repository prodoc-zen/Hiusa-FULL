import { findRowAction } from '../../test/rowActions';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReportDetailDrawer from './ReportDetailDrawer';

const openMocks = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../utils/openProtectedFile', () => openMocks);

const report = {
  id: 8,
  title: 'September Income Statement',
  document_type: 'income_statement',
  submission_status: 'rejected',
  supporting_documents: [{ index: 0, name: 'receipts.pdf', open_url: '/financial-reports/8/documents/0' }],
};

describe('ReportDetailDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a returned report’s submitted file and opens it for the admin', async () => {
    render(<ReportDetailDrawer report={report} viewerRole="ADMIN" onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getAllByText('receipts.pdf').length).toBeGreaterThan(0);
    expect(screen.getByText('Resubmit for review')).toBeInTheDocument();
    fireEvent.click(await findRowAction('View file'));
    await waitFor(() => expect(openMocks.openProtectedFile).toHaveBeenCalledWith('/financial-reports/8/documents/0'));
  });
});
