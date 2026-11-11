import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentClearancePage from './StudentClearancePage';

const mocks = vi.hoisted(() => ({ getMyClearances: vi.fn(), getStudentDebts: vi.fn() }));

vi.mock('../../../services/clearanceService', () => ({ getMyClearances: mocks.getMyClearances }));
vi.mock('../../../services/financeService', () => ({ getStudentDebts: mocks.getStudentDebts }));

const renderPage = () => render(<MemoryRouter><StudentClearancePage /></MemoryRouter>);

describe('StudentClearancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStudentDebts.mockResolvedValue({ data: [] });
  });

  it('shows a first-run empty state when no clearance period has ever opened', async () => {
    mocks.getMyClearances.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText('No clearance period yet')).toBeInTheDocument();
  });

  it('shows a retryable error state', async () => {
    mocks.getMyClearances.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText('Failed to load your clearance.')).toBeInTheDocument();
  });

  it('shows the checklist with a held line explaining the reason and who to see', async () => {
    mocks.getMyClearances.mockResolvedValue({
      data: [{
        clearance_period_id: 1,
        academic_year: '2026-2027',
        title: 'Second Semester Clearance',
        deadline_at: null,
        is_complete: false,
        signatures: [
          { id: 1, required_role: 'adviser', status: 'cleared', remarks: null },
          { id: 2, required_role: 'organization_treasurer', status: 'held', remarks: 'Unpaid organization dues.' },
          { id: 3, required_role: 'sao', status: 'pending', remarks: null },
        ],
      }],
    });

    renderPage();
    expect(await screen.findByText('Organization treasurer')).toBeInTheDocument();
    expect(screen.getByText(/Unpaid organization dues\..*organization's organization treasurer/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting on the Student Affairs Office/)).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('shows the completed celebration state with a drawn check when every line is cleared', async () => {
    mocks.getMyClearances.mockResolvedValue({
      data: [{
        clearance_period_id: 1,
        academic_year: '2026-2027',
        title: 'Second Semester Clearance',
        deadline_at: null,
        is_complete: true,
        signatures: [{ id: 1, required_role: 'sao', status: 'cleared', remarks: null }],
      }],
    });

    renderPage();
    expect(await screen.findByText('Your clearance is complete!')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Clearance complete' })).toBeInTheDocument();
  });

  it('lets a student switch between more than one clearance period', async () => {
    mocks.getMyClearances.mockResolvedValue({
      data: [
        { clearance_period_id: 1, academic_year: '2025-2026', title: 'First period', deadline_at: null, is_complete: true, signatures: [{ id: 1, required_role: 'sao', status: 'cleared', remarks: null }] },
        { clearance_period_id: 2, academic_year: '2026-2027', title: 'Second period', deadline_at: null, is_complete: false, signatures: [{ id: 2, required_role: 'sao', status: 'pending', remarks: null }] },
      ],
    });

    renderPage();
    // The current period is the incomplete one, chosen by default.
    expect(await screen.findByText(/second period · 2026-2027/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Choose clearance period'), { target: { value: '1' } });
    expect(await screen.findByText('Your clearance is complete!')).toBeInTheDocument();
  });

  it('tells a student who owes money that the clearance is held for the same debt the Statement shows', async () => {
    mocks.getMyClearances.mockResolvedValue({
      data: [{
        clearance_period_id: 1,
        academic_year: '2026-2027',
        title: 'Second Semester Clearance',
        deadline_at: null,
        is_complete: false,
        signatures: [{ id: 1, required_role: 'sao', status: 'pending', remarks: null }],
      }],
    });
    mocks.getStudentDebts.mockResolvedValue({ data: [{ total_debt: 150, clearance_status: 'pending_clearance', unpaid_invoice_count: 1, pending_order_count: 0 }] });

    renderPage();
    expect(await screen.findByText('You owe ₱150.00: 1 unpaid invoice.')).toBeInTheDocument();
    expect(screen.getByText('Financial clearance is on hold')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Statement of account' })).toHaveAttribute('href', '/dashboard/finance/statement-of-account');
  });

  it('says nothing about money when the student owes nothing or the balance cannot be loaded', async () => {
    mocks.getMyClearances.mockResolvedValue({
      data: [{ clearance_period_id: 1, academic_year: '2026-2027', title: 'Second Semester Clearance', deadline_at: null, is_complete: false, signatures: [{ id: 1, required_role: 'sao', status: 'pending', remarks: null }] }],
    });
    mocks.getStudentDebts.mockResolvedValue({ data: [{ total_debt: 0, clearance_status: 'financially_cleared', unpaid_invoice_count: 0, pending_order_count: 0 }] });
    const first = renderPage();
    expect(await screen.findByText(/Waiting on the Student Affairs Office/)).toBeInTheDocument();
    expect(screen.queryByText(/You owe/)).not.toBeInTheDocument();
    first.unmount();

    mocks.getStudentDebts.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText(/Waiting on the Student Affairs Office/)).toBeInTheDocument();
    expect(screen.queryByText(/You owe/)).not.toBeInTheDocument();
  });
});
