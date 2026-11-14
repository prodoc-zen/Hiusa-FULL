import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';

describe('ChatComposer', () => {
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
