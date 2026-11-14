import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '../ui';
import { cancelAiAction, confirmAiAction } from '../../services/askAiService';
import { actionDetailsText, effectiveStatus } from './actionState';
import isSafePageHref from './safeHref';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const INPUT_CLASS = 'h-11 read-only:bg-subtle read-only:text-ink-muted-strong';
// The shared Select is 40px; this lifts only the card's selects to the 44px of INPUT_CLASS.
const SELECT_FIELD_CLASS = '[&>div>div]:min-h-11';
const NOTE_CLASS = 'text-xs font-medium text-ink-muted-strong';
const FAILURE = 'Could not complete that. Try again.';
const THROTTLED = 'Too many requests. Wait a moment, then try again.';

const messageList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const initialValues = (fields) => Object.fromEntries(
  fields.map((field) => [field.name, field.type === 'checkbox' ? Boolean(field.value) : (field.value ?? '')]),
);

function submitted(fields, values) {
  return Object.fromEntries(fields.map((field) => {
    const value = values[field.name];
    if (field.type === 'checkbox') return [field.name, Boolean(value)];
    if (value === '' || value == null) return [field.name, null];
    if (field.type === 'number' && Number.isFinite(Number(value))) return [field.name, Number(value)];
    return [field.name, value];
  }));
}

function useExpiry(action) {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = Date.parse(action.expires_at ?? '');
  const open = action.status === 'awaiting_confirmation';
  useEffect(() => {
    if (!open || !Number.isFinite(expiresAt)) return undefined;
    const wait = expiresAt - Date.now();
    if (wait <= 0) return undefined;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait, MAX_TIMEOUT_MS));
    return () => window.clearTimeout(timer);
  }, [open, expiresAt]);
  return now;
}

function Label({ field }) {
  return (
    <>
      {field.label}
      {field.required && <span aria-hidden="true" className="ml-0.5 text-danger-strong">*</span>}
    </>
  );
}

function ActionField({ field, value, error, readOnly, onChange }) {
  const hint = field.help || undefined;
  const label = <Label field={field} />;
  const noteId = useId();

  if (field.type === 'checkbox') {
    const describedBy = error ? `${noteId}-error` : hint ? `${noteId}-help` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label className="flex min-h-[42px] items-center gap-2.5 text-[13px] font-medium text-ink">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={readOnly}
            onChange={(event) => onChange(event.target.checked)}
            aria-required={field.required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="h-5 w-5 shrink-0 accent-brand-700"
          />
          <span><Label field={field} /></span>
        </label>
        {hint && !error && <p id={`${noteId}-help`} className="text-xs text-ink-muted">{hint}</p>}
        {error && <p id={`${noteId}-error`} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>}
      </div>
    );
  }

  if (field.type === 'select') {
    const options = Array.isArray(field.options) ? field.options : [];
    return (
      <Field label={label} hint={hint} error={error} required={field.required} className={SELECT_FIELD_CLASS}>
        <Select value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)}>
          {field.required && (value === '' || value == null) && <option value="" disabled>Choose an option</option>}
          {!field.required && <option value="">None</option>}
          {options.map((option) => (
            <option key={option.value} value={String(option.value)}>{option.label}</option>
          ))}
        </Select>
      </Field>
    );
  }

  if (field.type === 'textarea') {
    return (
      <Field label={label} hint={hint} error={error} required={field.required}>
        <Textarea
          rows={3}
          value={value}
          readOnly={readOnly}
          maxLength={field.max || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="read-only:bg-subtle read-only:text-ink-muted-strong"
        />
      </Field>
    );
  }

  const type = { datetime: 'datetime-local', date: 'date', number: 'number' }[field.type] || 'text';
  return (
    <Field label={label} hint={hint} error={error} required={field.required}>
      <Input
        type={type}
        value={value}
        readOnly={readOnly}
        maxLength={type === 'text' ? field.max || undefined : undefined}
        inputMode={type === 'number' ? 'decimal' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      />
    </Field>
  );
}

function CopyDetails({ getText }) {
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
    <Button variant="secondary" leftIcon={copied ? Check : Copy} onClick={copy}>
      {copied ? 'Copied' : 'Copy details'}
    </Button>
  );
}

export default function ActionCard({ message, action, live = true, onChange, onValuesChange, onAskAgain, askAgainDisabled = false }) {
  const fields = Array.isArray(action.fields) ? action.fields : [];
  const [values, setValues] = useState(() => initialValues(fields));
  const [errors, setErrors] = useState(() => action.errors || {});
  const [busy, setBusy] = useState(false);
  const [closedNote, setClosedNote] = useState('');
  const busyRef = useRef(false);
  const now = useExpiry(action);
  const status = effectiveStatus(action, now);
  const showsForm = !['done', 'cancelled', 'failed'].includes(status);

  // The message Copy reads these, so it copies what the person edited, and falls back to the stored values once the form is gone.
  useEffect(() => {
    onValuesChange?.(showsForm ? values : null);
  }, [onValuesChange, showsForm, values]);

  const run = async (request, onRefused) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrors((current) => ({ ...current, _: undefined }));
    try {
      const response = await request();
      onChange(response.data.message);
    } catch (err) {
      const code = err?.response?.status;
      const data = err?.response?.data;
      if (onRefused?.(code, data)) return;
      if (code === 429) setErrors((current) => ({ ...current, _: [data?.message || THROTTLED] }));
      else if (code === 409 || code === 404) setClosedNote(data?.message || FAILURE);
      else setErrors((current) => ({ ...current, _: [FAILURE] }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const confirm = (event) => {
    event.preventDefault();
    run(() => confirmAiAction(message.id, submitted(fields, values)), (code, data) => {
      if (code !== 422) return false;
      const returned = data?.assistant_message;
      setErrors(data?.errors || returned?.payload?.action?.errors || {});
      if (returned) onChange(returned);
      return true;
    });
  };

  const cancel = () => run(() => cancelAiAction(message.id));

  if (status === 'done') {
    const result = action.result || {};
    return (
      <section aria-label={action.title} className="mt-3 flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
        <p className="min-w-0 flex-1 text-sm font-medium text-ink">{result.message || 'Done.'}</p>
        {isSafePageHref(result.href) && (
          <Button to={result.href} variant="secondary" size="sm" rightIcon={ArrowRight} className="max-sm:h-[42px]">
            {result.action_label || 'Open'}
          </Button>
        )}
      </section>
    );
  }

  if (status === 'cancelled' || status === 'failed') {
    const line = {
      cancelled: 'You cancelled this request.',
      failed: action.result?.message || 'This request did not go through.',
    }[status];
    return <p className={`mt-3 ${NOTE_CLASS}`}>{line}</p>;
  }

  const expired = status === 'expired';
  const editable = live && !closedNote && status === 'awaiting_confirmation';
  const readOnly = !editable || busy;
  const general = messageList(errors._);
  const note = status === 'confirming'
    ? 'Working on it. Check the page if this does not change.'
    : expired
      ? 'This request expired. Ask again to get a fresh one.'
      : !live && !closedNote ? 'A newer request replaced this one.' : '';

  return (
    <form
      aria-label={action.title}
      noValidate
      onSubmit={confirm}
      className="mt-3 flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-ink">{action.title}</h3>
      {fields.map((field) => (
        <ActionField
          key={field.name}
          field={field}
          value={values[field.name]}
          error={messageList(errors[field.name]).join(' ') || undefined}
          readOnly={readOnly}
          onChange={(next) => setValues((current) => ({ ...current, [field.name]: next }))}
        />
      ))}
      {general.length > 0 && (
        <p role="alert" className="text-sm font-medium text-danger-strong">{general.join(' ')}</p>
      )}
      {closedNote && <p role="alert" className="text-sm font-medium text-ink">{closedNote}</p>}
      {note && <p className={NOTE_CLASS}>{note}</p>}
      {expired && (
        <div className="flex flex-wrap gap-2">
          {onAskAgain && <Button onClick={onAskAgain} disabled={askAgainDisabled}>Ask again</Button>}
          <CopyDetails getText={() => actionDetailsText(action, values)} />
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>{action.submit_label || 'Confirm'}</Button>
          <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button>
        </div>
      )}
    </form>
  );
}
