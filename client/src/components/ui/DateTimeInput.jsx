import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';

const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const asDate = (value) => new Date(`${value}T12:00:00`);
const dayLabel = (value) => asDate(value).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const control = 'min-h-11 rounded-xl border border-[#DDE7EF] bg-white px-3 text-sm text-[#0F172A] outline-none focus-visible:ring-2 focus-visible:ring-[#0B8ED0]';
const action = 'grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#0F2F62] hover:bg-[#E6F6FD] focus-visible:outline-2 focus-visible:outline-[#0B8ED0] disabled:opacity-40';

export default function DateTimeInput({ type = 'date', className = '', ref, onClick, onKeyDown, ...props }) {
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const titleId = useId();
  const [picker, setPicker] = useState(null);
  const isOpen = Boolean(picker);
  const hasDate = type !== 'time';
  const hasTime = type !== 'date';
  const name = props['aria-label'] || props.name || props.id || (hasDate ? 'date' : 'time');
  const Icon = hasDate ? CalendarDays : Clock;

  function close(restoreFocus = false) {
    setPicker(null);
    if (restoreFocus) inputRef.current?.focus();
  }

  function open() {
    const input = inputRef.current;
    if (!input || input.disabled || input.readOnly) return;
    const current = input.value;
    const today = dateKey(new Date());
    let selectedDate = hasDate && current ? current.slice(0, 10) : today;
    if (hasDate && props.min && selectedDate < props.min.slice(0, 10)) selectedDate = props.min.slice(0, 10);
    if (hasDate && props.max && selectedDate > props.max.slice(0, 10)) selectedDate = props.max.slice(0, 10);
    const selectedTime = type === 'time' ? current : current.split('T')[1];
    const rect = input.getBoundingClientRect();
    const width = Math.min(336, window.innerWidth - 24);
    const height = hasDate ? (hasTime ? 550 : 450) : 230;
    const placement = rect.bottom + height < window.innerHeight
      ? { top: rect.bottom + 8 }
      : rect.top > height ? { bottom: window.innerHeight - rect.top + 8 } : { top: 12 };
    const label = input.labels?.[0]?.textContent?.trim() || name;
    setPicker({ date: selectedDate, time: selectedTime || '09:00', month: selectedDate.slice(0, 7), active: selectedDate, label,
      style: { position: 'fixed', width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        ...placement,
        maxHeight: 'calc(100dvh - 24px)' } });
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    const first = panelRef.current?.querySelector('[data-active-day]:not([disabled])')
      || panelRef.current?.querySelector('select, button:not([disabled])');
    first?.focus();
    const outside = (event) => {
      if (!panelRef.current?.contains(event.target) && !inputRef.current?.parentElement?.contains(event.target)) setPicker(null);
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPicker(null);
        inputRef.current?.focus();
      }
      if (event.key === 'Tab' && panelRef.current?.contains(event.target)) {
        event.stopPropagation();
        const controls = Array.from(panelRef.current.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), select:not([disabled])'));
        const first = controls[0];
        const last = controls.at(-1);
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    const resize = () => setPicker(null);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', resize);
    };
  }, [isOpen]);

  function valid(value) {
    const check = document.createElement('input');
    check.type = type;
    for (const attribute of ['min', 'max', 'step']) {
      if (props[attribute] !== undefined) check.setAttribute(attribute, props[attribute]);
    }
    check.value = value;
    return Boolean(check.value) && check.checkValidity();
  }

  function commit(value) {
    const input = inputRef.current;
    // Use the native setter so React receives the same input event as typing.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  }

  function dayAllowed(day) {
    return (!props.min || day >= props.min.slice(0, 10)) && (!props.max || day <= props.max.slice(0, 10)) && (type !== 'date' || valid(day));
  }

  function chooseDay(day) {
    if (!dayAllowed(day)) return;
    if (type === 'date') commit(day);
    else setPicker((current) => ({ ...current, date: day, active: day, month: day.slice(0, 7) }));
  }

  function moveMonth(delta) {
    const date = asDate(`${picker.month}-01`);
    date.setMonth(date.getMonth() + delta);
    setPicker((current) => ({ ...current, month: dateKey(date).slice(0, 7), active: dateKey(date) }));
  }

  function moveDay(event, day) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const date = asDate(day);
    date.setDate(date.getDate() + offsets[event.key]);
    const next = dateKey(date);
    if (!dayAllowed(next)) return;
    setPicker((current) => ({ ...current, active: next, month: next.slice(0, 7) }));
    requestAnimationFrame(() => panelRef.current?.querySelector(`[data-day="${next}"]`)?.focus());
  }

  const days = [];
  if (picker && hasDate) {
    const first = asDate(`${picker.month}-01`);
    first.setDate(first.getDate() - first.getDay());
    for (let index = 0; index < 42; index++) {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      days.push(dateKey(date));
    }
  }
  const candidate = picker ? (type === 'date' ? picker.date : type === 'time' ? picker.time : `${picker.date}T${picker.time}`) : '';
  const seconds = props.step !== 'any' && Number(props.step) > 0 && Number(props.step) < 60;
  function changeTime(index, value) {
    setPicker((current) => {
      const parts = current.time.split(':');
      parts[index] = value;
      if (seconds && !parts[2]) parts[2] = '00';
      return { ...current, time: parts.join(':') };
    });
  }

  return <span className={`relative inline-flex min-w-0 align-middle ${className.includes('w-full') ? 'w-full' : ''}`}>
    <input {...props} type={type} ref={(node) => { inputRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
      className={`hiusa-date-time ${className} pr-12`} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); open(); } }}
      onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && ((event.altKey && event.key === 'ArrowDown') || event.key === 'F4')) { event.preventDefault(); open(); } }} />
    <button type="button" aria-label={`Choose ${hasDate ? 'date' : 'time'}: ${name}`} aria-haspopup="dialog" aria-expanded={Boolean(picker)} disabled={props.disabled || props.readOnly}
      onClick={() => picker ? close(true) : open()} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-[#E6F6FD] text-[#0F2F62] outline-none focus-visible:ring-2 focus-visible:ring-[#0B8ED0] disabled:opacity-40"><Icon size={18} aria-hidden="true" /></button>
    {picker && createPortal(<section ref={panelRef} role="dialog" aria-labelledby={titleId} style={picker.style} className="z-[100] overflow-y-auto rounded-2xl border border-[#DDE7EF] bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2"><h2 id={titleId} className="min-w-0 flex-1 break-words text-sm font-bold text-[#0F2F62]">{picker.label}</h2><button type="button" onClick={() => close(true)} aria-label="Close date and time picker" className={action}><X size={18} /></button></div>
      {hasDate && <>
        <div className="flex items-center justify-between gap-2"><button type="button" aria-label="Previous month" className={action} onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button><span aria-live="polite" className="text-sm font-bold text-[#0F2F62]">{asDate(`${picker.month}-01`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</span><button type="button" aria-label="Next month" className={action} onClick={() => moveMonth(1)}><ChevronRight size={18} /></button></div>
        <div className="grid grid-cols-7 text-center text-xs text-[#64748B]" aria-hidden="true">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
        <div role="group" aria-label="Calendar days" className="grid grid-cols-7 gap-0.5">{days.map((day) => <button key={day} type="button" data-day={day} data-active-day={day === picker.active ? '' : undefined} tabIndex={day === picker.active ? 0 : -1}
          aria-label={dayLabel(day)} aria-pressed={day === picker.date} disabled={!dayAllowed(day)} onClick={() => chooseDay(day)} onKeyDown={(event) => moveDay(event, day)}
          className={`aspect-square min-h-10 rounded-full text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#0B8ED0] disabled:opacity-25 ${day === picker.date ? 'bg-[#0878B7] text-white' : day.startsWith(picker.month) ? 'text-[#0F172A] hover:bg-[#E6F6FD]' : 'text-[#64748B] hover:bg-[#E6F6FD]'}`}>{Number(day.slice(-2))}</button>)}</div>
      </>}
      {hasTime && <fieldset className="mt-3 border-t border-[#DDE7EF] pt-3"><legend className="px-1 text-xs font-bold text-[#0F2F62]">Time</legend><div className="flex gap-2">{['Hour', 'Minute', ...(seconds ? ['Second'] : [])].map((label, index) => <label key={label} className="min-w-0 flex-1 text-xs font-semibold text-[#64748B]">{label}<select aria-label={label} value={picker.time.split(':')[index] || '00'} onChange={(event) => changeTime(index, event.target.value)} className={`${control} mt-1 w-full`}>{Array.from({ length: index === 0 ? 24 : 60 }, (_, value) => <option key={value} value={pad(value)}>{pad(value)}</option>)}</select></label>)}</div></fieldset>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#DDE7EF] pt-3"><button type="button" onClick={() => commit('')} className={`${control} text-[#64748B]`}>Clear</button>{hasDate && <button type="button" disabled={!dayAllowed(dateKey(new Date()))} onClick={() => chooseDay(dateKey(new Date()))} className={control}>Today</button>}{hasTime && <button type="button" disabled={!valid(candidate)} onClick={() => commit(candidate)} className="ml-auto min-h-11 rounded-xl bg-[#0878B7] px-4 text-sm font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-[#0F2F62] disabled:opacity-40">Apply</button>}</div>
    </section>, document.body)}
  </span>;
}
