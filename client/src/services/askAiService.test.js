import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSseParser, streamAiChat } from './askAiService';

const encoder = new TextEncoder();

function sse(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks, init = {}) {
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const conversation = { id: 12, title: 'Hello' };
const doneMessage = { id: 2, role: 'assistant', content: 'Hi there' };

function collect() {
  const events = [];
  return { events, onEvent: (name, data) => events.push([name, data]) };
}

describe('createSseParser', () => {
  const full = sse('meta', { a: 1 }) + ': keep-alive\n\n' + sse('delta', { text: 'héllo 😀' }) + sse('done', { ok: true });

  it('reads every event from one chunk', () => {
    const events = [];
    const parser = createSseParser((name, data) => events.push([name, data]));
    parser.push(full);
    parser.end();
    expect(events.map(([name]) => name)).toEqual(['meta', 'delta', 'done']);
    expect(events[1][1].text).toBe('héllo 😀');
  });

  it('gives the same events when split at every position', () => {
    for (let cut = 1; cut < full.length; cut += 1) {
      const events = [];
      const parser = createSseParser((name, data) => events.push([name, data]));
      parser.push(full.slice(0, cut));
      parser.push(full.slice(cut));
      parser.end();
      expect(events.map(([name]) => name)).toEqual(['meta', 'delta', 'done']);
    }
  });

  it('handles CRLF line endings, including a CR and LF split across chunks', () => {
    const crlf = full.replace(/\n/g, '\r\n');
    for (let cut = 1; cut < crlf.length; cut += 1) {
      const events = [];
      const parser = createSseParser((name, data) => events.push([name, data]));
      parser.push(crlf.slice(0, cut));
      parser.push(crlf.slice(cut));
      parser.end();
      expect(events.map(([name]) => name)).toEqual(['meta', 'delta', 'done']);
    }
  });

  it('delivers a final event with no trailing blank line', () => {
    const events = [];
    const parser = createSseParser((name, data) => events.push([name, data]));
    parser.push('event: done\ndata: {"ok":true}');
    expect(events).toHaveLength(0);
    parser.end();
    expect(events).toEqual([['done', { ok: true }]]);
  });

  it('ignores comment lines and unparseable data', () => {
    const events = [];
    const parser = createSseParser((name, data) => events.push([name, data]));
    parser.push(': hello\n\nevent: delta\ndata: not json\n\nevent: delta\n: inside\ndata: {"text":"x"}\n\n');
    parser.end();
    expect(events).toEqual([['delta', { text: 'x' }]]);
  });
});

describe('streamAiChat', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('auth_token', 'tok');
    localStorage.setItem('hiusa_selected_academic_period', JSON.stringify({ id: 7 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams events, sends the shared headers and resolves with the done data', async () => {
    const bytes = encoder.encode(sse('delta', { text: 'é😀' }));
    const chunks = [
      sse('meta', { conversation, user_message: { id: 1 } }),
      bytes.slice(0, bytes.length - 12),
      bytes.slice(bytes.length - 12),
      ': keep-alive\r\n\r\n',
      `event: done\r\ndata: ${JSON.stringify({ conversation, message: doneMessage })}`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(chunks));
    vi.stubGlobal('fetch', fetchMock);
    const { events, onEvent } = collect();

    const result = await streamAiChat({ conversationId: 12, message: 'hi', topic: 'x', onEvent });

    expect(result).toEqual({ conversation, message: doneMessage });
    expect(events.map(([name]) => name)).toEqual(['meta', 'delta', 'done']);
    expect(events[1][1].text).toBe('é😀');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ai\/assistant\/chat$/);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'X-Academic-Semester': '7',
    });
    expect(JSON.parse(init.body)).toEqual({ conversation_id: 12, message: 'hi', topic: 'x', regenerate: false });
  });

  it('treats a JSON body like a stream that only sent meta and done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ conversation, user_message: { id: 1 }, message: doneMessage }),
    ));
    const { events, onEvent } = collect();

    const result = await streamAiChat({ message: 'hi', onEvent });

    expect(result).toEqual({ conversation, message: doneMessage });
    expect(events.map(([name]) => name)).toEqual(['meta', 'done']);
  });

  it('rejects with the status and message from a JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Too many requests.' }, 429)));

    await expect(streamAiChat({ message: 'hi' })).rejects.toMatchObject({ status: 429, message: 'Too many requests.' });
  });

  it('rejects with the message of an error event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      streamResponse([sse('error', { message: 'Could not answer that right now. Try again.' })]),
    ));

    await expect(streamAiChat({ message: 'hi' })).rejects.toMatchObject({
      message: 'Could not answer that right now. Try again.',
    });
  });

  it('rejects when the stream ends without a done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([sse('meta', { conversation })])));

    await expect(streamAiChat({ message: 'hi' })).rejects.toBeInstanceOf(Error);
  });

  it('ends the session on a 401 like the Axios interceptor', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Unauthenticated.' }, 401)));

    await expect(streamAiChat({ message: 'hi' })).rejects.toMatchObject({ status: 401 });

    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('sign_out_notice')).toMatch(/session ended/i);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('rejects with an AbortError when the signal aborts', async () => {
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const controller = new AbortController();

    const pending = streamAiChat({ message: 'hi', signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with an AbortError when the signal aborts mid-stream', async () => {
    const controller = new AbortController();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(sse('meta', { conversation })));
        controller.signal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    ));
    const { events, onEvent } = collect();

    const pending = streamAiChat({ message: 'hi', signal: controller.signal, onEvent });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
