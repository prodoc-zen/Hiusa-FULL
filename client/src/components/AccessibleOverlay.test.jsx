import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AccessibleOverlay from './AccessibleOverlay';

describe('AccessibleOverlay', () => {
  it('traps keyboard focus, closes on Escape, and restores prior focus', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<button type="button">Open dialog</button>);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();

    rerender(
      <>
        <button type="button">Open dialog</button>
        <AccessibleOverlay label="Example dialog" onClose={onClose} className="fixed inset-0">
          <button type="button" data-autofocus>First action</button>
          <button type="button">Last action</button>
        </AccessibleOverlay>
      </>,
    );

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    await waitFor(() => expect(first).toHaveFocus());

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<button type="button">Open dialog</button>);
    expect(screen.getByRole('button', { name: 'Open dialog' })).toHaveFocus();
  });
});
