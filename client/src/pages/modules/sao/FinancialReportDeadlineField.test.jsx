import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialReportDeadlineField from './FinancialReportDeadlineField';

const finance = vi.hoisted(() => ({ getFinancialReportDeadline: vi.fn(), setFinancialReportDeadline: vi.fn() }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('../../../services/financeService', () => finance);
vi.mock('../../../lib/notify', () => ({ default: toasts }));

const future = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

describe('FinancialReportDeadlineField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finance.getFinancialReportDeadline.mockResolvedValue({ data: { data: null } });
  });

  it('says no date is set and sets the first one', async () => {
    const due = future(14);
    finance.setFinancialReportDeadline.mockResolvedValue({ data: { data: { id: 1, deadline_at: due } } });
    render(<FinancialReportDeadlineField />);

    expect(await screen.findByText(/No due date is set/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set due date' })).toBeDisabled();
    expect(screen.queryByLabelText(/starts a new round/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Due on'), { target: { value: due } });
    fireEvent.click(screen.getByRole('button', { name: 'Set due date' }));

    await waitFor(() => expect(finance.setFinancialReportDeadline).toHaveBeenCalledWith(due, false));
    expect(toasts.success).toHaveBeenCalledWith('Financial report due date saved.');
    expect(await screen.findByText(/Organizations send their financial report by/)).toBeInTheDocument();
  });

  it('shows the current date, changes it in place, and starts a new round only when asked', async () => {
    const current = future(10);
    const later = future(20);
    finance.getFinancialReportDeadline.mockResolvedValue({ data: { data: { id: 3, deadline_at: current } } });
    finance.setFinancialReportDeadline.mockResolvedValue({ data: { data: { id: 3, deadline_at: later } } });
    render(<FinancialReportDeadlineField />);

    expect(await screen.findByText(/Organizations send their financial report by/)).toBeInTheDocument();
    expect(screen.getByLabelText('Due on')).toHaveValue(current);
    expect(screen.getByRole('button', { name: 'Save due date' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Due on'), { target: { value: later } });
    fireEvent.click(screen.getByRole('button', { name: 'Save due date' }));
    await waitFor(() => expect(finance.setFinancialReportDeadline).toHaveBeenLastCalledWith(later, false));

    fireEvent.click(screen.getByLabelText(/starts a new round/));
    fireEvent.click(screen.getByRole('button', { name: 'Save due date' }));
    await waitFor(() => expect(finance.setFinancialReportDeadline).toHaveBeenLastCalledWith(later, true));
  });

  it('shows the server reason when the date is refused', async () => {
    finance.setFinancialReportDeadline.mockRejectedValue({ response: { data: { message: 'Choose today or a later date.' } } });
    render(<FinancialReportDeadlineField />);
    await screen.findByText(/No due date is set/);

    fireEvent.change(screen.getByLabelText('Due on'), { target: { value: future(3) } });
    fireEvent.click(screen.getByRole('button', { name: 'Set due date' }));

    expect(await screen.findByText('Choose today or a later date.')).toBeInTheDocument();
    expect(toasts.success).not.toHaveBeenCalled();
  });
});
