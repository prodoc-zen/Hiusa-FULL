import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import AccessibleOverlay from '../AccessibleOverlay';
import { getFlatPages } from './navigation';

const RECENT_KEY = 'hiusa_recent_pages';
const MAX_RECENT = 5;
const MAX_RESULTS = 8;

function readRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberPage(path) {
  try {
    const next = [path, ...readRecent().filter((entry) => entry !== path)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent pages are a convenience; losing them on a storage error is not worth surfacing.
  }
}

// Small subsequence-based fuzzy match: no new dependency, still lets "bud alloc"
// find "Budget Allocation". Exact substrings still rank first.
function fuzzyScore(term, text) {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!needle) return 0;
  if (haystack.includes(needle)) return 0;

  let needleIndex = 0;
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) needleIndex += 1;
  }
  return needleIndex === needle.length ? 1 : -1;
}

export default function CommandPalette({ open, onClose, role }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef(null);
  const navigate = useNavigate();

  const pages = useMemo(() => getFlatPages(role), [role]);

  const { results, isRecent } = useMemo(() => {
    const term = query.trim();
    if (!term) {
      const recentPages = readRecent()
        .map((path) => pages.find((page) => page.path === path))
        .filter(Boolean);
      return recentPages.length > 0
        ? { results: recentPages, isRecent: true }
        : { results: pages.slice(0, MAX_RESULTS), isRecent: false };
    }

    const scored = pages
      .map((page) => ({ page, score: fuzzyScore(term, `${page.label} ${page.section}`) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score);

    return { results: scored.map((entry) => entry.page), isRecent: false };
  }, [pages, query]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  function go(page) {
    if (!page) return;
    rememberPage(page.path);
    onClose();
    navigate(page.path);
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    <AccessibleOverlay
      label="Go to page"
      onClose={onClose}
      closeOnBackdrop
      className="fixed inset-0 z-[80] flex items-start justify-center bg-navy-950/60 px-3 pt-4 sm:px-4 sm:pt-6"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-raised">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={18} className="shrink-0 text-ink-soft" aria-hidden="true" />
          <input
            data-autofocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages..."
            aria-label="Search pages"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={results[activeIndex] ? `command-palette-option-${results[activeIndex].id}` : undefined}
            className="h-9 w-full border-0 bg-transparent text-sm font-medium text-ink placeholder:text-ink-muted focus:outline-none"
          />
        </div>

        {isRecent && <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-widest text-ink-muted">Recent</p>}

        <ul id="command-palette-listbox" role="listbox" aria-label="Pages" ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm font-medium text-ink-muted">No pages match &quot;{query}&quot;.</li>
          ) : (
            results.map((page, index) => {
              const Icon = page.icon;
              const active = index === activeIndex;
              return (
                <li
                  key={page.id}
                  id={`command-palette-option-${page.id}`}
                  role="option"
                  aria-selected={active}
                  data-active={active || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(page)}
                  className={`flex cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold ${active ? 'bg-brand-50 text-brand-800' : 'text-ink'}`}
                >
                  <Icon size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{page.label}</span>
                  {page.section !== page.label && <span className="shrink-0 text-xs font-medium text-ink-muted">{page.section}</span>}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </AccessibleOverlay>
  );
}
