import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Tooltip } from '../../../components/ui';
import AiMarkdown from '../../../components/ai/AiMarkdown';
import AnswerBlocks from '../../../components/ai/AnswerBlocks';
import ActionCard from '../../../components/ai/ActionCard';
import { actionCopyText, actionOf } from '../../../components/ai/actionState';
import answerText from '../../../components/ai/answerText';
import ReasoningDisclosure from '../../../components/ai/ReasoningDisclosure';

const ACTION_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-ink-muted-strong transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-[42px]';

function useElapsedSeconds(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return seconds;
}

function ActionButton({ icon: Icon, children, ...rest }) {
  return (
    <button type="button" className={ACTION_CLASS} {...rest}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </button>
  );
}

function FeedbackButton({ icon: Icon, label, pressed, onClick }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-control text-ink-muted-strong transition-colors hover:bg-subtle hover:text-ink max-sm:h-[42px] max-sm:w-[42px] ${pressed ? 'bg-brand-50 text-brand-800' : ''}`}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function CopyAction({ getText }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ActionButton icon={copied ? Check : Copy} onClick={copy}>
      {copied ? 'Copied' : 'Copy'}
    </ActionButton>
  );
}

export default function ChatMessage({
  message,
  isLast = false,
  busy = false,
  onRegenerate,
  onFeedback,
  onAsk,
  actionLive = true,
  onActionChange,
}) {
  const streaming = Boolean(message.streaming);
  const seconds = useElapsedSeconds(streaming);
  const proseRef = useRef(null);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-card bg-brand-50 px-3.5 py-2.5 text-sm font-medium leading-6 text-ink">
          {message.content}
        </p>
      </div>
    );
  }

  const payload = message.payload || null;
  const action = actionOf(message);
  const resultShown = action?.status === 'done' && Boolean(action.result?.message);
  const stopped = message.status === 'stopped';
  const failed = message.status === 'failed';
  const stored = typeof message.id === 'number' || (typeof message.id === 'string' && message.id !== '');
  const reasoning = streaming
    ? { steps: message.statusLabel ? [message.statusLabel] : [], summary: message.reasoningText || '' }
    : payload?.reasoning || null;

  return (
    <article aria-label="Answer" aria-busy={streaming || undefined} className="min-w-0">
      {(streaming || reasoning) && (
        <ReasoningDisclosure reasoning={reasoning} live={streaming} seconds={streaming ? seconds : reasoning?.seconds} />
      )}
      {message.content && !resultShown && (
        <div ref={proseRef}>
          <AiMarkdown content={message.content} streaming={streaming} className="mt-2" />
        </div>
      )}
      {!streaming && payload && <AnswerBlocks payload={payload} onAsk={onAsk} disabled={busy} />}
      {!streaming && action && stored && (
        <ActionCard message={message} action={action} live={actionLive} onChange={onActionChange} />
      )}
      {payload?.notice && <p className="mt-2 text-xs font-medium text-ink-muted-strong">{payload.notice}</p>}
      {stopped && <p className="mt-2 text-xs font-medium text-ink-muted-strong">You stopped this answer.</p>}
      {failed && <p className="mt-2 text-xs font-medium text-danger-strong">This answer did not finish.</p>}
      {!streaming && (
        <div className="-ml-2.5 mt-2 flex flex-wrap items-center gap-0.5">
          {message.content && <CopyAction getText={() => (action ? actionCopyText(message) : answerText(proseRef.current) || message.content)} />}
          {isLast && onRegenerate && !action && (
            <ActionButton icon={RefreshCw} onClick={onRegenerate} disabled={busy}>
              Regenerate
            </ActionButton>
          )}
          {stored && !stopped && !failed && (
            <>
              <FeedbackButton
                icon={ThumbsUp}
                label="Helpful"
                pressed={message.feedback === 'up'}
                onClick={() => onFeedback?.(message, message.feedback === 'up' ? null : 'up')}
              />
              <FeedbackButton
                icon={ThumbsDown}
                label="Not helpful"
                pressed={message.feedback === 'down'}
                onClick={() => onFeedback?.(message, message.feedback === 'down' ? null : 'down')}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
}
