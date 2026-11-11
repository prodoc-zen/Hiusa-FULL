import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignatoryClearancesPage from './SignatoryClearancesPage';
import notify from '../../../lib/notify';

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

vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function envelope(data) {
  return { data: { data, current_page: 1, last_page: 1, per_page: 20, total: data.length } };
}

const PENDING_ROW = {
  id: 11,
  status: 'pending',
  remarks: null,
  required_role: 'organization',
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
    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    expect(await screen.findByText('Nothing waiting on your signature')).toBeInTheDocument();
  });

  it('shows a retryable error state', async () => {
    mocks.getClearanceSignatures.mockRejectedValueOnce(new Error('down'));
    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    expect(await screen.findByText('Failed to load your clearance signing queue.')).toBeInTheDocument();

    mocks.getClearanceSignatures.mockResolvedValue(envelope([]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing waiting on your signature')).toBeInTheDocument();
  });

  it('holds a pending signature only after a reason is entered, then can clear the hold', async () => {
    mocks.getClearanceSignatures.mockResolvedValue(envelope([PENDING_ROW]));
    mocks.updateClearanceSignature.mockResolvedValue({ data: { ...PENDING_ROW, status: 'held', remarks: 'Unpaid dues.' } });

    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    const [row] = (await screen.findAllByText('Maria Santos')).map((el) => el.closest('tr') || el.closest('li'));
    fireEvent.click(within(row).getByRole('button', { name: 'Hold: Organization' }));

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

    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    await screen.findAllByText('Maria Santos');
    fireEvent.click(screen.getByRole('checkbox', { name: /select all pending/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected' }));

    await waitFor(() => expect(mocks.updateClearanceSignature).toHaveBeenCalledTimes(2));
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(11, { status: 'cleared' });
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(12, { status: 'cleared' });
  });
  it('reloads the queue and keeps only the failed signatures selected after a partial bulk failure', async () => {
    const second = { ...PENDING_ROW, id: 12, student: { first_name: 'Juan', last_name: 'Cruz' }, student_id: 502 };
    mocks.getClearanceSignatures.mockResolvedValueOnce(envelope([PENDING_ROW, second]));
    mocks.updateClearanceSignature.mockImplementation((id) => (id === 12
      ? Promise.reject({ response: { data: { message: 'This clearance line has already been cleared.' } } })
      : Promise.resolve({ data: { ...PENDING_ROW, status: 'cleared' } })));

    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    await screen.findAllByText('Maria Santos');
    fireEvent.click(screen.getByRole('checkbox', { name: /select all pending/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 selected' }));

    mocks.getClearanceSignatures.mockResolvedValue(envelope([second]));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected' }));

    expect(await screen.findByRole('button', { name: 'Clear 1 selected' })).toBeInTheDocument();
    expect(mocks.getClearanceSignatures).toHaveBeenCalledTimes(2);
    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('1 of 2'));
    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('already been cleared'));
  });

  it('asks for page one once when a filter changes on a later page', async () => {
    mocks.getClearanceSignatures.mockImplementation((params) => Promise.resolve({ data: { data: [PENDING_ROW], current_page: params.page, last_page: 3, per_page: 20, total: 50 } }));

    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    await screen.findAllByText('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: /next page of signatures/i }));
    await waitFor(() => expect(mocks.getClearanceSignatures).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    mocks.getClearanceSignatures.mockClear();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'held' } });
    await waitFor(() => expect(mocks.getClearanceSignatures).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.getClearanceSignatures.mock.calls.map(([params]) => params)).toEqual([expect.objectContaining({ status: 'held', page: 1 })]);
  });

  it('shows the answer to the latest filter even when an earlier request lands last', async () => {
    let releaseFirst;
    mocks.getClearanceSignatures.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(envelope([PENDING_ROW])); }));
    mocks.getClearanceSignatures.mockResolvedValue(envelope([]));

    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'cleared' } });
    await screen.findByText('No signatures match these filters');

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
    expect(screen.getByText('No signatures match these filters')).toBeInTheDocument();
  });

  it('sends one search request after typing stops instead of one per keystroke', async () => {
    mocks.getClearanceSignatures.mockResolvedValue(envelope([PENDING_ROW]));

    render(<MemoryRouter><SignatoryClearancesPage /></MemoryRouter>);
    await screen.findAllByText('Maria Santos');
    mocks.getClearanceSignatures.mockClear();

    const box = screen.getByLabelText('Search students');
    fireEvent.change(box, { target: { value: 'M' } });
    fireEvent.change(box, { target: { value: 'Ma' } });
    fireEvent.change(box, { target: { value: 'Mar' } });

    await waitFor(() => expect(mocks.getClearanceSignatures).toHaveBeenCalledWith(expect.objectContaining({ q: 'Mar' })));
    expect(mocks.getClearanceSignatures).toHaveBeenCalledTimes(1);
  });
});
