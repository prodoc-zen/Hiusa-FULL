import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClearancePeriodStudentsDrawer from './ClearancePeriodStudentsDrawer';

const mocks = vi.hoisted(() => ({
  getClearancePeriodStudents: vi.fn(),
  updateClearanceSignature: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../services/clearanceService', () => ({
  getClearancePeriodStudents: mocks.getClearancePeriodStudents,
  updateClearanceSignature: mocks.updateClearanceSignature,
}));
vi.mock('../../../lib/notify', () => ({ default: { success: mocks.success, error: mocks.error } }));

const PERIOD = { id: 1, title: 'Second Semester Clearance', academic_year: '2026-2027', required_roles: ['sao', 'department_head'] };

const line = (id, status, role = 'sao') => ({ id, required_role: role, status });
const ROSTER = [
  { student_id: 501, student_name: 'Maria Santos', signatures: [line(11, 'pending'), line(12, 'pending', 'department_head')] },
  { student_id: 502, student_name: 'Juan Cruz', signatures: [line(21, 'pending'), line(22, 'cleared', 'department_head')] },
  { student_id: 503, student_name: 'Ana Reyes', signatures: [line(31, 'cleared'), line(32, 'cleared', 'department_head')] },
  { student_id: 504, student_name: 'Pedro Lim', signatures: [line(41, 'held'), line(42, 'pending', 'department_head')] },
];

function renderDrawer(onSignatureChanged = vi.fn()) {
  render(<MemoryRouter><ClearancePeriodStudentsDrawer period={PERIOD} onClose={vi.fn()} onSignatureChanged={onSignatureChanged} /></MemoryRouter>);
  return onSignatureChanged;
}

describe('ClearancePeriodStudentsDrawer select all pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClearancePeriodStudents.mockResolvedValue({ data: { data: ROSTER, current_page: 1, last_page: 1, per_page: 20, total: ROSTER.length } });
    mocks.updateClearanceSignature.mockResolvedValue({ data: {} });
  });

  it('counts only the pending SAO lines and gives a checkbox to those rows alone', async () => {
    renderDrawer();
    expect(await screen.findByLabelText('Select all pending (2)')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Maria Santos for bulk clear')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Juan Cruz for bulk clear')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select Ana Reyes for bulk clear')).toBeNull();
    expect(screen.queryByLabelText('Select Pedro Lim for bulk clear')).toBeNull();
    expect(screen.queryByRole('button', { name: /selected/ })).toBeNull();
  });

  it('clears every selected line in one confirm and never touches the other roles or held lines', async () => {
    const changed = renderDrawer();
    fireEvent.click(await screen.findByLabelText('Select all pending (2)'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 selected' }));
    const dialog = screen.getByRole('dialog', { name: 'Clear selected signatures' });
    expect(within(dialog).getByText(/Clear 2 pending signatures\?/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear selected' }));
    await waitFor(() => expect(mocks.updateClearanceSignature).toHaveBeenCalledTimes(2));
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(11, { status: 'cleared' });
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(21, { status: 'cleared' });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Cleared 2 signatures.'));
    expect(changed).toHaveBeenCalled();
    await waitFor(() => expect(mocks.getClearancePeriodStudents).toHaveBeenCalledTimes(2));
  });

  it('clears only the ticked line when one row is picked', async () => {
    renderDrawer();
    fireEvent.click(await screen.findByLabelText('Select Juan Cruz for bulk clear'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear 1 selected' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear selected' }));
    await waitFor(() => expect(mocks.updateClearanceSignature).toHaveBeenCalledTimes(1));
    expect(mocks.updateClearanceSignature).toHaveBeenCalledWith(21, { status: 'cleared' });
  });

  it('reports the lines that failed, keeps them selected and still reloads the roster', async () => {
    mocks.updateClearanceSignature.mockImplementation((id) => (id === 21
      ? Promise.reject({ response: { data: { message: 'This period is closed.' } } })
      : Promise.resolve({ data: {} })));
    renderDrawer();
    fireEvent.click(await screen.findByLabelText('Select all pending (2)'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 selected' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear selected' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Cleared 1 of 2 signatures. 1 could not be cleared: This period is closed.')));
    expect(mocks.success).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.getClearancePeriodStudents).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Select Juan Cruz for bulk clear')).toBeChecked();
    expect(screen.getByLabelText('Select Maria Santos for bulk clear')).not.toBeChecked();
  });

  it('offers no select all when nothing is pending for the SAO', async () => {
    mocks.getClearancePeriodStudents.mockResolvedValue({ data: { data: [ROSTER[2], ROSTER[3]], current_page: 1, last_page: 1, per_page: 20, total: 2 } });
    renderDrawer();
    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Select all pending/)).toBeNull();
  });
});
