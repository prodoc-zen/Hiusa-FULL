import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BudgetFigures, { budgetFigures } from './BudgetFigures';

const released = {
  id: 1, title: 'General Operations Fund', submission_status: 'approved', is_released: true,
  allocated_amount: 50000, spent_amount: 13500, income_amount: 43500, remaining_amount: 80000,
};

describe('BudgetFigures', () => {
  it('shows the four figures and the arithmetic in one line', () => {
    render(<BudgetFigures budget={released} />);

    expect(screen.getByText('Allocated').nextSibling).toHaveTextContent('₱50,000.00');
    expect(screen.getByText('Spent').nextSibling).toHaveTextContent('₱13,500.00');
    expect(screen.getByText('Income').nextSibling).toHaveTextContent('₱43,500.00');
    expect(screen.getByText('Remaining').nextSibling).toHaveTextContent('₱80,000.00');
    expect(screen.getByText('50,000.00 allocated - 13,500.00 spent + 43,500.00 income = 80,000.00 remaining')).toBeInTheDocument();
  });

  it('reads money the server sends as two-decimal strings', () => {
    render(<BudgetFigures budget={{ ...released, allocated_amount: '25000.00', spent_amount: '3800.00', income_amount: '0.00', remaining_amount: '21200.00' }} />);

    expect(screen.getByText('25,000.00 allocated - 3,800.00 spent + 0.00 income = 21,200.00 remaining')).toBeInTheDocument();
  });

  it('works the income out from the remaining balance when the row carries none', () => {
    render(<BudgetFigures budget={{ ...released, income_amount: undefined }} />);

    expect(screen.getByText('Income').nextSibling).toHaveTextContent('₱43,500.00');
  });

  it('writes an overspent balance with its minus sign', () => {
    render(<BudgetFigures budget={{ ...released, allocated_amount: 1000, spent_amount: 1500, income_amount: 0, remaining_amount: -500 }} />);

    expect(screen.getByText('1,000.00 allocated - 1,500.00 spent + 0.00 income = -500.00 remaining')).toBeInTheDocument();
  });

  it.each(['pending_department_head', 'draft', 'rejected'])('shows a %s budget as untouched until it is approved', (status) => {
    render(<BudgetFigures budget={{ ...released, submission_status: status, is_released: false, remaining_amount: 21200, allocated_amount: 25000 }} />);

    expect(screen.getByText('Remaining').nextSibling).toHaveTextContent('₱25,000.00');
    expect(screen.getByText('Not released until approved. Nothing can be spent from it yet.')).toBeInTheDocument();
    expect(screen.queryByText('Spent')).not.toBeInTheDocument();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
    expect(screen.queryByText(/allocated -/)).not.toBeInTheDocument();
  });

  it('falls back to the submission status when the row has no is_released flag', () => {
    expect(budgetFigures({ allocated_amount: 100, remaining_amount: 60, submission_status: 'approved', spent_amount: 40, income_amount: 0 }).released).toBe(true);
    expect(budgetFigures({ allocated_amount: 100, remaining_amount: 60, submission_status: 'pending_department_head' }).released).toBe(false);
  });

  it('shows only Allocated and Remaining, and no arithmetic, for an approved row with no breakdown', () => {
    render(<BudgetFigures budget={{ allocated_amount: 100, remaining_amount: 60, submission_status: 'approved' }} />);

    expect(screen.getByText('Remaining').nextSibling).toHaveTextContent('₱60.00');
    expect(screen.queryByText('Spent')).not.toBeInTheDocument();
    expect(screen.queryByText(/allocated -/)).not.toBeInTheDocument();
  });
});
