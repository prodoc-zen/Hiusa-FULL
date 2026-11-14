import api, { API_BASE_URL, clearApiCache } from './api';
import { clearAuthSession, rememberSignOutNotice } from '../utils/authSession';
import { readSelectedPeriod } from '../utils/academicPeriodStore';

export const getAiAssistantOverview = () => api.get('/ai/assistant');

export const askAiAssistant = (payload) => api.post('/ai/assistant/ask', payload);

export const listAiConversations = (params) => api.get('/ai/assistant/conversations', { params, cache: false });

export const getAiConversation = (id) => api.get(`/ai/assistant/conversations/${id}`, { cache: false });

export const renameAiConversation = (id, title) => api.patch(`/ai/assistant/conversations/${id}`, { title });

export const deleteAiConversation = (id) => api.delete(`/ai/assistant/conversations/${id}`);

export const deleteAllAiConversations = () => api.delete('/ai/assistant/conversations');

export const sendAiMessageFeedback = (messageId, rating) =>
  api.post(`/ai/assistant/messages/${messageId}/feedback`, { rating });

export const listAiMemories = () => api.get('/ai/assistant/memories', { cache: false });

export const addAiMemory = (content) => api.post('/ai/assistant/memories', { content });

export const deleteAiMemory = (id) => api.delete(`/ai/assistant/memories/${id}`);

export const deleteAllAiMemories = () => api.delete('/ai/assistant/memories');

const GENERIC_ERROR = 'Could not answer that right now. Try again.';

function streamError(message, status, data) {
  const error = new Error(message || GENERIC_ERROR);
  if (status) error.status = status;
  if (data?.errors) error.validationErrors = data.errors;
  return error;
}

// Mirrors the Axios 401 interceptor in api.js, which a fetch call never reaches.
function endSession() {
  const hadSession = Boolean(localStorage.getItem('auth_token'));
  clearApiCache();
  clearAuthSession();
  if (hadSession) rememberSignOutNotice('Your session ended. Sign in again to continue.');
  window.location.assign(hadSession ? '/login' : '/');
}

function parseBlock(block) {
  let name = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') name = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  try {
    return { name, data: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function createSseParser(onEvent) {
  let buffer = '';

  const drain = (final) => {
    // A trailing CR may be the first half of a CRLF split across chunks, so it waits for the next chunk.
    buffer = buffer.replace(/\r\n/g, '\n').replace(final ? /\r/g : /\r(?!$)/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const event = parseBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event) onEvent(event.name, event.data);
      boundary = buffer.indexOf('\n\n');
    }
    if (final && buffer.trim() !== '') {
      const event = parseBlock(buffer);
      buffer = '';
      if (event) onEvent(event.name, event.data);
    }
  };

  return {
    push(text) {
      buffer += text;
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}

export async function streamAiChat({ conversationId = null, message, topic = null, regenerate = false, signal, onEvent } = {}) {
  const headers = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const token = localStorage.getItem('auth_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const period = readSelectedPeriod();
  if (period) headers['X-Academic-Semester'] = String(period.id);

  const emit = (name, data) => {
    if (onEvent) onEvent(name, data);
  };

  const response = await fetch(`${API_BASE_URL}/ai/assistant/chat`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      conversation_id: conversationId,
      message: message ?? null,
      topic,
      regenerate: Boolean(regenerate),
    }),
  });

  if (response.status === 401) {
    endSession();
    throw streamError('Your session ended. Sign in again to continue.', 401);
  }

  const contentType = response.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    throw streamError(data?.message, response.status, data);
  }

  let done = null;
  let failure = null;
  const handle = (name, data) => {
    emit(name, data);
    if (name === 'done') done = data;
    if (name === 'error') failure = data;
  };

  if (!isStream) {
    const data = await response.json();
    clearApiCache();
    handle('meta', { conversation: data.conversation, user_message: data.user_message });
    handle('done', { conversation: data.conversation, message: data.message });
    return done;
  }

  const parser = createSseParser(handle);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }

  if (failure) throw streamError(failure.message, response.status, null);
  if (!done) throw streamError(GENERIC_ERROR, response.status);
  clearApiCache();
  return done;
}
