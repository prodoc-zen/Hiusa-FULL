import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowRight, Brain, History, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Drawer, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import {
  deleteAiConversation,
  deleteAllAiConversations,
  getAiAssistantOverview,
  getAiConversation,
  listAiConversations,
  renameAiConversation,
  sendAiMessageFeedback,
  streamAiChat,
} from '../../../services/askAiService';
import { actionOf, liveActionId } from '../../../components/ai/actionState';
import isSafePageHref from '../../../components/ai/safeHref';
import PrivacyConsentNeeded from '../../../components/ai/PrivacyConsentNeeded';
import { effectiveRole } from '../../../utils/collegeIdentity';
import { PRIVACY_CONSENT_RECORDED_EVENT, isPrivacyConsentRefusal } from '../../../utils/privacyNotice';
import ChatComposer from './ChatComposer';
import ChatMessage from './ChatMessage';
import ConversationList from './ConversationList';
import MemoryPanel from './MemoryPanel';

const NEAR_BOTTOM_PX = 96;
const WIDE_QUERY = '(min-width: 1280px)';
const TOUCH_QUERY = '(pointer: coarse)';
const TURN_GAP_PX = 8;
// Three labelled buttons wrap to two rows on a 360px phone, so the labels fold into the icons there.
const ICON_ONLY_NARROW = 'max-[400px]:sr-only';

const apiMessage = (err, fallback) => err?.response?.data?.message || fallback;

const asList = (data, key) => {
  const list = data?.[key] ?? data?.data ?? data;
  return Array.isArray(list) ? list : [];
};

const pagingOf = (data) => ({ hasMore: data?.has_more === true && Boolean(data?.next_before), before: data?.next_before ?? null });

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function readEvent(first, second) {
  if (typeof first === 'string') return [first, second || {}];
  return [first?.event ?? first?.type ?? first?.name, first?.data ?? second ?? {}];
}

function withKey(message) {
  return { ...message, key: `m-${message.id}` };
}

function failureMessage(err) {
  if (err?.status === 429 || err?.response?.status === 429) {
    const served = err?.serverMessage || err?.response?.data?.message;
    if (typeof served === 'string' && served.trim()) return served.trim();
    return 'Too many questions at once. Wait a moment, then try again.';
  }
  if (navigator.onLine === false) {
    return 'You seem to be offline. Check your connection, then try again.';
  }
  if (err instanceof TypeError) {
    return 'Could not reach HIUSA. Try again in a moment.';
  }
  return 'Could not answer that right now. Try again.';
}

function briefingTitle(title) {
  if (!title) return 'Today';
  if (title !== title.toUpperCase()) return title;
  const lower = title.toLowerCase().replace(/\b(sao|sbo|hiusa)\b/g, (word) => word.toUpperCase());
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const ACTION_EXAMPLES = {
  SUPER_ADMIN: ['Draft an announcement about enrollment week', 'Create an event for the organizations meeting'],
  DEPARTMENT_HEAD: ['Create an event for Friday at 3 pm', 'Draft an announcement about the general assembly'],
  ADMIN: ['Draft an announcement about the general assembly', 'Create an event for Friday at 3 pm'],
  SBO_OFFICER: ['Create an event for Friday at 3 pm', 'Draft an announcement about the general assembly'],
  STUDENT: ['Create a task to bring my ID on Monday', 'Draft a message to my organization officers'],
};

function storedUser() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user && typeof user === 'object' ? user : {};
  } catch {
    return {};
  }
}

// What each role is offered before the overview answers. They are the first questions the server
// lists for that role, so a tap lands on an answer the role is allowed to read. A role this page does
// not know gets the one question every role can ask.
const FALLBACK_STARTERS = {
  SUPER_ADMIN: [
    { id: 'sao-today', label: "What's on my desk today", question: 'What should I do today across student organizations?', topic: 'daily_priorities' },
    { id: 'sao-applications', label: 'Applications to approve', question: 'Which organization applications are waiting for my approval?', topic: 'applications_queue' },
    { id: 'sao-missing', label: 'Who is behind on requirements', question: "Which organizations haven't submitted their requirements?", topic: 'missing_submissions' },
  ],
  DEPARTMENT_HEAD: [
    { id: 'dh-today', label: "What's on my desk today", question: 'What should I do today for my college?', topic: 'daily_priorities' },
    { id: 'dh-approvals', label: 'Waiting for my approval', question: 'What is waiting for my approval right now?', topic: 'pending_approvals' },
    { id: 'dh-no-admin', label: 'Which organizations need a head', question: 'Which organizations in my college have no head yet?', topic: 'organizations_without_admin' },
  ],
  ADMIN: [
    { id: 'adm-today', label: "What's on my desk today", question: 'What should I do today for our organization?', topic: 'daily_priorities' },
    { id: 'adm-missing', label: 'What we still owe SAO', question: "What haven't we submitted yet?", topic: 'missing_submissions' },
    { id: 'adm-finance', label: 'Our budget and unpaid fees', question: 'How much budget is left, and how many student invoices are unpaid?', topic: 'finance_health' },
  ],
  SBO_OFFICER: [
    { id: 'off-today', label: "What's on my desk today", question: 'What should I do today as an officer?', topic: 'daily_priorities' },
    { id: 'off-tasks', label: 'My tasks', question: 'Which tasks are mine, and which are overdue?', topic: 'tasks_workload' },
    { id: 'off-orders', label: 'Orders to check', question: 'Which orders need payment checking or claiming?', topic: 'merchandise_orders' },
  ],
  STUDENT: [
    { id: 'stu-today', label: "What's on my plate", question: 'What do I need to do today?', topic: 'daily_priorities' },
    { id: 'stu-fees', label: 'What I owe', question: 'What fees do I still need to pay?', topic: 'finance_health' },
    { id: 'stu-clearance', label: "Who hasn't signed", question: "Who hasn't signed my clearance yet, and why?", topic: 'clearances_status' },
  ],
};

const NEUTRAL_STARTERS = [
  { id: 'any-today', label: 'What should I do today?', question: 'What should I do today?', topic: 'daily_priorities' },
];

function BriefingCard({ briefing, priorities }) {
  return (
    <section aria-label="Today's briefing" className="rounded-card border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{briefingTitle(briefing.title)}</h3>
      <p className="mt-1 text-sm leading-6 text-ink">{briefing.summary}</p>
      {priorities.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft border-t border-line-soft">
          {priorities.map((row, index) => (
            <li key={row.id || index} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-sm font-medium text-ink">{row.primary}</span>
              {isSafePageHref(row.href) && (
                <Link
                  to={row.href}
                  className="inline-flex min-h-[42px] shrink-0 items-center gap-1 rounded-control text-sm font-semibold text-brand-700 hover:text-brand-800 sm:min-h-9"
                >
                  {row.action_label || 'Open'}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewConversation({ overview, loading, error, consentRequired, onRetry, onAsk }) {
  const user = storedUser();
  const role = effectiveRole(user);
  const briefing = overview?.daily_briefing;
  const priorities = Array.isArray(briefing?.priorities) ? briefing.priorities.slice(0, 4) : [];
  const served = Array.isArray(overview?.starter_prompts) && overview.starter_prompts.length > 0
    ? overview.starter_prompts
    : (overview?.suggested_questions || []);
  const starters = overview ? served : (FALLBACK_STARTERS[role] || NEUTRAL_STARTERS);
  const firstName = overview?.user_first_name || user.first_name;
  const examples = ACTION_EXAMPLES[role];

  return (
    <div className="space-y-5 pt-4 sm:pt-8">
      <div>
        <h2 className="text-xl font-semibold text-ink sm:text-2xl">{firstName ? `Hi, ${firstName}` : 'Hi there'}</h2>
        {overview?.scope_label && (
          <p className="mt-1 text-sm font-medium text-ink-muted-strong">Showing records for {overview.scope_label}.</p>
        )}
      </div>

      {starters.length > 0 && (
        <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-2">
          {starters.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onAsk(item.question, item.topic)}
              className="min-h-[42px] rounded-control border border-line bg-surface px-3.5 py-2 text-left text-sm font-medium text-ink transition-colors hover:border-brand-600 hover:bg-subtle"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div role="status" aria-label="Loading today's briefing">
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {consentRequired && !loading && <PrivacyConsentNeeded />}

      {error && !consentRequired && !loading && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-medium text-ink-muted-strong">Could not load today&apos;s briefing.</p>
          <Button variant="secondary" size="sm" onClick={onRetry} className="max-sm:h-[42px]">Try again</Button>
        </div>
      )}

      {briefing?.summary && <BriefingCard briefing={briefing} priorities={priorities} />}

      {examples && (
        <p className="text-sm font-medium text-ink-muted-strong">
          You can also ask me to do things, such as &ldquo;{examples[0]}&rdquo; or &ldquo;{examples[1]}&rdquo;.
        </p>
      )}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div role="status" aria-label="Loading conversation" className="space-y-6 py-4">
      <div className="flex justify-end"><Skeleton className="h-10 w-2/3" /></div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export default function AskAiPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const cParam = searchParams.get('c');
  const qParam = searchParams.get('q');
  const topicParam = searchParams.get('topic');

  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [overviewConsent, setOverviewConsent] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [listConsent, setListConsent] = useState(false);
  const [listMore, setListMore] = useState({ hasMore: false, before: null });
  const [loadingMore, setLoadingMore] = useState(false);

  const [messages, setMessages] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState(null);
  const [notice, setNotice] = useState('');

  const [streaming, setStreaming] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [showJump, setShowJump] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const wide = useMediaQuery(WIDE_QUERY);
  const online = useOnline();

  const rootRef = useRef(null);
  const scrollerRef = useRef(null);
  const composerRef = useRef(null);
  const convIdRef = useRef(null);
  const sendingRef = useRef(false);
  const runRef = useRef(0);
  const abortRef = useRef(null);
  const loadRef = useRef(0);
  const loadingRef = useRef(false);
  const sendRef = useRef(null);
  const prevCParamRef = useRef(cParam);
  const atBottomRef = useRef(true);
  const handledQueryRef = useRef('');
  const typedIdsRef = useRef(new Set());

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError('');
    setOverviewConsent(false);
    try {
      const response = await getAiAssistantOverview();
      setOverview(response.data);
    } catch (err) {
      setOverviewConsent(isPrivacyConsentRefusal(err));
      setOverviewError(apiMessage(err, 'Try again in a moment.'));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    setListLoading(true);
    setListError(false);
    setListConsent(false);
    try {
      const response = await listAiConversations();
      setConversations(asList(response.data, 'conversations'));
      setListMore(pagingOf(response.data));
    } catch (err) {
      setListConsent(isPrivacyConsentRefusal(err));
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    loadConversations();
  }, [loadOverview, loadConversations]);

  // The consent dialog opens over the page when the server refuses for want of the agreement; once it is recorded
  // the refused loads can succeed, so run them again.
  const consentRefused = overviewConsent || listConsent;
  useEffect(() => {
    if (!consentRefused) return undefined;
    const reload = () => {
      if (overviewConsent) loadOverview();
      if (listConsent) loadConversations();
    };
    window.addEventListener(PRIVACY_CONSENT_RECORDED_EVENT, reload);
    return () => window.removeEventListener(PRIVACY_CONSENT_RECORDED_EVENT, reload);
  }, [consentRefused, overviewConsent, listConsent, loadOverview, loadConversations]);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMore || !listMore.before) return;
    setLoadingMore(true);
    try {
      const response = await listAiConversations({ before: listMore.before });
      const next = asList(response.data, 'conversations');
      setConversations((current) => [...current, ...next.filter((row) => !current.some((item) => item.id === row.id))]);
      setListMore(pagingOf(response.data));
    } catch {
      toast.error('Could not load more conversations.');
    } finally {
      setLoadingMore(false);
    }
  }, [listMore.before, loadingMore]);

  const upsertConversation = useCallback((conversation) => {
    if (!conversation?.id) return;
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
  }, []);

  const updateParams = useCallback((mutate, options = { replace: true }) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      mutate(next);
      return next;
    }, options);
  }, [setSearchParams]);

  const focusComposer = useCallback(() => {
    if (window.matchMedia?.(TOUCH_QUERY).matches) return;
    const active = document.activeElement;
    const typing = active && active !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (!typing) composerRef.current?.focus();
  }, []);

  const cancelRun = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    sendingRef.current = false;
    setStreaming(false);
  }, []);

  const resetToNew = useCallback(() => {
    cancelRun();
    loadRef.current += 1;
    loadingRef.current = false;
    convIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setSendError(null);
    setConvError(null);
    setConvLoading(false);
    setShowJump(false);
    atBottomRef.current = true;
  }, [cancelRun]);

  const send = useCallback(async (rawText, { topic = null, regenerate = false, source = 'link' } = {}) => {
    if (sendingRef.current || loadingRef.current) return false;
    const text = (rawText ?? '').trim();
    if (!regenerate && (!text || text.length > 2000)) return false;

    sendingRef.current = true;
    const requestedId = convIdRef.current;
    const runId = ++runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const userKey = `u-${runId}`;
    const answerKey = `a-${runId}`;
    const current = () => runRef.current === runId;
    const patchAnswer = (change) => {
      if (current()) setMessages((list) => list.map((m) => (m.key === answerKey ? { ...m, ...change(m) } : m)));
    };

    setStreaming(true);
    setSendError(null);
    setNotice('');
    atBottomRef.current = true;
    setMessages((list) => {
      const base = regenerate && list.at(-1)?.role === 'assistant' ? list.slice(0, -1) : list;
      const asked = regenerate ? [] : [{ key: userKey, role: 'user', content: text }];
      return [...base, ...asked, { key: answerKey, role: 'assistant', content: '', streaming: true, statusLabel: '', reasoningText: '' }];
    });

    let gone = false;
    let finished = false;
    let metaReceived = false;
    const finish = (result) => {
      if (!current() || !result?.message) return;
      finished = true;
      setMessages((list) => list.map((m) => (m.key === answerKey ? withKey(result.message) : m)));
      upsertConversation(result.conversation);
      setAnnouncement(`Answer ready. ${result.conversation?.preview || ''}`.trim());
    };

    const onEvent = (first, second) => {
      if (!current()) return;
      const [name, data] = readEvent(first, second);
      if (name === 'meta') {
        metaReceived = true;
        if (data.conversation?.id) {
          convIdRef.current = data.conversation.id;
          setActiveId(data.conversation.id);
          upsertConversation(data.conversation);
          updateParams((params) => params.set('c', String(data.conversation.id)));
        }
        if (data.user_message) {
          if (source === 'typed' && data.user_message.id != null) typedIdsRef.current.add(data.user_message.id);
          setMessages((list) => list.map((m) => (m.key === userKey ? withKey(data.user_message) : m)));
        }
      } else if (name === 'status') {
        patchAnswer(() => ({ statusLabel: data.label || '' }));
      } else if (name === 'reasoning') {
        patchAnswer((m) => ({ reasoningText: `${m.reasoningText}${data.delta || ''}` }));
      } else if (name === 'delta') {
        patchAnswer((m) => ({ content: `${m.content}${data.text || ''}` }));
      } else if (name === 'replace') {
        patchAnswer(() => ({ content: data.text || '', notice: data.notice || '' }));
      } else if (name === 'done') {
        finish(data);
      }
    };

    try {
      const result = await streamAiChat({
        conversationId: requestedId,
        message: regenerate ? undefined : text,
        topic,
        regenerate,
        source,
        signal: controller.signal,
        onEvent,
      });
      if (!finished) finish(result);
    } catch (err) {
      if (!current()) return true;
      if (err?.name === 'AbortError') {
        patchAnswer(() => ({ streaming: false, status: 'stopped' }));
        setAnnouncement('Answer stopped.');
      } else if (err?.status === 404 && requestedId !== null) {
        gone = true;
        convIdRef.current = null;
        setActiveId(null);
        setConversations((list) => list.filter((item) => item.id !== requestedId));
        updateParams((params) => params.delete('c'));
        setMessages([]);
      } else {
        const throttled = err?.status === 429 || err?.response?.status === 429;
        const restore = throttled && !metaReceived && !regenerate && source === 'typed';
        setMessages((list) => list.flatMap((m) => {
          if (restore && m.key === userKey) return [];
          if (m.key !== answerKey) return [m];
          return m.content ? [{ ...m, streaming: false, status: 'failed' }] : [];
        }));
        if (restore) composerRef.current?.restore(text);
        setSendError({ message: failureMessage(err), text, topic, source, regenerate: regenerate || metaReceived });
      }
    } finally {
      if (current()) {
        sendingRef.current = false;
        abortRef.current = null;
        setStreaming(false);
        focusComposer();
      }
    }
    if (gone) {
      if (!regenerate) sendRef.current(text, { topic, source });
      setNotice('That conversation is no longer available, so this is a new one.');
    }
    return true;
  }, [focusComposer, updateParams, upsertConversation]);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const retry = useCallback(() => {
    if (!sendError || sendingRef.current) return;
    const { text, topic, regenerate, source } = sendError;
    composerRef.current?.clearIf(text);
    if (!regenerate) {
      setMessages((list) => (list.at(-1)?.role === 'user' ? list.slice(0, -1) : list));
    }
    send(text, { topic, regenerate, source });
  }, [send, sendError]);

  const regenerate = useCallback(() => {
    const asked = messages.findLast((m) => m.role === 'user');
    send('', { regenerate: true, source: asked && typedIdsRef.current.has(asked.id) ? 'typed' : 'link' });
  }, [send, messages]);

  const ask = useCallback((first, second) => {
    const question = typeof first === 'object' ? first?.question : first;
    const topic = typeof first === 'object' ? first?.topic : second;
    if (!question) return;
    send(question, { topic: topic || null, source: 'link' });
  }, [send]);

  const openConversation = useCallback(async (id) => {
    cancelRun();
    const ticket = ++loadRef.current;
    loadingRef.current = true;
    setConvLoading(true);
    setConvError(null);
    setSendError(null);
    setNotice('');
    setMessages([]);
    try {
      const response = await getAiConversation(id);
      if (loadRef.current !== ticket) return;
      const data = response.data?.data ?? response.data;
      const header = data?.conversation ?? data;
      convIdRef.current = header.id;
      setActiveId(header.id);
      setMessages(asList(data, 'messages').map(withKey));
      atBottomRef.current = true;
    } catch (err) {
      if (loadRef.current !== ticket) return;
      if (err?.response?.status === 404) {
        convIdRef.current = null;
        setActiveId(null);
        setNotice('That conversation is no longer available, so this is a new one.');
        updateParams((params) => params.delete('c'));
      } else {
        setConvError(id);
      }
    } finally {
      if (loadRef.current === ticket) {
        loadingRef.current = false;
        setConvLoading(false);
      }
    }
  }, [cancelRun, updateParams]);

  useEffect(() => {
    const previous = prevCParamRef.current;
    prevCParamRef.current = cParam;
    if (!cParam) {
      const openId = convIdRef.current;
      // While a send runs, only a Back away from the very conversation on screen resets it; a stale
      // address update from an earlier conversation must not cancel the run.
      if (openId !== null && (!sendingRef.current || String(openId) === previous)) resetToNew();
      return;
    }
    if (String(convIdRef.current) === cParam) return;
    openConversation(cParam);
  }, [cParam, openConversation, resetToNew]);

  useEffect(() => {
    const question = (qParam || '').trim();
    if (!question || cParam) return;
    const signature = `${question}|${topicParam || ''}`;
    if (handledQueryRef.current === signature) return;
    handledQueryRef.current = signature;
    updateParams((params) => {
      params.delete('q');
      params.delete('topic');
    });
    send(question.slice(0, 2000), { topic: topicParam || null, source: 'link' });
  }, [qParam, topicParam, cParam, send, updateParams]);

  const newChat = useCallback(() => {
    resetToNew();
    setNotice('');
    updateParams((params) => params.delete('c'));
    setHistoryOpen(false);
    window.setTimeout(() => {
      if (!window.matchMedia?.(TOUCH_QUERY).matches) composerRef.current?.focus();
    }, 0);
  }, [resetToNew, updateParams]);

  const openFromList = useCallback((id) => {
    setHistoryOpen(false);
    if (id === convIdRef.current) return;
    updateParams((params) => params.set('c', String(id)), { replace: false });
  }, [updateParams]);

  const renameConversation = useCallback(async (id, title) => {
    try {
      await renameAiConversation(id, title);
      setConversations((list) => list.map((item) => (item.id === id ? { ...item, title } : item)));
      return true;
    } catch (err) {
      toast.error(apiMessage(err, 'Could not rename that conversation.'));
      return false;
    }
  }, []);

  const removeConversation = useCallback(async (id) => {
    try {
      await deleteAiConversation(id);
      setConversations((list) => list.filter((item) => item.id !== id));
      if (id === convIdRef.current) newChat();
      return true;
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete that conversation.'));
      return false;
    }
  }, [newChat]);

  const removeAllConversations = useCallback(async () => {
    try {
      await deleteAllAiConversations();
      setConversations([]);
      setListMore({ hasMore: false, before: null });
      newChat();
      return true;
    } catch (err) {
      toast.error(apiMessage(err, 'Could not delete your conversations.'));
      return false;
    }
  }, [newChat]);

  const giveFeedback = useCallback(async (message, rating) => {
    const apply = (value) => setMessages((list) => list.map((m) => (m.key === message.key ? { ...m, feedback: value } : m)));
    const previous = message.feedback ?? null;
    apply(rating);
    try {
      await sendAiMessageFeedback(message.id, rating);
    } catch {
      apply(previous);
      toast.error('Could not save your feedback.');
    }
  }, []);

  useEffect(() => {
    const scroller = rootRef.current?.closest('main') || document.scrollingElement;
    scrollerRef.current = scroller;
    if (!scroller) return undefined;
    const onScroll = () => {
      const near = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;
      atBottomRef.current = near;
      setShowJump(!near);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // Follow the answer down, but stop once the question that started this turn reaches the top, so a
  // long answer is read from its start. A short one still ends at the bottom.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !atBottomRef.current) return;
    let target = scroller.scrollHeight;
    const lastTurn = rootRef.current?.querySelector('[role="log"]')?.lastElementChild;
    const turnStart = lastTurn?.tagName === 'ARTICLE' ? (lastTurn.previousElementSibling || lastTurn) : null;
    if (turnStart) {
      const edge = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      const offset = turnStart.getBoundingClientRect().top - edge + scroller.scrollTop;
      target = Math.min(target, Math.max(offset - TURN_GAP_PX, 0));
    }
    scroller.scrollTop = target;
  }, [messages]);

  const jumpToLatest = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    atBottomRef.current = true;
    scroller.scrollTop = scroller.scrollHeight;
    setShowJump(false);
  };

  const listProps = {
    conversations,
    activeId,
    loading: listLoading,
    error: listError,
    consentRequired: listConsent,
    onRetry: loadConversations,
    onOpen: openFromList,
    onNew: newChat,
    onRename: renameConversation,
    onDelete: removeConversation,
    onDeleteAll: removeAllConversations,
    hasMore: listMore.hasMore,
    loadingMore,
    onLoadMore: loadMoreConversations,
  };

  const sendFromComposer = (text) => {
    if (sendingRef.current || loadingRef.current) return false;
    send(text, { source: 'typed' });
    return true;
  };

  const replaceMessage = useCallback((next) => {
    setMessages((list) => list.map((m) => (m.id === next.id && m.role === 'assistant' ? { ...next, key: m.key } : m)));
  }, []);

  const askAgain = useCallback((message) => {
    const index = messages.findIndex((m) => m.key === message.key);
    const asked = messages.slice(0, Math.max(index, 0)).findLast((m) => m.role === 'user');
    if (asked?.content) send(asked.content, { source: 'typed' });
  }, [send, messages]);

  const liveActionMessageId = liveActionId(messages);
  const lastIndex = messages.length - 1;
  const isNew = messages.length === 0 && !convLoading && !convError;

  return (
    <div ref={rootRef} className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <PageHeader
        title="Ask AI"
        actions={(
          <>
            {!wide && <Button variant="secondary" leftIcon={Plus} onClick={newChat}><span className={ICON_ONLY_NARROW}>New chat</span></Button>}
            {!wide && <Button variant="secondary" leftIcon={History} onClick={() => setHistoryOpen(true)}><span className={ICON_ONLY_NARROW}>History</span></Button>}
            <Button variant="secondary" leftIcon={Brain} onClick={() => setMemoryOpen(true)}><span className={ICON_ONLY_NARROW}>Memory</span></Button>
          </>
        )}
      />

      <div className="flex min-h-0 flex-1 gap-8">
        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-[760px] flex-1 py-4">
            {notice && <p role="status" className="mb-3 text-xs font-medium text-ink-muted-strong">{notice}</p>}

            {convLoading && <ConversationSkeleton />}
            {convError && (
              <ErrorState
                title="Could not open that conversation"
                onRetry={() => openConversation(convError)}
              />
            )}
            {isNew && (
              <NewConversation
                overview={overview}
                loading={overviewLoading}
                error={overviewError}
                consentRequired={overviewConsent}
                onRetry={loadOverview}
                onAsk={ask}
              />
            )}

            {messages.length > 0 && (
              <div role="log" aria-label="Conversation" aria-live="off" className="space-y-6">
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.key}
                    message={message}
                    isLast={index === lastIndex}
                    busy={streaming}
                    onRegenerate={activeId && !streaming ? regenerate : undefined}
                    onFeedback={giveFeedback}
                    onAsk={ask}
                    actionLive={!actionOf(message) || message.id === liveActionMessageId}
                    onActionChange={replaceMessage}
                    onAskAgain={askAgain}
                  />
                ))}
              </div>
            )}

            {sendError && (
              <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-danger/30 bg-danger-tint px-3.5 py-2.5">
                <p className="min-w-0 flex-1 text-sm font-medium text-danger-strong">{sendError.message}</p>
                <Button variant="secondary" size="sm" onClick={retry} className="max-sm:h-[42px]">Try again</Button>
              </div>
            )}
            <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
          </div>

          <div className="sticky -bottom-3 -mx-3 -mb-3 bg-page px-3 pb-3 pt-2 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
            <div className="relative mx-auto w-full max-w-[760px]">
              {showJump && messages.length > 0 && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="absolute -top-12 left-1/2 inline-flex min-h-[42px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink shadow-card hover:bg-subtle sm:min-h-9"
                >
                  <ArrowDown size={14} aria-hidden="true" />
                  Jump to latest
                </button>
              )}
              <ChatComposer
                ref={composerRef}
                streaming={streaming}
                offline={!online}
                blockedReason={convLoading ? 'Opening your conversation. You can send once it has loaded.' : ''}
                onSend={sendFromComposer}
                onStop={stop}
              />
            </div>
          </div>
        </section>

        {wide && (
          <aside aria-label="History" className="sticky top-0 max-h-[calc(100dvh-10rem)] w-72 shrink-0 self-start overflow-y-auto py-4">
            <ConversationList {...listProps} />
          </aside>
        )}
      </div>

      {!wide && (
        <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="History" width="max-w-sm">
          <ConversationList {...listProps} />
        </Drawer>
      )}
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}
