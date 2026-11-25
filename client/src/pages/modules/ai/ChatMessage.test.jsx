import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatMessage from './ChatMessage';

const opener = vi.hoisted(() => ({ openProtectedFile: vi.fn() }));
vi.mock('../../../utils/openProtectedFile', () => opener);

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

describe('ChatMessage with an action', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const proposal = (status = 'awaiting_confirmation', extra = {}) => answer({
    content: 'Here is the event I can create.',
    payload: {
      action: {
        key: 'create_event',
        title: 'Create an event',
        status,
        submit_label: 'Create event',
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, value: 'General Assembly', max: 255, help: null, options: null },
          { name: 'who', label: 'Assign to', type: 'select', required: false, value: '4', max: null, help: null, options: [{ value: '4', label: 'Ana Cruz' }] },
          { name: 'public', label: 'Open to everyone', type: 'checkbox', required: false, value: true, max: null, help: null, options: null },
        ],
        errors: {},
        result: null,
        expires_at: new Date(Date.now() + 600000).toISOString(),
        ...extra,
      },
    },
  });

  it('renders the card under the text and does not offer Regenerate', () => {
    renderMessage(proposal());
    expect(screen.getByText('Here is the event I can create.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('copies the text with the field labels and their values', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderMessage(proposal());
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith(
      'Here is the event I can create.\nCreate an event\nTitle: General Assembly\nAssign to: Ana Cruz\nOpen to everyone: Yes',
    );
  });

  it('copies what the person edited in the card, not the stored values', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderMessage(proposal());
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Edited Assembly' } });
    fireEvent.click(screen.getByLabelText('Open to everyone'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith(
      'Here is the event I can create.\nCreate an event\nTitle: Edited Assembly\nAssign to: Ana Cruz\nOpen to everyone: No',
    );
  });

  it('shows the interrupted sentence once when the server closes a card with it', () => {
    const sentence = 'I could not tell whether this went through. Check the page before trying again.';
    renderMessage({ ...proposal('failed', { result: { message: sentence } }), content: sentence });
    expect(screen.getAllByText(sentence)).toHaveLength(1);
  });

  it('shows the result once, in the card, when done', () => {
    renderMessage(proposal('done', { result: { message: 'Event created.', href: '/dashboard/events/3', action_label: 'Open event' } }));
    expect(screen.getAllByText('Event created.')).toHaveLength(1);
    expect(screen.queryByText('Here is the event I can create.')).not.toBeInTheDocument();
  });
});

describe('ChatMessage cancelled card', () => {
  const cancelled = (content) => answer({
    content,
    payload: {
      action: {
        key: 'create_event', title: 'Create an event', status: 'cancelled', submit_label: 'Create event',
        fields: [], errors: {}, result: null, expires_at: new Date(Date.now() + 600000).toISOString(),
      },
    },
  });

  it('says it was cancelled once when the server already wrote the sentence', () => {
    renderMessage(cancelled('Cancelled. Nothing was changed.'));
    expect(screen.getByText('Cancelled. Nothing was changed.')).toBeInTheDocument();
    expect(screen.queryByText('You cancelled this request.')).not.toBeInTheDocument();
    expect(screen.getAllByText(/cancelled/i)).toHaveLength(1);
  });

  it('keeps the card sentence when the text above is the original request', () => {
    renderMessage(cancelled('Here is the event I can create.'));
    expect(screen.getByText('You cancelled this request.')).toBeInTheDocument();
  });
});

describe('ChatMessage sources line', () => {
  const sourced = (payload) => answer({ payload: { title: 'Late files', ...payload } });

  it('shows the sources line under the answer in the muted helper style', () => {
    renderMessage(sourced({ sources: 'From your fee records and your clearance record.' }));
    const line = screen.getByText('From your fee records and your clearance record.');
    expect(line).toHaveClass('text-xs', 'font-medium', 'text-ink-muted-strong');
    const answerText = screen.getByText('Three files are late.');
    expect(answerText.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows nothing extra when the payload has no sources line', () => {
    const { container } = renderMessage(sourced({}));
    expect(container.querySelectorAll('p.text-xs')).toHaveLength(0);
  });

  it.each([
    ['an empty string', ''],
    ['only spaces', '   '],
    ['a list', ['a', 'b']],
    ['an object', { text: 'x' }],
  ])('shows nothing when sources is %s', (_label, sources) => {
    const { container } = renderMessage(sourced({ sources }));
    expect(container.querySelectorAll('p.text-xs')).toHaveLength(0);
  });

  it('shows record text as plain words and never as markup or a link', () => {
    const { container } = renderMessage(sourced({ sources: 'From <a href="/dashboard/admin">your records</a> **bold**' }));
    const line = container.querySelector('p.text-xs');
    expect(line.textContent).toBe('From <a href="/dashboard/admin">your records</a> **bold**');
    expect(line.querySelector('a, strong')).toBeNull();
  });
});

describe('ChatMessage note for a line that was left out', () => {
  const NOTE = 'One line was left out because its figure could not be checked against your records.';

  it('keeps the answer and shows the note muted under it', () => {
    renderMessage(answer({ payload: { title: 'Finance', notice: NOTE } }));
    const note = screen.getByText(NOTE);
    expect(note).toHaveClass('text-xs', 'font-medium', 'text-ink-muted-strong');
    expect(screen.getByText('Three files are late.')).toBeInTheDocument();
    const answerText = screen.getByText('Three files are late.');
    expect(answerText.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the plural note as it is sent', () => {
    renderMessage(answer({ payload: { title: 'Finance', notice: '2 lines were left out because their figures could not be checked against your records.' } }));
    expect(screen.getByText('2 lines were left out because their figures could not be checked against your records.')).toBeInTheDocument();
  });

  it('shows no note when the payload carries none', () => {
    renderMessage(answer({ payload: { title: 'Finance', notice: null } }));
    expect(screen.queryByText(/left out/)).toBeNull();
  });
});

describe('ChatMessage with a null payload', () => {
  it('renders the fixed text, Copy and feedback without reading payload fields', () => {
    renderMessage(answer({ content: 'You can no longer see this answer.', payload: null, status: 'completed' }));
    expect(screen.getByRole('article', { name: 'Answer' })).toHaveTextContent('You can no longer see this answer.');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('survives a payload that is missing altogether', () => {
    const message = answer({ content: 'Fixed text.' });
    delete message.payload;
    renderMessage(message);
    expect(screen.getByText('Fixed text.')).toBeInTheDocument();
  });
});

describe('ChatMessage attachment', () => {
  const asked = (extra = {}) => ({ key: 'u-1', id: 1, role: 'user', content: 'Record this expense', ...extra });

  beforeEach(() => {
    opener.openProtectedFile.mockReset();
  });

  it('shows the file name on the question and opens it through the protected route', () => {
    renderMessage(asked({ attachment: { name: 'lunch.jpg', mime: 'image/jpeg', open_url: '/ai/assistant/attachments/5' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Open lunch.jpg' }));
    expect(opener.openProtectedFile).toHaveBeenCalledWith('/ai/assistant/attachments/5');
  });

  it('says so when the file cannot be opened', async () => {
    opener.openProtectedFile.mockRejectedValue(new Error('gone'));
    renderMessage(asked({ attachment: { name: 'lunch.jpg', open_url: '/ai/assistant/attachments/5' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Open lunch.jpg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open that file.');
  });

  it('shows no file line on a question without one', () => {
    renderMessage(asked());
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
  });
});
