import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Mic, Paperclip, Square, X } from 'lucide-react';
import { Button } from '../../../components/ui';
import { ATTACHMENT_ACCEPT, attachmentError } from '../../../utils/aiAttachment';
import useSpeechInput from './useSpeechInput';

export const MAX_MESSAGE_LENGTH = 2000;
const COUNTER_FROM = 1800;
const MAX_HEIGHT_PX = 144;
const NARROW_QUERY = '(max-width: 639px)';
const SHORT_PLACEHOLDER = 'Ask anything';
const LONG_PLACEHOLDER = 'Ask about your records or what to do next';
const ATTACHED_PLACEHOLDER = 'Say what to do with the file, like Record this expense';
const ATTACHED_SHORT_PLACEHOLDER = 'Note (optional)';
const ICON_BUTTON_BASE = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control transition-colors disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-[42px] max-sm:w-[42px]';
const ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE} text-ink-muted-strong hover:bg-subtle hover:text-ink`;
// Its own colours, not layered on the idle ones, so hovering the listening mic keeps the white icon on the blue.
const ICON_BUTTON_ACTIVE_CLASS = `${ICON_BUTTON_BASE} bg-brand-700 text-white hover:bg-brand-800`;

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
  const [attachment, setAttachment] = useState(null);
  const [attachError, setAttachError] = useState('');
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const textRef = useRef(initialText);
  const id = useId();
  const narrow = useNarrow();
  const voice = useSpeechInput({ onText: setText, getBase: () => textRef.current, limit: MAX_MESSAGE_LENGTH });

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    restore: (value, file = null) => {
      setText((current) => (current.trim() ? current : value));
      if (file) setAttachment((current) => current || file);
    },
    clearIf: (value) => setText((current) => (current.trim() === value.trim() ? '' : current)),
  }), []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const trimmed = text.trim();
  // A file can stand in for the words: the server answers a file sent alone.
  const canSend = Boolean(trimmed) || Boolean(attachment);

  const submit = () => {
    if (streaming || offline || blockedReason || !canSend) return;
    voice.stop();
    if (onSend(trimmed, attachment) !== false) {
      setText('');
      setAttachment(null);
      setAttachError('');
    }
  };

  const pickFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = attachmentError(file);
    setAttachError(problem);
    if (!problem) setAttachment(file);
  };

  const toggleVoice = () => {
    setAttachError('');
    voice.toggle();
  };

  const note = attachError || voice.problem;

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
      {attachment && (
        <div className="mb-2 flex">
          <span className="inline-flex min-h-[34px] max-w-full items-center gap-1.5 rounded-full border border-line bg-subtle py-1 pl-3 pr-1 text-xs font-semibold text-ink">
            <Paperclip size={12} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 truncate">{attachment.name}</span>
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => setAttachment(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted-strong hover:bg-line hover:text-ink max-sm:h-[30px] max-sm:w-[30px]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-card border border-line bg-surface p-2 focus-within:border-brand-600 focus-within:ring-[3px] focus-within:ring-accent/15">
        <label htmlFor={id} className="sr-only">Message Ask AI</label>
        <textarea
          id={id}
          ref={textareaRef}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => {
            if (voice.listening) voice.stop();
            setText(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={attachment ? (narrow ? ATTACHED_SHORT_PLACEHOLDER : ATTACHED_PLACEHOLDER) : narrow ? SHORT_PLACEHOLDER : LONG_PLACEHOLDER}
          className="max-h-36 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-base font-normal leading-5 text-ink outline-none focus-visible:outline-none! placeholder:text-ink-soft sm:text-sm"
        />
        <input ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} onChange={pickFile} className="hidden" tabIndex={-1} aria-hidden="true" />
        <button
          type="button"
          aria-label="Attach a file"
          title="Attach a photo or PDF"
          disabled={streaming}
          onClick={() => fileRef.current?.click()}
          className={ICON_BUTTON_CLASS}
        >
          <Paperclip size={18} aria-hidden="true" />
        </button>
        {voice.supported && (
          <button
            type="button"
            aria-label="Speak your question"
            aria-pressed={voice.listening}
            title="Speak your question"
            disabled={streaming}
            onClick={toggleVoice}
            className={voice.listening ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_CLASS}
          >
            <Mic size={18} aria-hidden="true" />
          </button>
        )}
        {streaming ? (
          <Button variant="secondary" leftIcon={Square} onClick={onStop} aria-label="Stop answering">
            Stop
          </Button>
        ) : (
          <Button type="submit" leftIcon={ArrowUp} disabled={!canSend || offline || Boolean(blockedReason)} aria-label="Send message">
            Send
          </Button>
        )}
      </div>
      {note && <p role="alert" className="mt-1.5 px-1 text-xs font-semibold text-danger-strong">{note}</p>}
      <div className="mt-1.5 flex items-start justify-between gap-3 px-1 text-xs font-medium text-ink-muted-strong">
        <p aria-live="polite">
          {offline && 'You are offline. Reconnect to send a message.'}
          {!offline && blockedReason}
          {!offline && !blockedReason && (voice.listening ? 'Listening. Tap the mic to stop.' : 'Answers can be wrong. The linked record is the source of truth.')}
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
