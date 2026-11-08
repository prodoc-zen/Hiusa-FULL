import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { OrgMark } from '../ui';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import { formatDisplayText } from '../../utils/displayText.js';

const SEARCH_FROM = 8;

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
        className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] disabled:opacity-60 ${selected ? 'bg-[#EEF6FB]' : 'hover:bg-[#F8FBFD]'}`}
      >
        {space.kind === 'main'
          ? <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0F2F62] text-[10px] font-bold text-white">ME</span>
          : <OrgMark size="sm" name={space.label} acronym={space.organization?.acronym ?? space.profile?.organization?.acronym} logoUrl={space.organization?.logo_url} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[#0F172A]">{formatDisplayText(space.label)}</span>
          <span className="block truncate text-xs text-[#64748B]">{space.detail}</span>
        </span>
        {selected && <Check size={14} className="shrink-0 text-[#0878B7]" aria-label="Current" />}
      </button>
    );
  };

  const inOrg = current.kind === 'org';

  return (
    <div className="relative" ref={rootRef} data-tour="topbar-subaccount">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="workspace-switcher-panel"
        aria-label={`Workspace: ${current.label}`}
        className={`inline-flex min-h-9 max-w-[130px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] min-[420px]:max-w-[180px] sm:max-w-[240px] ${inOrg ? 'border-[#0B8ED0]/50 bg-[#EEF6FB] text-[#0878B7]' : 'border-[#DDE7EF] bg-[#F8FBFD] text-[#0F2F62] hover:border-[#0B8ED0]/40 hover:bg-white'}`}
      >
        <span className="truncate">{formatDisplayText(current.label)}</span>
        <ChevronDown size={13} aria-hidden="true" className={`shrink-0 text-[#64748B] transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="workspace-switcher-panel" role="region" aria-label="Workspaces" className="fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-1.5 shadow-xl shadow-slate-200/60 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1.5 sm:w-80">
          {main && <div className="border-b border-[#DDE7EF] pb-1.5">{row(main)}</div>}
          <p className="px-2 pb-1 pt-2 text-xs font-bold text-[#64748B]">{role === 'DEPARTMENT_HEAD' ? 'Organizations in your college' : 'Organizations you work in'}</p>
          {spaces.length - (main ? 1 : 0) >= SEARCH_FROM && (
            <div className="relative px-1 pb-1.5">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-[65%] text-[#94A3B8]" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search organizations"
                placeholder="Search organizations"
                className="h-10 w-full rounded-md border border-[#DDE7EF] pl-8 pr-2 text-base text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:outline-none focus:ring-2 focus:ring-[#16C7F3]/15 sm:text-sm"
              />
            </div>
          )}
          <div className="space-y-0.5">
            {orgSpaces.map(row)}
            {orgSpaces.length === 0 && <p className="px-2 py-3 text-xs text-[#64748B]">No organization matches "{query}".</p>}
          </div>
          {switching && <p role="status" className="px-2 py-2 text-xs text-[#64748B]">Switching…</p>}
          {switchError && <p role="alert" className="px-2 py-2 text-xs text-[#DC2626]">{switchError}</p>}
        </div>
      )}
    </div>
  );
}
