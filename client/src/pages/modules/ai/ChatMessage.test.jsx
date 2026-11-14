import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ChatMessage from './ChatMessage';

const answer = (extra = {}) => ({
  key: 'm-2',
  id: 2,
  role: 'assistant',
  content: 'Three files are late.',
  status: 'completed',
  feedback: null,
  payload: null,
  ...extra,
});

function renderMessage(message, props = {}) {
  return render(
    <MemoryRouter>
      <ChatMessage message={message} isLast onRegenerate={vi.fn()} onFeedback={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

describe('ChatMessage actions', () => {
  it('keeps Copy and Regenerate as icon plus text', () => {
    renderMessage(answer());
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveTextContent('Copy');
    expect(screen.getByRole('button', { name: 'Regenerate' })).toHaveTextContent('Regenerate');
  });

  it('makes the feedback buttons icon-only toggles with 42px touch targets', () => {
    const onFeedback = vi.fn();
    const message = answer({ feedback: 'up' });
    renderMessage(message, { onFeedback });

    const up = screen.getByRole('button', { name: 'Helpful' });
    const down = screen.getByRole('button', { name: 'Not helpful' });
    expect(up.textContent).toBe('');
    expect(down.textContent).toBe('');
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(down).toHaveAttribute('aria-pressed', 'false');
    expect(up).toHaveClass('max-sm:h-[42px]', 'max-sm:w-[42px]');
    expect(down).toHaveClass('max-sm:h-[42px]', 'max-sm:w-[42px]');

    fireEvent.click(up);
    expect(onFeedback).toHaveBeenCalledWith(message, null);
    fireEvent.click(down);
    expect(onFeedback).toHaveBeenCalledWith(message, 'down');
  });

  it('shows a tooltip naming the feedback button on focus', async () => {
    renderMessage(answer());
    fireEvent.focus(screen.getByRole('button', { name: 'Not helpful' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Not helpful');
  });
});
