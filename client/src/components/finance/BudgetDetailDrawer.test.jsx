import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import BudgetDetailDrawer from './BudgetDetailDrawer';

const budget = (status) => ({ id: 5, title: 'Sports fest budget', allocated_amount: 5000, remaining_amount: 5000, warning_threshold: 500, submission_status: status });

function open(status, viewerRole, handlers = {}) {
  render(
    <MemoryRouter>
      <BudgetDetailDrawer budget={budget(status)} viewerRole={viewerRole} onClose={vi.fn()} {...handlers} />
    </MemoryRouter>,
  );
}

describe('BudgetDetailDrawer drafts', () => {
  it('gives the Admin a Submit for approval button on a draft', () => {
    const onSubmit = vi.fn();
    open('draft', 'ADMIN', { onEdit: vi.fn(), onSubmit });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('gives the officer an Edit draft button and never a submit button', () => {
    const onEdit = vi.fn();
    open('draft', 'SBO_OFFICER', { onEdit, onSubmit: undefined });

    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Submit for approval|Edit and resubmit/ })).not.toBeInTheDocument();
  });

  it('shows the officer a returned budget as something to edit, not resubmit', () => {
    const onEdit = vi.fn();
    open('rejected', 'SBO_OFFICER', { onEdit });

    fireEvent.click(screen.getByRole('button', { name: 'Edit budget' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Edit and resubmit' })).not.toBeInTheDocument();
  });

  it('keeps Edit and resubmit for the Admin on a returned budget', () => {
    const onEdit = vi.fn();
    open('rejected', 'ADMIN', { onEdit });

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resubmit' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it.each([['draft', 'Edit draft'], ['rejected', 'Edit budget']])('shows an officer without the finance switch a %s budget as switched off, with the reason', (status, label) => {
    open(status, 'SBO_OFFICER');

    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    expect(screen.getByText('Your position cannot handle finance')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
  });
});

describe('BudgetDetailDrawer figures', () => {
  const approved = { id: 9, title: 'General Operations Fund', submission_status: 'approved', is_released: true, allocated_amount: 50000, spent_amount: 13500, income_amount: 43500, remaining_amount: 80000, warning_threshold: 5000 };

  function openWith(row) {
    render(
      <MemoryRouter>
        <BudgetDetailDrawer budget={row} viewerRole="ADMIN" onClose={vi.fn()} />
      </MemoryRouter>,
    );
  }

  it('shows Allocated, Spent, Income and Remaining with the arithmetic', () => {
    openWith(approved);

    expect(screen.getByText('Spent').nextSibling).toHaveTextContent('₱13,500.00');
    expect(screen.getByText('Income').nextSibling).toHaveTextContent('₱43,500.00');
    expect(screen.getByText('50,000.00 allocated - 13,500.00 spent + 43,500.00 income = 80,000.00 remaining')).toBeInTheDocument();
  });

  it('words the progress with the same spent figure', () => {
    openWith(approved);

    expect(screen.getByText('₱13,500.00 of ₱50,000.00 spent')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '13500');
  });

  it('shows a budget that is not approved as untouched, with no progress', () => {
    openWith({ ...approved, submission_status: 'pending_department_head', is_released: false, remaining_amount: 21200, allocated_amount: 25000 });

    expect(screen.getByText('Remaining').nextSibling).toHaveTextContent('₱25,000.00');
    expect(screen.getByText('Not released until approved. Nothing can be spent from it yet.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
