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
