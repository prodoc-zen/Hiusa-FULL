import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import { formatDisplayText } from '../../utils/displayText.js';

// A search box only earns its place in a long list.
const SEARCH_ABOVE = 8;

export default function WorkspaceSwitcher({ workspaces, role, onProfileChange }) {
  const { spaces, current, switching, switchError } = workspaces;
  const { enter, leave } = useActiveSubAccount();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const main = spaces.find((space) => space.kind === 'main');
  const orgSpaces = useMemo(() => {
    const term = query.trim().toLowerCase();
    const orgs = spaces.filter((space) => space.kind === 'org');
    return term ? orgs.filter((space) => space.label?.toLowerCase().includes(term) || space.organization?.acronym?.toLowerCase().includes(term)) : orgs;
  }, [spaces, query]);

  if (spaces.length < 2 || !current) return null;

  function pick(space) {
    if (space.key === current.key) {
      setOpen(false);
      return;
    }
    if (role === 'DEPARTMENT_HEAD') {
      setOpen(false);
      if (space.kind === 'org') {
        enter(space.organization);
        navigate(`/dashboard/department-head/org/${space.organization.id}`);
      } else {
        leave();
        navigate('/dashboard/department-head');
      }
      return;
    }
    onProfileChange?.(space.profile);
  }

  const row = (space) => {
    const selected = space.key === current.key;
    return (
      <button
        key={space.key}
        type="button"
        onClick={() => pick(space)}
        disabled={switching}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 ${selected ? 'bg-brand-50' : 'hover:bg-page'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{formatDisplayText(space.label)}</span>
          <span className="block truncate text-xs text-ink-muted">{space.detail}</span>
        </span>
        {selected && <Check size={16} className="shrink-0 text-brand-700" aria-label="Current" />}
      </button>
    );
  };

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="workspace-switcher-panel"
        aria-label={`Workspace: ${current.label}`}
        className="inline-flex h-11 max-w-full items-center gap-1.5 rounded-control border border-line bg-white px-3 text-sm font-medium text-ink transition-colors hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:h-10 sm:max-w-[240px]"
      >
        <span className="truncate">{formatDisplayText(current.label)}</span>
        <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="workspace-switcher-panel" role="region" aria-label="Workspaces" className="fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] overflow-y-auto rounded-card border border-line bg-white p-1 shadow-raised sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1.5 sm:w-80">
          {main && <div className="border-b border-line pb-1">{row(main)}</div>}
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-muted">{role === 'DEPARTMENT_HEAD' ? 'Organizations in your college' : 'Organizations you work in'}</p>
          {spaces.length > SEARCH_ABOVE && (
            <div className="relative px-1 pb-1.5">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-[65%] text-ink-soft" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search organizations"
                placeholder="Search organizations"
                className="h-10 w-full rounded-control border border-line pl-8 pr-2 text-base text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:text-sm"
              />
            </div>
          )}
          <div className="space-y-0.5">
            {orgSpaces.map(row)}
            {orgSpaces.length === 0 && <p className="px-3 py-3 text-xs text-ink-muted">No organization matches "{query}".</p>}
          </div>
          {switching && <p role="status" className="px-3 py-2 text-xs text-ink-muted">Switching…</p>}
          {switchError && <p role="alert" className="px-3 py-2 text-xs text-danger-strong">{switchError}</p>}
        </div>
      )}
    </div>
  );
}
