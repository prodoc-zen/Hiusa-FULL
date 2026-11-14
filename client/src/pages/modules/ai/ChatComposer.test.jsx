import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';

function stubNarrow(matches) {
  window.matchMedia = vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe('ChatComposer', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('uses a short placeholder below the sm breakpoint and the long one above it', () => {
    stubNarrow(true);
    const { unmount } = render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByLabelText('Message Ask AI')).toHaveAttribute('placeholder', 'Ask anything');
    unmount();
    stubNarrow(false);
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByLabelText('Message Ask AI')).toHaveAttribute('placeholder', 'Ask about your records or what to do next');
  });

  it('shows its focus on the container and none on the textarea', () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    const box = screen.getByLabelText('Message Ask AI');
    expect(box.parentElement).toHaveClass('focus-within:border-brand-600', 'focus-within:ring-accent/15');
    expect(box).toHaveClass('focus-visible:outline-none!');
  });
  it('shows a counter only near the limit and caps at 2000 characters', () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} />);
    const box = screen.getByLabelText('Message Ask AI');
    expect(box).toHaveAttribute('maxlength', '2000');
    fireEvent.change(box, { target: { value: 'a'.repeat(100) } });
    expect(screen.queryByText(/\/ 2000/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'a'.repeat(1850) } });
    expect(screen.getByText('1850 / 2000')).toBeInTheDocument();
  });

  it('keeps the text when the send is refused', () => {
    const onSend = vi.fn(() => false);
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} />);
    const box = screen.getByLabelText('Message Ask AI');
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(box).toHaveValue('hello');
  });

  it('keeps the text and says why while the send is blocked', () => {
    const onSend = vi.fn();
    render(<ChatComposer blockedReason="Opening your conversation." onSend={onSend} onStop={vi.fn()} />);
    const box = screen.getByLabelText('Message Ask AI');
    fireEvent.change(box, { target: { value: 'hello' } });
    expect(screen.getByText('Opening your conversation.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('hello');
  });

  it('shows Stop while streaming and does not send on Enter', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<ChatComposer streaming onSend={onSend} onStop={onStop} />);
    fireEvent.change(screen.getByLabelText('Message Ask AI'), { target: { value: 'next' } });
    fireEvent.keyDown(screen.getByLabelText('Message Ask AI'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop answering' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('blocks sending while offline', () => {
    render(<ChatComposer offline onSend={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText(/offline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});
