import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ArchiveTransactionModal, { reasonIsGiven } from './ArchiveTransactionModal';

const transaction = { id: 12, description: 'Sound system rental', type: 'expense', amount: 1200 };

describe('ArchiveTransactionModal', () => {
  it('counts a reason of five characters, not spaces', () => {
    expect(reasonIsGiven('abcd')).toBe(false);
    expect(reasonIsGiven('  ab  ')).toBe(false);
    expect(reasonIsGiven('abcde')).toBe(true);
    expect(reasonIsGiven(undefined)).toBe(false);
  });

  it('keeps Archive disabled until a reason of five characters is typed, then sends the trimmed reason', () => {
    const onConfirm = vi.fn();
    render(<ArchiveTransactionModal transaction={transaction} onCancel={vi.fn()} onConfirm={onConfirm} />);

    const confirm = screen.getByRole('button', { name: 'Archive transaction' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for archiving'), { target: { value: 'dup' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for archiving'), { target: { value: '  Recorded twice  ' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Recorded twice');
  });

  it('names the entry, says the receipt file is kept, and never says deleted', () => {
    render(<ArchiveTransactionModal transaction={transaction} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Archive this transaction?' });
    expect(dialog).toHaveTextContent('Sound system rental');
    expect(dialog).toHaveTextContent('The receipt file is kept.');
    expect(dialog.textContent).not.toMatch(/delet/i);
  });

  it('shows the server refusal and cancels', () => {
    const onCancel = vi.fn();
    render(<ArchiveTransactionModal transaction={transaction} error="This entry is in a submitted report." onCancel={onCancel} onConfirm={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This entry is in a submitted report.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
