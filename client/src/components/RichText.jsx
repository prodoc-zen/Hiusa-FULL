import { useRef } from 'react';

const FONT_STYLE = {
  serif: { fontFamily: 'Georgia, serif' },
  handwritten: { fontFamily: '"Segoe Print", "Comic Sans MS", cursive' },
};

function formattedParts(value, prefix = 'part') {
  const text = String(value || '');
  const pattern = /(\*\*([\s\S]+?)\*\*|\[font=(serif|handwritten)\]([\s\S]+?)\[\/font\])/g;
  const parts = [];
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const key = `${prefix}-${match.index}`;
    if (match[2] != null) {
      parts.push(<strong key={key}>{formattedParts(match[2], key)}</strong>);
    } else {
      parts.push(<span key={key} style={FONT_STYLE[match[3]]}>{formattedParts(match[4], key)}</span>);
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function RichTextBody({ value, className = '', as: Component = 'div' }) {
  return <Component className={`whitespace-pre-wrap ${className}`}>{formattedParts(value)}</Component>;
}

export default function RichTextEditor({ value, onChange, id, ariaLabel, rows = 6, className = '', placeholder = '', maxLength }) {
  const inputRef = useRef(null);
  const text = String(value || '');

  function wrapSelection(before, after = before) {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = text.slice(start, end) || 'text';
    const next = `${text.slice(0, start)}${before}${selected}${after}${text.slice(end)}`;
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-accent/15">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-subtle p-2" role="toolbar" aria-label="Text formatting">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('**')} aria-label="Bold selected text" className="min-h-10 min-w-10 rounded-md px-2 text-sm font-bold hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600">B</button>
        <span className="mx-1 h-5 border-l border-line" aria-hidden="true" />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('[font=serif]', '[/font]')} className="min-h-10 rounded-md px-2 font-serif text-xs font-semibold hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600">Serif</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('[font=handwritten]', '[/font]')} className="min-h-10 rounded-md px-2 text-xs font-semibold hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-600">Handwritten</button>
      </div>
      <textarea ref={inputRef} id={id} aria-label={ariaLabel} value={text} onChange={(event) => onChange(event.target.value)} rows={rows} maxLength={maxLength} placeholder={placeholder} className={`w-full resize-y border-0 bg-transparent p-3 text-sm leading-6 text-ink outline-none ${className}`} />
      <div className="border-t border-line bg-subtle px-3 py-2">
        <p className="mb-1 text-xs font-semibold text-ink-muted">Preview</p>
        <RichTextBody value={value || 'Your formatted text will appear here.'} className="text-sm leading-6 text-ink" />
      </div>
    </div>
  );
}
