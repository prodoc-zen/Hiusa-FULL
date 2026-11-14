import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Link } from 'react-router-dom';
import isSafePageHref from './safeHref';

const CALLOUTS = ['callout', 'callout-info', 'callout-success', 'callout-warning', 'callout-danger'];
const BADGES = ['badge', 'badge-info', 'badge-success', 'badge-warning', 'badge-danger', 'badge-neutral'];

const MARKDOWN_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

// Only what contract section 8 lists, on top of plain Markdown output. Links keep a
// relative href so the renderer can decide; everything else about them is dropped.
const SCHEMA = {
  ...defaultSchema,
  tagNames: [...MARKDOWN_TAGS, 'div', 'span', 'details', 'summary', 'mark', 'kbd', 'sub', 'sup', 'br', 'hr', 'progress'],
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'template'],
  attributes: {
    a: ['href'],
    ol: ['start'],
    th: ['align'],
    td: ['align'],
    div: [['className', ...CALLOUTS, 'stat-grid', 'stat']],
    span: [['className', ...BADGES, 'stat-value', 'stat-label']],
    progress: ['value', 'max'],
  },
  protocols: { href: [] },
  clobber: [],
  ancestors: {},
};

const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, SCHEMA]];
const REMARK_PLUGINS = [remarkGfm];

// A tag still being typed by the stream ("<span class=\"bad") would show as raw text until its ">" arrives.
// It stays on one line and never follows a letter or digit, so "turnout<quorum" is plain text.
const UNFINISHED_TAG = /(?<![A-Za-z0-9])<\/?[a-zA-Z][^<>\n]*$/;

function AiLink({ href, children }) {
  if (isSafePageHref(href)) {
    return <Link to={href}>{children}</Link>;
  }
  return <>{children}</>;
}

// A wide table hides its last columns on a phone with nothing to say so; the cue stays until the reader reaches the end.
function AiTable({ children }) {
  const scrollerRef = useRef(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);

  useEffect(() => {
    measure();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <>
      <div ref={scrollerRef} onScroll={measure} className="ai-table-scroll" tabIndex={0} role="region" aria-label="Table, scrolls sideways">
        <table>{children}</table>
      </div>
      {more && <p aria-hidden="true" className="mt-1 text-xs font-medium text-ink-muted-strong">Scroll sideways to see all columns.</p>}
    </>
  );
}

function AiProgress({ value, max }) {
  const numericMax = Number(max);
  const safeMax = Number.isFinite(numericMax) && numericMax > 0 ? numericMax : 100;
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? Math.min(Math.max(numericValue, 0), safeMax) : 0;
  return <progress value={safeValue} max={safeMax} />;
}

const COMPONENTS = { a: AiLink, table: AiTable, progress: AiProgress };

function AiMarkdown({ content, className = '', streaming = false }) {
  const text = typeof content === 'string' ? content : '';
  return (
    <div className={`ai-prose ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {streaming ? text.replace(UNFINISHED_TAG, '') : text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(AiMarkdown);
