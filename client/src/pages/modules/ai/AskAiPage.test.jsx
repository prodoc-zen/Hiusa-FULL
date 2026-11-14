import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AskAiPage from './AskAiPage';

const service = vi.hoisted(() => ({
  getAiAssistantOverview: vi.fn(),
  streamAiChat: vi.fn(),
  listAiConversations: vi.fn(),
  getAiConversation: vi.fn(),
  renameAiConversation: vi.fn(),
  deleteAiConversation: vi.fn(),
  deleteAllAiConversations: vi.fn(),
  sendAiMessageFeedback: vi.fn(),
  listAiMemories: vi.fn(),
  addAiMemory: vi.fn(),
  deleteAiMemory: vi.fn(),
  deleteAllAiMemories: vi.fn(),
}));

vi.mock('../../../services/askAiService', () => service);
vi.mock('../../../components/ai/AiMarkdown', () => ({
  default: ({ content }) => <div data-testid="markdown">{content}</div>,
}));
vi.mock('../../../components/ai/AnswerBlocks', () => ({
  default: ({ payload, onAsk }) => (
    <button type="button" onClick={() => onAsk('Follow up?', 'finance_health')}>
      blocks:{payload.title}
    </button>
  ),
}));
vi.mock('../../../components/ai/ReasoningDisclosure', () => ({
  default: ({ reasoning, live }) => (
    <div data-testid="reasoning">{live ? 'live' : 'done'}:{reasoning?.steps?.join('|')}:{reasoning?.summary || ''}</div>
  ),
}));

const overview = {
  user_first_name: 'Jade',
  scope_label: 'University-wide student organizations',
  daily_briefing: {
    title: "Today's plan",
    summary: 'Three items need you today.',
    priorities: [
      { id: 'p1', primary: 'Review compliance files', href: '/dashboard/super-admin/compliance', action_label: 'Review' },
    ],
  },
  starter_prompts: [
    { id: 's1', label: 'What should I do today?', question: 'What should I do today across student organizations?', topic: 'daily_priorities' },
    { id: 's2', label: 'Who has not submitted?', question: 'Who has not submitted?', topic: 'missing_submissions' },
  ],
};

const conversation = (id, title, extra = {}) => ({ id, title, last_message_at: new Date().toISOString(), ...extra });

const storedAnswer = (id, content, extra = {}) => ({
  id,
  role: 'assistant',
  content,
  status: 'completed',
  feedback: null,
  payload: { title: 'Answer title', notice: null, reasoning: { steps: ['Read records'], seconds: 3 } },
  ...extra,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderPage(url = '/dashboard/ask-ai') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AskAiPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function deferredStream() {
  let emit;
  let resolve;
  let reject;
  let signal;
  service.streamAiChat.mockImplementationOnce(({ onEvent, signal: s }) => {
    emit = onEvent;
    signal = s;
    return new Promise((res, rej) => {
      resolve = res;
      reject = rej;
      s.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        rej(error);
      });
    });
  });
  return {
    emit: (name, data) => act(() => emit(name, data)),
    resolve: (value) => act(async () => resolve(value)),
    reject: (error) => act(async () => reject(error)),
    get signal() { return signal; },
  };
}

const composer = () => screen.getByLabelText('Message Ask AI');
const type = (text) => fireEvent.change(composer(), { target: { value: text } });

async function ready() {
  await screen.findByText('Hi, Jade');
}

describe('AskAiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getAiAssistantOverview.mockResolvedValue({ data: overview });
    service.listAiConversations.mockResolvedValue({ data: [] });
    service.sendAiMessageFeedback.mockResolvedValue({ data: {} });
    service.listAiMemories.mockResolvedValue({ data: [] });
  });

  it('shows the greeting, briefing and starter prompts in a new conversation', async () => {
    renderPage();
    await ready();
    expect(screen.getByText(/Showing records for University-wide/)).toBeInTheDocument();
    expect(screen.getByText('Three items need you today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance');
    expect(screen.getByRole('button', { name: 'What should I do today?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Who has not submitted?' })).toBeInTheDocument();
  });

  it('shows an error state with retry when the overview fails', async () => {
    service.getAiAssistantOverview.mockRejectedValueOnce(new Error('down'));
    renderPage();
    await screen.findByText('Could not load Ask AI');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
  });

  it('sends a starter with its topic', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Who has not submitted?' }));
    expect(service.streamAiChat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Who has not submitted?',
      topic: 'missing_submissions',
      regenerate: false,
      conversationId: null,
    }));
    expect(screen.getByText('Who has not submitted?', { selector: 'p' })).toBeInTheDocument();
    await stream.reject(Object.assign(new Error('x'), { status: 500 }));
  });

  it('sends on Enter, and not on Shift+Enter or while composing', async () => {
    deferredStream();
    renderPage();
    await ready();
    type('hello there');
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    expect(service.streamAiChat).not.toHaveBeenCalled();
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(service.streamAiChat).not.toHaveBeenCalled();
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(service.streamAiChat).toHaveBeenCalledTimes(1);
    expect(service.streamAiChat.mock.calls[0][0].message).toBe('hello there');
    expect(composer()).toHaveValue('');
  });

  it('builds the answer from stream events', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    type('what about finance?');
    fireEvent.keyDown(composer(), { key: 'Enter' });

    await stream.emit('meta', {
      conversation: conversation(12, 'What about finance'),
      user_message: { id: 1, role: 'user', content: 'what about finance?' },
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/ask-ai?c=12');

    await stream.emit('status', { stage: 'reading', label: 'Reading your records' });
    expect(screen.getByTestId('reasoning')).toHaveTextContent('live:Reading your records');
    await stream.emit('reasoning', { delta: 'Looking at ' });
    await stream.emit('reasoning', { delta: 'the ledger' });
    expect(screen.getByTestId('reasoning')).toHaveTextContent('Looking at the ledger');
    await stream.emit('delta', { text: 'Finance is ' });
    await stream.emit('delta', { text: 'fine.' });
    expect(screen.getByTestId('markdown')).toHaveTextContent('Finance is fine.');

    await stream.emit('replace', { text: 'Verified summary.', notice: 'Replaced with the verified summary.' });
    expect(screen.getByTestId('markdown')).toHaveTextContent('Verified summary.');

    const message = storedAnswer(2, 'Verified summary.', { payload: { title: 'Finance', notice: 'Replaced with the verified summary.', reasoning: { steps: ['Read'], seconds: 4 } } });
    await stream.emit('done', { conversation: conversation(12, 'What about finance'), message });
    await stream.resolve({ conversation: conversation(12, 'What about finance'), message });

    expect(screen.getByText('Replaced with the verified summary.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'blocks:Finance' })).toBeInTheDocument();
    expect(screen.getByTestId('reasoning')).toHaveTextContent('done:Read');
    expect(screen.getAllByTestId('markdown')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('stops, keeps partial text and marks it stopped', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    type('question');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await stream.emit('delta', { text: 'Partial answer' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop answering' }));
    await waitFor(() => expect(screen.getByText('You stopped this answer.')).toBeInTheDocument());
    expect(stream.signal.aborted).toBe(true);
    expect(screen.getByTestId('markdown')).toHaveTextContent('Partial answer');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });

  it('shows an inline error and resends with Try again', async () => {
    const first = deferredStream();
    renderPage();
    await ready();
    type('question');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await first.reject(new Error('boom'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not answer that right now. Try again.');
    expect(screen.getByText('question', { selector: 'p' })).toBeInTheDocument();

    const second = deferredStream();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(service.streamAiChat).toHaveBeenCalledTimes(2);
    expect(service.streamAiChat.mock.calls[1][0].message).toBe('question');
    expect(screen.getAllByText('question', { selector: 'p' })).toHaveLength(1);
    await second.reject(new Error('boom'));
  });

  it('tells the user to wait on a throttle', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    type('question');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await stream.reject(Object.assign(new Error('Too many'), { status: 429 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a moment');
  });

  it('ignores a second send while one is running', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    type('one');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    type('two');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(service.streamAiChat).toHaveBeenCalledTimes(1);
    await stream.reject(new Error('x'));
  });

  it('sends ?q once and cleans the URL', async () => {
    const stream = deferredStream();
    renderPage('/dashboard/ask-ai?q=Which%20orgs%20owe%20files&topic=missing_submissions');
    await waitFor(() => expect(service.streamAiChat).toHaveBeenCalledTimes(1));
    expect(service.streamAiChat.mock.calls[0][0]).toEqual(expect.objectContaining({
      message: 'Which orgs owe files',
      topic: 'missing_submissions',
      conversationId: null,
    }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/dashboard\/ask-ai$/));
    expect(service.streamAiChat).toHaveBeenCalledTimes(1);
    await stream.reject(new Error('x'));
  });

  it('opens the conversation named by ?c', async () => {
    service.listAiConversations.mockResolvedValue({ data: [conversation(7, 'Missing requirements')] });
    service.getAiConversation.mockResolvedValue({
      data: {
        conversation: conversation(7, 'Missing requirements'),
        messages: [
          { id: 1, role: 'user', content: 'who is missing?', status: 'completed', payload: null },
          storedAnswer(2, 'Three organizations are missing files.'),
        ],
      },
    });
    renderPage('/dashboard/ask-ai?c=7');
    expect(await screen.findByText('Three organizations are missing files.')).toBeInTheDocument();
    expect(service.getAiConversation).toHaveBeenCalledWith('7');
    expect(screen.getByText('who is missing?')).toBeInTheDocument();
    expect(screen.queryByText('Hi, Jade')).not.toBeInTheDocument();
  });

  it('falls back to a new conversation with a notice when ?c is gone', async () => {
    service.getAiConversation.mockRejectedValue({ response: { status: 404 } });
    renderPage('/dashboard/ask-ai?c=99');
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument();
    await ready();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/dashboard\/ask-ai$/);
  });

  it('shows a retry when a conversation fails to load', async () => {
    service.getAiConversation.mockRejectedValueOnce({ response: { status: 500 } });
    service.getAiConversation.mockResolvedValueOnce({
      data: { conversation: conversation(5, 'Budget'), messages: [storedAnswer(2, 'Budget is on track.')] },
    });
    renderPage('/dashboard/ask-ai?c=5');
    await screen.findByText('Could not open that conversation');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Budget is on track.')).toBeInTheDocument();
  });

  describe('history', () => {
    const openHistory = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'History' }));
      return screen.findByRole('navigation', { name: 'Conversations' });
    };

    beforeEach(() => {
      service.listAiConversations.mockResolvedValue({
        data: [conversation(1, 'Budget questions'), conversation(2, 'Event files')],
      });
    });

    it('renames a conversation inline', async () => {
      service.renameAiConversation.mockResolvedValue({ data: {} });
      renderPage();
      const list = await openHistory();
      fireEvent.click(await within(list).findByRole('button', { name: 'Options for Budget questions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      const input = screen.getByLabelText('Conversation title');
      fireEvent.change(input, { target: { value: 'Treasury' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(service.renameAiConversation).toHaveBeenCalledWith(1, 'Treasury'));
      expect(await within(list).findByRole('button', { name: 'Treasury' })).toBeInTheDocument();
    });

    it('deletes a conversation after a confirm', async () => {
      service.deleteAiConversation.mockResolvedValue({ data: {} });
      renderPage();
      const list = await openHistory();
      fireEvent.click(await within(list).findByRole('button', { name: 'Options for Event files' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(service.deleteAiConversation).toHaveBeenCalledWith(2));
      await waitFor(() => expect(within(list).queryByRole('button', { name: 'Event files' })).not.toBeInTheDocument());
    });

    it('returns to a new conversation when the open one is deleted', async () => {
      service.deleteAiConversation.mockResolvedValue({ data: {} });
      service.getAiConversation.mockResolvedValue({
        data: { conversation: conversation(1, 'Budget questions'), messages: [storedAnswer(2, 'On track.')] },
      });
      renderPage('/dashboard/ask-ai?c=1');
      await screen.findByText('On track.');
      const list = await openHistory();
      expect(await within(list).findByRole('button', { name: 'Budget questions' })).toHaveAttribute('aria-current', 'true');
      fireEvent.click(within(list).getByRole('button', { name: 'Options for Budget questions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
      await ready();
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/dashboard\/ask-ai$/));
    });

    it('deletes all conversations after a confirm', async () => {
      service.deleteAllAiConversations.mockResolvedValue({ data: {} });
      renderPage();
      const list = await openHistory();
      await within(list).findByRole('button', { name: 'Budget questions' });
      fireEvent.click(within(list).getByRole('button', { name: 'Delete all' }));
      const confirms = await screen.findAllByRole('button', { name: 'Delete all' });
      fireEvent.click(confirms[confirms.length - 1]);
      await waitFor(() => expect(service.deleteAllAiConversations).toHaveBeenCalled());
      expect(await within(list).findByText('Your conversations will show up here.')).toBeInTheDocument();
    });
  });

  describe('memory', () => {
    const openMemory = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Memory' }));
      return screen.findByLabelText('Add something to remember');
    };

    it('adds and deletes a memory', async () => {
      service.listAiMemories.mockResolvedValue({ data: [{ id: 1, content: 'Keep answers short' }] });
      service.addAiMemory.mockResolvedValue({ data: { id: 2, content: 'I am the treasurer' } });
      service.deleteAiMemory.mockResolvedValue({ data: {} });
      renderPage();
      const field = await openMemory();
      expect(await screen.findByText('Keep answers short')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      fireEvent.change(field, { target: { value: 'I am the treasurer' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(service.addAiMemory).toHaveBeenCalledWith('I am the treasurer'));
      expect(await screen.findByText('I am the treasurer', { selector: 'p' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Delete memory: Keep answers short' }));
      await waitFor(() => expect(service.deleteAiMemory).toHaveBeenCalledWith(1));
      await waitFor(() => expect(screen.queryByText('Keep answers short')).not.toBeInTheDocument());
    });

    it('deletes all memories after a confirm and shows the empty state', async () => {
      service.listAiMemories.mockResolvedValue({ data: [{ id: 1, content: 'One' }, { id: 2, content: 'Two' }] });
      service.deleteAllAiMemories.mockResolvedValue({ data: {} });
      renderPage();
      await openMemory();
      await screen.findByText('One');
      fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
      const dialogs = await screen.findAllByRole('button', { name: 'Delete all' });
      fireEvent.click(dialogs[dialogs.length - 1]);
      await waitFor(() => expect(service.deleteAllAiMemories).toHaveBeenCalled());
      expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
    });

    it('shows the empty state with nothing saved', async () => {
      renderPage();
      await openMemory();
      expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
      expect(screen.getByText(/remember that/)).toBeInTheDocument();
    });
  });

  describe('answers', () => {
    const openWithTwoAnswers = async () => {
      service.getAiConversation.mockResolvedValue({
        data: {
          conversation: conversation(3, 'Two answers'),
          messages: [
            { id: 1, role: 'user', content: 'first', status: 'completed', payload: null },
            storedAnswer(2, 'First answer.'),
            { id: 3, role: 'user', content: 'second', status: 'completed', payload: null },
            storedAnswer(4, 'Second answer.'),
          ],
        },
      });
      renderPage('/dashboard/ask-ai?c=3');
      await screen.findByText('Second answer.');
    };

    it('offers Regenerate on the last answer only', async () => {
      await openWithTwoAnswers();
      expect(screen.getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1);
      const last = screen.getByText('Second answer.').closest('article');
      expect(within(last).getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    });

    it('regenerates the last answer in the same conversation', async () => {
      await openWithTwoAnswers();
      const stream = deferredStream();
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
      expect(service.streamAiChat).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 3, regenerate: true }));
      expect(screen.queryByText('Second answer.')).not.toBeInTheDocument();
      await stream.reject(new Error('x'));
    });

    it('toggles feedback and sends the rating', async () => {
      await openWithTwoAnswers();
      const last = screen.getByText('Second answer.').closest('article');
      const helpful = within(last).getByRole('button', { name: 'Helpful' });
      fireEvent.click(helpful);
      expect(helpful).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => expect(service.sendAiMessageFeedback).toHaveBeenCalledWith(4, 'up'));
      fireEvent.click(within(last).getByRole('button', { name: 'Not helpful' }));
      await waitFor(() => expect(service.sendAiMessageFeedback).toHaveBeenCalledWith(4, 'down'));
      expect(helpful).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(within(last).getByRole('button', { name: 'Not helpful' }));
      await waitFor(() => expect(service.sendAiMessageFeedback).toHaveBeenCalledWith(4, null));
    });

    it('sends a follow-up chip from the answer blocks', async () => {
      await openWithTwoAnswers();
      const stream = deferredStream();
      fireEvent.click(screen.getAllByRole('button', { name: 'blocks:Answer title' })[1]);
      expect(service.streamAiChat).toHaveBeenCalledWith(expect.objectContaining({ message: 'Follow up?', topic: 'finance_health', conversationId: 3 }));
      await stream.reject(new Error('x'));
    });
  });
});
