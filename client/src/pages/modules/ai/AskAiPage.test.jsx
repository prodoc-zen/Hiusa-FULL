import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
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
  confirmAiAction: vi.fn(),
  cancelAiAction: vi.fn(),
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

function BackProbe() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>history back</button>;
}

function renderPage(url = '/dashboard/ask-ai') {
  const entries = Array.isArray(url) ? url : [url];
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <AskAiPage />
      <BackProbe />
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
    service.streamAiChat.mockReset();
    service.getAiConversation.mockReset();
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

  it('retries with regenerate and no second question when the failure came after meta', async () => {
    const first = deferredStream();
    renderPage();
    await ready();
    type('question');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await first.emit('meta', {
      conversation: conversation(12, 'Question'),
      user_message: { id: 1, role: 'user', content: 'question' },
    });
    await first.reject(new Error('boom'));
    const alert = await screen.findByRole('alert');

    const second = deferredStream();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(service.streamAiChat).toHaveBeenCalledTimes(2);
    const call = service.streamAiChat.mock.calls[1][0];
    expect(call.regenerate).toBe(true);
    expect(call.conversationId).toBe(12);
    expect(call.message).toBeUndefined();
    expect(screen.getAllByText('question', { selector: 'p' })).toHaveLength(1);
    await second.reject(new Error('boom'));
  });

  it('appends later deltas to the text of a replace event, including an empty one', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    type('question');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await stream.emit('delta', { text: 'Discarded draft. ' });
    await stream.emit('replace', { text: 'Verified start. ' });
    expect(screen.getByTestId('markdown')).toHaveTextContent('Verified start.');
    await stream.emit('delta', { text: 'More.' });
    expect(screen.getByTestId('markdown').textContent).toBe('Verified start. More.');

    await stream.emit('replace', { text: '' });
    await stream.emit('delta', { text: 'Other provider.' });
    expect(screen.getByTestId('markdown').textContent).toBe('Other provider.');
    await stream.reject(new Error('x'));
  });

  it('shows the header New chat only when the list is not inline', async () => {
    const original = window.matchMedia;
    const stub = (matches) => {
      window.matchMedia = vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    };
    try {
      stub(false);
      const narrow = renderPage();
      await ready();
      expect(screen.getAllByRole('button', { name: 'New chat' })).toHaveLength(1);
      narrow.unmount();

      stub(true);
      renderPage();
      await ready();
      expect(screen.getAllByRole('button', { name: 'New chat' })).toHaveLength(1);
      expect(within(screen.getByRole('complementary', { name: 'History' })).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('shows the briefing title in sentence case', async () => {
    service.getAiAssistantOverview.mockResolvedValue({
      data: { ...overview, daily_briefing: { ...overview.daily_briefing, title: "TODAY'S ORGANIZATION ACTION PLAN" } },
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: "Today's organization action plan" })).toBeInTheDocument();
  });

  it.each([
    ['rate limit', 'Too many questions. Try again in a minute.'],
    ['one running answer', 'Wait for the current answer to finish.'],
  ])('shows the server message on a 429 (%s), keeps the text in the composer and never retries by itself', async (_name, served) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('question');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      expect(composer()).toHaveValue('');
      await stream.reject(Object.assign(new Error(served), { status: 429, serverMessage: served }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(served);
      expect(composer()).toHaveValue('question');
      expect(screen.queryByText('question', { selector: 'p' })).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(60000); });
      expect(service.streamAiChat).toHaveBeenCalledTimes(1);

      const second = deferredStream();
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      expect(service.streamAiChat).toHaveBeenCalledTimes(2);
      expect(service.streamAiChat.mock.calls[1][0].message).toBe('question');
      expect(composer()).toHaveValue('');
      await second.reject(new Error('x'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the wait message when a 429 carries no server message', async () => {
    const stream = deferredStream();
    renderPage();
    await ready();
    type('question');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await stream.reject(Object.assign(new Error('x'), { status: 429 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait a moment');
  });

  it('links a briefing row only when its address is a safe page', async () => {
    service.getAiAssistantOverview.mockResolvedValue({
      data: {
        ...overview,
        daily_briefing: {
          ...overview.daily_briefing,
          priorities: [
            { id: 'p1', primary: 'Safe row', href: '/dashboard/super-admin/compliance', action_label: 'Review' },
            { id: 'p2', primary: 'Loop row', href: '/dashboard/ask-ai?q=hi&topic=x', action_label: 'Loop' },
            { id: 'p3', primary: 'Topic row', href: '/dashboard/events?topic=finance', action_label: 'Topic' },
          ],
        },
      },
    });
    renderPage();
    await ready();
    expect(await screen.findByRole('link', { name: /Review/ })).toHaveAttribute('href', '/dashboard/super-admin/compliance');
    expect(screen.getByText('Loop row')).toBeInTheDocument();
    expect(screen.getByText('Topic row')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Loop/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Topic/ })).not.toBeInTheDocument();
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

  describe('sending and loading', () => {
    const loaded = (id = 7) => ({
      data: {
        conversation: conversation(id, 'Missing requirements'),
        messages: [
          { id: 1, role: 'user', content: 'who is missing?', status: 'completed', payload: null },
          storedAnswer(2, 'Three organizations are missing files.'),
        ],
      },
    });

    it('refuses a send while a conversation loads, keeps the text and says why, then sends into that conversation', async () => {
      let resolveLoad;
      service.getAiConversation.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
      renderPage('/dashboard/ask-ai?c=7');
      await screen.findByRole('status', { name: 'Loading conversation' });

      type('hello');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      expect(service.streamAiChat).not.toHaveBeenCalled();
      expect(composer()).toHaveValue('hello');
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
      expect(screen.getByText(/once it has loaded/)).toBeInTheDocument();

      await act(async () => resolveLoad(loaded()));
      expect(await screen.findByText('Three organizations are missing files.')).toBeInTheDocument();
      expect(service.streamAiChat).not.toHaveBeenCalled();
      expect(composer()).toHaveValue('hello');
      expect(screen.queryByText(/once it has loaded/)).not.toBeInTheDocument();

      const stream = deferredStream();
      fireEvent.keyDown(composer(), { key: 'Enter' });
      expect(service.streamAiChat).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 7, message: 'hello' }));
      await stream.reject(new Error('x'));
    });

    it('does not let a late load replace the conversation the person moved to', async () => {
      let resolveSlow;
      service.getAiConversation.mockImplementation((id) => (
        id === '7'
          ? new Promise((resolve) => { resolveSlow = resolve; })
          : Promise.resolve({ data: { conversation: conversation(8, 'Other'), messages: [storedAnswer(9, 'The other answer.')] } })
      ));
      service.listAiConversations.mockResolvedValue({ data: [conversation(7, 'Slow'), conversation(8, 'Other')] });
      renderPage(['/dashboard/ask-ai?c=7']);
      await screen.findByRole('status', { name: 'Loading conversation' });
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      const list = await screen.findByRole('navigation', { name: 'Conversations' });
      fireEvent.click(await within(list).findByRole('button', { name: 'Other' }));
      expect(await screen.findByText('The other answer.')).toBeInTheDocument();

      await act(async () => resolveSlow(loaded(7)));
      expect(screen.getByText('The other answer.')).toBeInTheDocument();
      expect(screen.queryByText('Three organizations are missing files.')).not.toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent('?c=8');
    });

    it('does not send ?q while a conversation is named by ?c', async () => {
      service.getAiConversation.mockResolvedValue(loaded());
      renderPage('/dashboard/ask-ai?c=7&q=hello');
      await screen.findByText('Three organizations are missing files.');
      expect(service.streamAiChat).not.toHaveBeenCalled();
    });

    it('keeps the question text when the send is refused', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('first');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      type('second');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      expect(composer()).toHaveValue('second');
      await stream.reject(new Error('x'));
    });

    it('regenerates after an early Stop, when nothing was stored for the answer', async () => {
      const first = deferredStream();
      renderPage();
      await ready();
      type('question');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await first.emit('meta', { conversation: conversation(14, 'Question'), user_message: { id: 1, role: 'user', content: 'question' } });
      fireEvent.click(screen.getByRole('button', { name: 'Stop answering' }));
      await screen.findByText('You stopped this answer.');

      const second = deferredStream();
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
      expect(service.streamAiChat).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: 14, regenerate: true }));
      expect(screen.queryByText('You stopped this answer.')).not.toBeInTheDocument();
      expect(screen.getAllByText('question', { selector: 'p' })).toHaveLength(1);
      await second.reject(new Error('x'));
    });

    it('announces plain text from the preview, announces Stop, and marks the streaming answer busy', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('question');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await stream.emit('meta', { conversation: conversation(12, 'Q'), user_message: { id: 1, role: 'user', content: 'question' } });
      await stream.emit('delta', { text: '**Bold** start' });
      expect(screen.getByRole('article', { name: 'Answer' })).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Stop answering' }));
      await waitFor(() => expect(screen.getByText('Answer stopped.')).toBeInTheDocument());
      expect(screen.getByRole('article', { name: 'Answer' })).not.toHaveAttribute('aria-busy');

      const second = deferredStream();
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
      const message = storedAnswer(2, '**Marco**, all good.');
      await second.resolve({ conversation: conversation(12, 'Q', { preview: 'Marco, all good.' }), message });
      expect(screen.getByText('Answer ready. Marco, all good.')).toBeInTheDocument();
    });

    it('drops the dead conversation on a 404 and asks the same question in a new one', async () => {
      service.listAiConversations.mockResolvedValue({ data: [conversation(7, 'Missing requirements')] });
      service.getAiConversation.mockResolvedValue(loaded());
      renderPage('/dashboard/ask-ai?c=7');
      await screen.findByText('Three organizations are missing files.');

      const first = deferredStream();
      type('and finance?');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      const second = deferredStream();
      await first.reject(Object.assign(new Error('Not found.'), { status: 404 }));

      expect(service.streamAiChat).toHaveBeenCalledTimes(2);
      expect(service.streamAiChat.mock.calls[0][0].conversationId).toBe(7);
      expect(service.streamAiChat.mock.calls[1][0]).toEqual(expect.objectContaining({ conversationId: null, message: 'and finance?', regenerate: false }));
      expect(screen.getByText(/no longer available/)).toBeInTheDocument();
      expect(screen.queryByText('Three organizations are missing files.')).not.toBeInTheDocument();
      expect(screen.getAllByText('and finance?', { selector: 'p' })).toHaveLength(1);
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/dashboard\/ask-ai$/);

      await second.reject(Object.assign(new Error('Not found.'), { status: 404 }));
      expect(service.streamAiChat).toHaveBeenCalledTimes(2);
    });

    it('says the connection failed, not that the person is offline, for a network error while online', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('question');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await stream.reject(new TypeError('Failed to fetch'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach HIUSA');
    });

    it('keeps the partial answer, marked unfinished, when the stream fails after text arrived', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('question');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await stream.emit('meta', { conversation: conversation(12, 'Question'), user_message: { id: 1, role: 'user', content: 'question' } });
      await stream.emit('delta', { text: 'Half an answer' });
      await stream.reject(new Error('dropped'));

      expect(screen.getByTestId('markdown')).toHaveTextContent('Half an answer');
      expect(screen.getByText('This answer did not finish.')).toBeInTheDocument();
      const alert = await screen.findByRole('alert');
      expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();

      const retry = deferredStream();
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
      expect(service.streamAiChat).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: 12, regenerate: true }));
      expect(screen.queryByText('Half an answer')).not.toBeInTheDocument();
      await retry.reject(new Error('x'));
    });

    it('treats Back to the page without ?c during a stream like New chat', async () => {
      service.getAiConversation.mockResolvedValue(loaded());
      renderPage(['/dashboard/ask-ai', '/dashboard/ask-ai?c=7']);
      await screen.findByText('Three organizations are missing files.');
      const stream = deferredStream();
      type('and finance?');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await stream.emit('delta', { text: 'Streaming' });

      fireEvent.click(screen.getByRole('button', { name: 'history back' }));
      await ready();
      expect(stream.signal.aborted).toBe(true);
      expect(screen.queryByText('Three organizations are missing files.')).not.toBeInTheDocument();
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/dashboard\/ask-ai$/);
    });
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

  describe('request source and actions', () => {
    const lastCall = () => service.streamAiChat.mock.calls.at(-1)[0];

    const proposalMessage = (id, status = 'awaiting_confirmation', title = 'Create an event') => ({
      id,
      role: 'assistant',
      content: `Proposal ${id}.`,
      status: 'completed',
      feedback: null,
      payload: {
        action: {
          key: 'create_event',
          title,
          status,
          submit_label: `Create ${id}`,
          fields: [{ name: 'title', label: `Title ${id}`, type: 'text', required: true, value: 'Assembly', max: 255, help: null, options: null }],
          errors: {},
          result: null,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
      },
    });

    it('marks a composer send as typed', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('create an event');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      expect(lastCall().source).toBe('typed');
      await stream.reject(new Error('x'));
    });

    it('marks a starter prompt as a link', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Who has not submitted?' }));
      expect(lastCall().source).toBe('link');
      await stream.reject(new Error('x'));
    });

    it('marks the ?q= address as a link', async () => {
      const stream = deferredStream();
      renderPage('/dashboard/ask-ai?q=Create%20an%20event&topic=x');
      await waitFor(() => expect(service.streamAiChat).toHaveBeenCalledTimes(1));
      expect(lastCall().source).toBe('link');
      await stream.reject(new Error('x'));
    });

    it('marks a follow-up chip as a link', async () => {
      service.getAiConversation.mockResolvedValue({
        data: { conversation: conversation(3, 'One'), messages: [{ id: 1, role: 'user', content: 'q', status: 'completed', payload: null }, storedAnswer(2, 'A.')] },
      });
      renderPage('/dashboard/ask-ai?c=3');
      await screen.findByText('A.');
      const stream = deferredStream();
      fireEvent.click(screen.getByRole('button', { name: 'blocks:Answer title' }));
      expect(lastCall().source).toBe('link');
      await stream.reject(new Error('x'));
    });

    it('keeps the source on Try again after a failed send', async () => {
      const first = deferredStream();
      renderPage();
      await ready();
      type('create an event');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await first.reject(Object.assign(new Error('x'), { status: 500 }));
      const second = deferredStream();
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      expect(lastCall().source).toBe('typed');
      await second.reject(Object.assign(new Error('x'), { status: 500 }));
    });

    it('regenerates a typed answer as typed and a stored one as a link', async () => {
      const stream = deferredStream();
      renderPage();
      await ready();
      type('how is finance?');
      fireEvent.keyDown(composer(), { key: 'Enter' });
      await stream.emit('meta', { conversation: conversation(12, 'Finance'), user_message: { id: 1, role: 'user', content: 'how is finance?' } });
      await stream.resolve({ conversation: conversation(12, 'Finance'), message: storedAnswer(2, 'Fine.') });
      await screen.findByText('Fine.');
      const again = deferredStream();
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
      expect(lastCall()).toEqual(expect.objectContaining({ regenerate: true, source: 'typed' }));
      await again.reject(new Error('x'));
    });

    it('regenerates an answer loaded from history as a link', async () => {
      service.getAiConversation.mockResolvedValue({
        data: { conversation: conversation(3, 'One'), messages: [{ id: 1, role: 'user', content: 'q', status: 'completed', payload: null }, storedAnswer(2, 'A.')] },
      });
      renderPage('/dashboard/ask-ai?c=3');
      await screen.findByText('A.');
      const stream = deferredStream();
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
      expect(lastCall()).toEqual(expect.objectContaining({ regenerate: true, source: 'link' }));
      await stream.reject(new Error('x'));
    });

    it('lets only the newest awaiting card be pressed and replaces a message with the confirmed one', async () => {
      service.getAiConversation.mockResolvedValue({
        data: {
          conversation: conversation(3, 'Actions'),
          messages: [
            { id: 1, role: 'user', content: 'one', status: 'completed', payload: null },
            proposalMessage(2),
            { id: 3, role: 'user', content: 'two', status: 'completed', payload: null },
            proposalMessage(4),
          ],
        },
      });
      renderPage('/dashboard/ask-ai?c=3');
      await screen.findByText('Proposal 4.');
      expect(screen.getByLabelText(/^Title 2/)).toHaveAttribute('readonly');
      expect(screen.getByText('A newer request replaced this one.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Create 2' })).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^Title 4/)).not.toHaveAttribute('readonly');

      service.confirmAiAction.mockResolvedValue({
        data: {
          message: {
            ...proposalMessage(4, 'done'),
            content: 'Event created.',
            payload: { action: { ...proposalMessage(4, 'done').payload.action, result: { message: 'Event created.', href: '/dashboard/events/9', action_label: 'Open event' } } },
          },
        },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create 4' }));
      expect(await screen.findByRole('link', { name: /Open event/ })).toHaveAttribute('href', '/dashboard/events/9');
      expect(service.confirmAiAction).toHaveBeenCalledWith(4, { title: 'Assembly' });
      expect(screen.getByText('A newer request replaced this one.')).toBeInTheDocument();
    });

    it('tells the person they can ask it to do things, with examples for their role', async () => {
      localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
      try {
        renderPage();
        await ready();
        expect(screen.getByText(/You can also ask me to do things/)).toHaveTextContent('Create an event for Friday at 3 pm');
        expect(screen.getByText(/You can also ask me to do things/)).toHaveTextContent('Draft an announcement about the general assembly');
      } finally {
        localStorage.removeItem('user');
      }
    });

    it('leaves the line out when the role is unknown', async () => {
      renderPage();
      await ready();
      expect(screen.queryByText(/You can also ask me to do things/)).not.toBeInTheDocument();
    });
  });
});
