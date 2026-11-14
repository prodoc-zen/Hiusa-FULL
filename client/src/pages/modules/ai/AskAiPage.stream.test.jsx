import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AskAiPage from './AskAiPage';

vi.mock('../../../services/askAiService', async (importOriginal) => ({
  ...(await importOriginal()),
  getAiAssistantOverview: vi.fn(),
  listAiConversations: vi.fn(),
  getAiConversation: vi.fn(),
  listAiMemories: vi.fn(),
  sendAiMessageFeedback: vi.fn(),
}));

const service = await import('../../../services/askAiService');
const encoder = new TextEncoder();

const frame = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const conversation = (extra = {}) => ({ id: 12, title: 'Finance', preview: 'Finance is fine.', ...extra });

const finalMessage = {
  id: 2,
  role: 'assistant',
  content: 'Finance is **fine** this week.\n\n- Budget approved\n- Two receipts late',
  status: 'completed',
  feedback: null,
  payload: {
    title: 'Finance',
    reasoning: { seconds: 4, steps: ['Read 12 records'] },
    follow_ups: [{ label: 'And events?', question: 'And events?', topic: 'events' }],
  },
};

// A response whose body the test feeds by hand, so it can look at the screen between chunks.
function liveResponse() {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (bytes) => act(async () => { controller.enqueue(bytes); }),
    close: () => act(async () => { controller.close(); }),
  };
}

// Writes the text in pieces cut at the given byte offsets, whatever they fall inside.
async function pushCut(live, text, cuts) {
  const bytes = encoder.encode(text);
  const edges = [0, ...cuts, bytes.length];
  for (let i = 0; i < edges.length - 1; i += 1) {
    await live.push(bytes.slice(edges[i], edges[i + 1]));
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const composer = () => screen.getByLabelText('Message Ask AI');
const ask = (text) => {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.keyDown(composer(), { key: 'Enter' });
};
const sentBody = (fetchMock, call) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe('AskAiPage with the real stream parser and renderers', () => {
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service.getAiAssistantOverview.mockResolvedValue({ data: { user_first_name: 'Jade', starter_prompts: [] } });
    service.listAiConversations.mockResolvedValue({ data: [] });
    service.listAiMemories.mockResolvedValue({ data: [] });
    service.sendAiMessageFeedback.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function open() {
    render(
      <MemoryRouter initialEntries={['/dashboard/ask-ai']}>
        <AskAiPage />
      </MemoryRouter>,
    );
    await screen.findByText('Hi, Jade');
  }

  it('shows the live answer, a replace, the final answer and a regenerate as the person sees them', async () => {
    const first = liveResponse();
    fetchMock.mockResolvedValueOnce(first.response);
    await open();
    ask('how is finance?');

    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/event-stream, application/json');
    expect(sentBody(fetchMock, 0)).toEqual({ conversation_id: null, message: 'how is finance?', topic: null, regenerate: false });

    const meta = frame('meta', { conversation: conversation(), user_message: { id: 1, role: 'user', content: 'how is finance?' } });
    await pushCut(first, meta, [9, 40]);
    await pushCut(first, frame('status', { stage: 'reading', label: 'Reading your records' }), [15]);
    expect(screen.getByText('Reading your records')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Answer' })).toHaveAttribute('aria-busy', 'true');

    const draft = frame('delta', { text: 'Draft that will be thrown away <span class="bad' });
    await pushCut(first, draft, [20, draft.indexOf('hrown') + 2]);
    expect(screen.getByText(/Draft that will be thrown away/)).toBeInTheDocument();
    expect(document.querySelector('.ai-prose')).not.toHaveTextContent('<span');

    await pushCut(first, `: keep-alive\n\n${frame('replace', { text: '', notice: 'Replaced with the checked summary.' })}`, [4]);
    expect(screen.queryByText(/Draft that will be thrown away/)).not.toBeInTheDocument();

    const text = 'Finance is **fine** — é😀 this week.\n\n- Budget approved\n- Two receipts late';
    const deltas = frame('delta', { text: text.slice(0, 20) }) + frame('delta', { text: text.slice(20) });
    const bytes = encoder.encode(deltas);
    await first.push(bytes.slice(0, bytes.indexOf(0xf0) + 2));
    await first.push(bytes.slice(bytes.indexOf(0xf0) + 2));
    const prose = document.querySelector('.ai-prose');
    expect(within(prose).getByText('fine').tagName).toBe('STRONG');
    expect(prose).not.toHaveTextContent('**');
    expect(within(prose).getAllByRole('listitem')).toHaveLength(2);
    expect(prose).toHaveTextContent('é😀');

    await pushCut(first, frame('done', { conversation: conversation(), message: { ...finalMessage, content: text } }), [30, 120]);
    await first.close();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument());
    const answer = screen.getByRole('article', { name: 'Answer' });
    expect(answer).not.toHaveAttribute('aria-busy');
    expect(within(answer).getByText('Thought for 4 seconds')).toBeInTheDocument();
    expect(within(answer).getByRole('button', { name: 'And events?' })).toBeInTheDocument();
    expect(screen.getByText('Answer ready. Finance is fine.')).toBeInTheDocument();
    expect(screen.getAllByText('how is finance?', { selector: 'p' })).toHaveLength(1);

    const second = liveResponse();
    fetchMock.mockResolvedValueOnce(second.response);
    fireEvent.click(within(answer).getByRole('button', { name: 'Regenerate' }));
    expect(sentBody(fetchMock, 1)).toEqual({ conversation_id: 12, message: null, topic: null, regenerate: true });
    await waitFor(() => expect(screen.queryByText('Thought for 4 seconds')).not.toBeInTheDocument());
    expect(screen.getAllByText('how is finance?', { selector: 'p' })).toHaveLength(1);

    await pushCut(second, frame('delta', { text: 'Second try.' }), [10]);
    await pushCut(second, frame('done', { conversation: conversation(), message: { ...finalMessage, id: 3, content: 'Second try.' } }), [5]);
    await second.close();
    expect(await screen.findByText('Second try.')).toBeInTheDocument();
    expect(screen.queryByText(/this week/)).not.toBeInTheDocument();
  });

  it('keeps the partial answer, marked unfinished, when the stream closes without done', async () => {
    const live = liveResponse();
    fetchMock.mockResolvedValueOnce(live.response);
    await open();
    ask('how is finance?');
    await pushCut(live, frame('meta', { conversation: conversation(), user_message: { id: 1, role: 'user', content: 'how is finance?' } }), [10]);
    await pushCut(live, frame('delta', { text: 'Half of the answer' }), [12]);
    await live.close();

    expect(await screen.findByText('This answer did not finish.')).toBeInTheDocument();
    expect(screen.getByText('Half of the answer')).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the partial answer when an error event ends the stream', async () => {
    const live = liveResponse();
    fetchMock.mockResolvedValueOnce(live.response);
    await open();
    ask('how is finance?');
    await pushCut(live, frame('meta', { conversation: conversation(), user_message: { id: 1, role: 'user', content: 'how is finance?' } }), []);
    await pushCut(live, frame('delta', { text: 'Some words' }), []);
    await pushCut(live, frame('error', { message: 'Could not answer that right now. Try again.' }), [7]);
    await live.close();
    expect(await screen.findByText('Some words')).toBeInTheDocument();
    expect(screen.getByText('This answer did not finish.')).toBeInTheDocument();
  });

  it('shows the server message path as an ordinary failure for a 422 JSON body, not an offline warning', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'There is no message to answer.', errors: { message: ['required'] } }, 422));
    await open();
    ask('hello');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not answer that right now. Try again.');
    expect(alert).not.toHaveTextContent('offline');
  });

  it('drops a conversation that answers 404 and asks the same question in a new one', async () => {
    service.getAiConversation.mockResolvedValue({
      data: { conversation: conversation(), messages: [{ ...finalMessage, content: 'Old answer.' }] },
    });
    service.listAiConversations.mockResolvedValue({ data: [conversation()] });
    render(
      <MemoryRouter initialEntries={['/dashboard/ask-ai?c=12']}>
        <AskAiPage />
      </MemoryRouter>,
    );
    await screen.findByText('Old answer.');

    const fresh = liveResponse();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not found.' }, 404)).mockResolvedValueOnce(fresh.response);
    ask('and events?');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchMock, 0).conversation_id).toBe(12);
    expect(sentBody(fetchMock, 1)).toEqual({ conversation_id: null, message: 'and events?', topic: null, regenerate: false });
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
    expect(screen.queryByText('Old answer.')).not.toBeInTheDocument();

    await pushCut(fresh, frame('meta', { conversation: conversation({ id: 40 }), user_message: { id: 5, role: 'user', content: 'and events?' } }), []);
    await pushCut(fresh, frame('done', { conversation: conversation({ id: 40 }), message: { ...finalMessage, id: 6, content: 'Events are fine.' } }), []);
    await fresh.close();
    expect(await screen.findByText('Events are fine.')).toBeInTheDocument();
  });
});
