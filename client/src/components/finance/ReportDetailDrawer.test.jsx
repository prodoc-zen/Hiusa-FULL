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
