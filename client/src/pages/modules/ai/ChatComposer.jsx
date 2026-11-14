import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../../../components/ui';

export const MAX_MESSAGE_LENGTH = 2000;
const COUNTER_FROM = 1800;
const MAX_HEIGHT_PX = 144;
const NARROW_QUERY = '(max-width: 639px)';
const SHORT_PLACEHOLDER = 'Ask anything';
const LONG_PLACEHOLDER = 'Ask about your records or what to do next';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(NARROW_QUERY);
    if (!media) return undefined;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return narrow;
}

export default function ChatComposer({ ref, streaming, offline, blockedReason = '', onSend, onStop, initialText = '' }) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef(null);
  const id = useId();
  const narrow = useNarrow();

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const trimmed = text.trim();

  const submit = () => {
    if (streaming || offline || blockedReason || !trimmed) return;
    if (onSend(trimmed) !== false) setText('');
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2 rounded-card border border-line bg-surface p-2 focus-within:border-brand-600 focus-within:ring-[3px] focus-within:ring-accent/15">
        <label htmlFor={id} className="sr-only">Message Ask AI</label>
        <textarea
          id={id}
          ref={textareaRef}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={narrow ? SHORT_PLACEHOLDER : LONG_PLACEHOLDER}
          className="max-h-36 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base font-normal leading-5 text-ink outline-none focus-visible:outline-none! placeholder:text-ink-soft sm:text-sm"
        />
        {streaming ? (
          <Button variant="secondary" leftIcon={Square} onClick={onStop} aria-label="Stop answering">
            Stop
          </Button>
        ) : (
          <Button type="submit" leftIcon={ArrowUp} disabled={!trimmed || offline || Boolean(blockedReason)} aria-label="Send message">
            Send
          </Button>
        )}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3 px-1 text-xs font-medium text-ink-muted-strong">
        <p>
          {offline && 'You are offline. Reconnect to send a message.'}
          {!offline && blockedReason}
          {!offline && !blockedReason && 'Answers can be wrong. The linked record is the source of truth.'}
        </p>
        {text.length >= COUNTER_FROM && (
          <span className={`shrink-0 tabular-nums ${text.length >= MAX_MESSAGE_LENGTH ? 'text-danger-strong' : ''}`}>
            {text.length} / {MAX_MESSAGE_LENGTH}
          </span>
        )}
      </div>
    </form>
  );
}
