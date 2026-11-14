import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../../../components/ui';

export const MAX_MESSAGE_LENGTH = 2000;
const COUNTER_FROM = 1800;
const MAX_HEIGHT_PX = 144;

export default function ChatComposer({ ref, streaming, offline, onSend, onStop, initialText = '' }) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef(null);
  const id = useId();

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const trimmed = text.trim();

  const submit = () => {
    if (streaming || offline || !trimmed) return;
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
      <div className="flex items-end gap-2 rounded-card border border-line bg-surface p-2 focus-within:border-brand-600">
        <label htmlFor={id} className="sr-only">Message Ask AI</label>
        <textarea
          id={id}
          ref={textareaRef}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your records or what to do next"
          className="max-h-36 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base font-normal leading-5 text-ink outline-none placeholder:text-ink-soft sm:text-sm"
        />
        {streaming ? (
          <Button variant="secondary" leftIcon={Square} onClick={onStop} aria-label="Stop answering">
            Stop
          </Button>
        ) : (
          <Button type="submit" leftIcon={ArrowUp} disabled={!trimmed || offline} aria-label="Send message">
            Send
          </Button>
        )}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3 px-1 text-xs font-medium text-ink-muted-strong">
        <p>
          {offline
            ? 'You are offline. Reconnect to send a message.'
            : 'Answers can be wrong. The linked record is the source of truth.'}
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
