import { act, fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IconButton from './IconButton';

describe('IconButton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes its label as an accessible name', () => {
    render(<IconButton icon={Trash2} label="Delete record" />);
    expect(screen.getByRole('button', { name: 'Delete record' })).toBeInTheDocument();
  });

  it('shows its label through the kit Tooltip instead of a native title attribute', () => {
    vi.useFakeTimers();
    render(<IconButton icon={Trash2} label="Delete record" />);
    const button = screen.getByRole('button', { name: 'Delete record' });
    expect(button).not.toHaveAttribute('title');

    fireEvent.mouseEnter(button.parentElement);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete record');
  });
});
