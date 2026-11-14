import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('marks a streaming answer busy and a finished one not', () => {
    const { rerender } = renderMessage(answer({ streaming: true }));
    expect(screen.getByRole('article', { name: 'Answer' })).toHaveAttribute('aria-busy', 'true');
    rerender(
      <MemoryRouter>
        <ChatMessage message={answer()} isLast />
      </MemoryRouter>,
    );
    expect(screen.getByRole('article', { name: 'Answer' })).not.toHaveAttribute('aria-busy');
  });
});

describe('ChatMessage Copy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies the text as it reads on screen, not the Markdown or HTML source', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const content = [
      '## Late files',
      '',
      'Three **organizations** are [late](/dashboard/compliance) <span class="badge badge-danger">Overdue</span>.',
      '',
      '1. Open compliance',
      '2. Send a reminder',
      '   - to the treasurer',
      '',
      '| Organization | Due |',
      '|---|---|',
      '| Chess Club | Dec 1 |',
      '| Drama Club | Dec 5 |',
      '',
      '<div class="callout callout-warning">Deadline is close.</div>',
    ].join('\n');
    renderMessage(answer({ content }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe([
      'Late files',
      '',
      'Three organizations are late Overdue.',
      '',
      '1. Open compliance\n2. Send a reminder\n  - to the treasurer',
      '',
      'Organization\tDue\nChess Club\tDec 1\nDrama Club\tDec 5',
      '',
      'Deadline is close.',
    ].join('\n'));
  });
});
