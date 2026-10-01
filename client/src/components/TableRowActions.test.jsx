import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TableRowActions from './TableRowActions';

describe('TableRowActions', () => {
  it('opens from a clipped table, supports keyboard navigation, and runs the chosen action', () => {
    const onReview = vi.fn();
    const onReject = vi.fn();
    render(<div className="overflow-x-auto"><table><tbody><tr><td>
      <TableRowActions subject="Order 12" label="Order actions" actions={[
        { label: 'Review order', onClick: onReview },
        { label: 'Reject order', danger: true, onClick: onReject },
      ]} />
    </td></tr></tbody></table></div>);

    const trigger = screen.getByRole('button', { name: 'Actions for Order 12' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Order actions for Order 12' }).parentElement).toBe(document.body);
    expect(screen.getByRole('menuitem', { name: 'Review order' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Reject order' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review order' }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
