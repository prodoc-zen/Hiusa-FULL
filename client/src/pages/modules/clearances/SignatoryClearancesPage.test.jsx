import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignatoryClearancesPage from './SignatoryClearancesPage';

const mocks = vi.hoisted(() => ({
  getClearancePeriods: vi.fn(),
  getClearanceSignatures: vi.fn(),
  updateClearanceSignature: vi.fn(),
}));

vi.mock('../../../services/clearanceService', () => ({
  getClearancePeriods: mocks.getClearancePeriods,
  getClearanceSignatures: mocks.getClearanceSignatures,
  updateClearanceSignature: mocks.updateClearanceSignature,
}));

function envelope(data) {
  return { data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } };
}

const PENDING_ROW = {
  id: 11,
  status: 'pending',
  remarks: null,
  required_role: 'organization_treasurer',
  student_id: 501,
  student: { first_name: 'Maria', last_name: 'Santos' },
  clearancePeriod: { id: 1, title: 'Second Semester Clearance', academic_year: '2026-2027' },
};

describe('SignatoryClearancesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClearancePeriods.mockResolvedValue(envelope([{ id: 1, title: 'Second Semester Clearance', academic_year: '2026-2027' }]));
  });

  it('shows a designed empty state when nothing is waiting for a signature', async () => {
    mocks.getClearanceSignatures.mockResolvedValue(envelope([]));
    render(<SignatoryClearancesPage />);
    expect(await screen.findByText('Nothing waiting on your signature')).toBeInTheDocument();
  });

  it('shows a retryable error state', async () => {
    mocks.getClearanceSignatures.mockRejectedValueOnce(new Error('down'));
    render(<SignatoryClearancesPage />);
    expect(await screen.findByText('Failed to load your clearance signing queue.')).toBeInTheDocument();

    mocks.getClearanceSignatures.mockResolvedValue(envelope([]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing waiting on your signature')).toBeInTheDocument();
  });

  it('holds a pending signature only after a reason is entered, then can clear the hold', async () => {
    mocks.getClearanceSignatures.mockResolvedValue(envelope([PENDING_ROW]));
    mocks.updateClearanceSignature.mockResolvedValue({ data: { ...PENDING_ROW, status: 'held', remarks: 'Unpaid dues.' } });

    render(<SignatoryClearancesPage />);
    const [row] = (await screen.findAllByText('Maria Santos')).map((el) => el.closest('tr') || el.closest('li'));
    fireEvent.click(within(row).getByRole('button', { name: 'Hold' }));

    const holdConfirm = screen.getByRole('button', { name: 'Hold this signature' });
    expect(holdConfirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'Unpaid dues.' } });
    expect(holdConfirm).not.toBeDisabled();
    fireEvent.click(holdConfirm);

    await waitFor(() => expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(11, { status: 'held', remarks: 'Unpaid dues.' }));
  });

  it('bulk-clears every selected pending signature with one confirmation', async () => {
    const second = { ...PENDING_ROW, id: 12, student: { first_name: 'Juan', last_name: 'Cruz' }, student_id: 502 };
    mocks.getClearanceSignatures.mockResolvedValue(envelope([PENDING_ROW, second]));
    mocks.updateClearanceSignature.mockResolvedValue({ data: { ...PENDING_ROW, status: 'cleared' } });

    render(<SignatoryClearancesPage />);
    await screen.findAllByText('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /select all pending/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected' }));

    await waitFor(() => expect(mocks.updateClearanceSignature).toHaveBeenCalledTimes(2));
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(11, { status: 'cleared' });
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(12, { status: 'cleared' });
  });
});
