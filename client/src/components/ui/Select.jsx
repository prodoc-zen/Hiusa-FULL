import { Children, forwardRef, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

function readOptions(children, groupDisabled = false) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? child.props.children ?? ''), label: Children.toArray(child.props.children).join(''), disabled: groupDisabled || child.props.disabled }];
    return readOptions(child.props.children, groupDisabled || child.props.disabled);
  });
}

function popupPosition(element) {
  const bounds = element.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
  const width = Math.min(Math.max(bounds.width, 220), viewportWidth - 24);
  const below = viewportBottom - bounds.bottom;
  const above = bounds.top - viewportTop;
  return { position: 'fixed', width, left: Math.max(12, Math.min(bounds.left, viewportWidth - width - 12)), ...(below >= 240 || below >= above
    ? { top: bounds.bottom + 4, maxHeight: Math.max(80, Math.min(300, below - 16)) }
    : { bottom: window.innerHeight - bounds.top + 4, maxHeight: Math.max(80, Math.min(300, above - 16)) }) };
}

const Select = forwardRef(function Select({ className = '', children, onChange, multiple = false, ...props }, ref) {
  const nativeRef = useRef(null);
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({});
  const [uncontrolled, setUncontrolled] = useState(props.defaultValue);
  const options = readOptions(children);
  const currentValue = props.value ?? uncontrolled ?? (multiple ? [] : options[0]?.value ?? '');
  const selectedValues = (Array.isArray(currentValue) ? currentValue : [currentValue]).map(String);
  const selected = options.filter((option) => selectedValues.includes(option.value));
  const visible = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const layoutClass = className.split(/\s+/).filter((token) => /(^|:)(w-|min-w-|max-w-|m[trblxy]?-|flex|grow|shrink|basis-|col-|row-|self-|order-|hidden|block|inline-block|inline-flex|pl-)/.test(token)).join(' ');

  useEffect(() => {
    if (!open) return undefined;
    popupRef.current?.showPopover?.();
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    const outside = (event) => {
      if (!popupRef.current?.contains(event.target) && !nativeRef.current?.parentElement?.contains(event.target)) setOpen(false);
    };
    const close = (event) => { if (!popupRef.current?.contains(event.target)) setOpen(false); };
    const reposition = () => { if (nativeRef.current) setPosition(popupPosition(nativeRef.current)); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.addEventListener('scroll', close, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  function show() {
    if (props.disabled) return;
    setPosition(popupPosition(nativeRef.current));
    setQuery('');
    setOpen(true);
  }

  function choose(value) {
    const select = nativeRef.current;
    if (multiple) {
      const next = selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value];
      for (const option of select.options) option.selected = next.includes(option.value);
      setUncontrolled(next);
    } else {
      select.value = value;
      setUncontrolled(value);
      setOpen(false);
      select.focus();
    }
    onChange?.({ target: select, currentTarget: select, type: 'change' });
  }

  function move(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); nativeRef.current?.focus(); }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(popupRef.current.querySelectorAll('[data-option]:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index <= 0 ? buttons.length - 1 : index - 1);
    buttons[next]?.focus();
  }

  return <div className={`relative min-w-0 ${layoutClass}`}>
    <div className={`flex min-h-11 w-full items-center gap-1.5 rounded-control border bg-surface px-3 pr-9 text-sm font-medium text-ink transition-colors focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-accent/15 ${props['aria-invalid'] ? 'border-danger' : 'border-line'} ${props.disabled ? 'cursor-not-allowed bg-subtle text-ink-soft' : ''}`}>
      <select {...props} multiple={multiple} ref={(element) => { nativeRef.current = element; if (typeof ref === 'function') ref(element); else if (ref) ref.current = element; }}
        aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); nativeRef.current.focus(); } }}
        onClick={(event) => { event.preventDefault(); if (open) setOpen(false); else show(); }}
        onKeyDown={(event) => { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(); } else if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}
        onChange={(event) => { setOpen(false); setUncontrolled(multiple ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value); onChange?.(event); }}>
        {children}
      </select>
      <span aria-hidden="true" className="pointer-events-none flex min-w-0 flex-1 flex-wrap gap-1 py-1.5">
        {selected.length ? selected.map((option) => <span key={option.value} data-label={option.label} className={`max-w-full truncate before:content-[attr(data-label)] ${option.value ? 'rounded bg-[#15803D] px-2 py-1 text-xs font-semibold text-white' : 'text-ink-muted'}`} />) : <span>Choose…</span>}
      </span>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 text-ink-muted" aria-hidden="true" />
    </div>
    {open && createPortal(<div ref={popupRef} popover={typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype ? 'manual' : undefined} style={{ top: 'auto', right: 'auto', bottom: 'auto', margin: 0, ...position }} onKeyDown={move} className="z-[130] flex flex-col overflow-hidden rounded-control border border-line bg-surface shadow-lg">
      {multiple && selected.length > 0 && <div className="flex flex-wrap gap-1 border-b border-line p-2">{selected.map((option) => <span key={option.value} className="inline-flex items-center gap-1 rounded bg-[#15803D] px-2 py-1 text-xs font-semibold text-white">{option.label}<button type="button" aria-label={`Remove ${option.label}`} onClick={() => choose(option.value)} className="rounded p-1 hover:bg-white/20"><X size={12} aria-hidden="true" /></button></span>)}</div>}
      <input ref={searchRef} type="search" aria-label="Search dropdown options" placeholder="Type to search…" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const first = visible.find((option) => !option.disabled); if (first) choose(first.value); } }} className="m-2 min-h-10 rounded border border-line px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-accent/20" />
      <div id={`${id}-list`} role="listbox" aria-label="Dropdown options" aria-multiselectable={multiple || undefined} className="min-h-0 overflow-y-auto p-1">
        {visible.map((option) => <button key={option.value} type="button" role="option" aria-selected={selectedValues.includes(option.value)} data-option disabled={option.disabled} onClick={() => choose(option.value)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm text-ink hover:bg-subtle focus:bg-subtle focus:outline-2 focus:outline-brand-600 disabled:text-ink-soft"><span>{option.label}</span>{selectedValues.includes(option.value) && <Check size={15} className="shrink-0 text-[#15803D]" aria-hidden="true" />}</button>)}
        {!visible.length && <p role="status" className="px-3 py-4 text-sm text-ink-muted">No matching options</p>}
      </div>
    </div>, nativeRef.current?.closest('[role="dialog"]') || document.body)}
  </div>;
});

export default Select;
