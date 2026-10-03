import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { OrgMark } from '../ui';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { logout } from '../../services/authService';
import { GOVERNANCE_IDS, ROLE_LABELS, getNavForRole, getVisibleChildren, profileNav, resolveItemPath } from './navigation';

function NavItem({ label, path, icon: Icon, end, onClick, desktopCollapsed = false }) {
  return (
    <NavLink
      to={path}
      end={end}
      onClick={onClick}
      aria-label={desktopCollapsed ? label : undefined}
      title={desktopCollapsed ? label : undefined}
      className={({ isActive }) => `relative flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16C7F3] ${desktopCollapsed ? 'lg:justify-center lg:px-0' : ''} ${isActive ? 'bg-[#0F2F62] text-white' : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'}`}
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-600" />}
          <Icon size={18} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          <span className={desktopCollapsed ? 'lg:sr-only' : ''}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function SubNavItem({ label, path, onClick }) {
  return (
    <NavLink
      to={path}
      onClick={onClick}
      className={({ isActive }) => `flex min-h-10 items-center rounded-lg px-3 py-2 text-[12px] font-semibold transition-all duration-200 ${isActive ? 'bg-[#0878B7] text-white shadow-sm' : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'}`}
    >
      {label}
    </NavLink>
  );
}

function SectionCaption({ desktopCollapsed, children }) {
  return (
    <p className={`mb-2 mt-4 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 first:mt-0 ${desktopCollapsed ? 'lg:sr-only' : ''}`}>
      {children}
    </p>
  );
}

function OfficerProfile({ user, roleLabel, desktopCollapsed }) {
  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'HI';
  const name = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Guest User';

  return (
    <div className={`flex items-center gap-3 rounded-lg bg-white/[0.06] px-3 py-3 ${desktopCollapsed ? 'lg:justify-center lg:px-0' : ''}`} title={desktopCollapsed ? `${name} · ${roleLabel}` : undefined}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">{initials}</div>
      <div className={`min-w-0 flex-1 ${desktopCollapsed ? 'lg:sr-only' : ''}`}>
        <p className="truncate text-sm font-bold text-white">{name}</p>
        <p className="truncate text-xs font-medium text-slate-500 capitalize">{roleLabel}</p>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose, desktopCollapsed = false, onToggleDesktop }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});
  const [flyout, setFlyout] = useState(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const sidebarRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const flyoutRef = useRef(null);
  const flyoutTriggerRef = useRef(null);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const onResize = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      if (desktop && isOpen) onCloseRef.current();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isDesktop) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(sidebarRef.current?.querySelectorAll('button:not([disabled]), a[href]') || []).filter((element) => element.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!sidebarRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [isOpen, isDesktop]);

  useEffect(() => { setFlyout(null); }, [location.pathname, desktopCollapsed]);

  useEffect(() => {
    if (!flyout) return undefined;
    function handlePointerDown(event) {
      if (!sidebarRef.current?.contains(event.target) && !flyoutRef.current?.contains(event.target)) setFlyout(null);
    }
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setFlyout(null);
        flyoutTriggerRef.current?.focus();
      }
    }
    function handleResize() {
      if (window.innerWidth < 1024) setFlyout(null);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleResize);
    };
  }, [flyout]);


  const user = useMemo(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }, []);

  const role = user?.role || 'SBO_OFFICER';
  const roleLabel = ROLE_LABELS[role] || role;
  const nav = getNavForRole(role);
  const flyoutGroup = desktopCollapsed && flyout ? nav.find((item) => item.id === flyout.id) : null;
  const orgName = role === 'SUPER_ADMIN' ? 'University-wide' : (user?.organization?.name || 'Organization');
  const orgAcronym = role === 'SUPER_ADMIN' ? 'SAO' : user?.organization?.acronym;

  const handleLogout = async () => {
    setLogoutBusy(true);
    try {
      await logout();
    } finally {
      setLogoutBusy(false);
      setLogoutConfirmOpen(false);
      navigate('/login');
    }
  };

  const handleNavItemClick = () => {
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  const firstGovernanceIndex = nav.findIndex((navItem) => GOVERNANCE_IDS.has(navItem.id));

  const sidebarContent = (
    <>
      <div className={`flex h-[72px] items-center gap-3 border-b border-white/10 px-5 ${desktopCollapsed ? 'lg:justify-center lg:px-3' : ''}`}>
        <img src={hiusaLogo} alt="HIUSA logo" className={`h-10 w-10 object-contain ${desktopCollapsed ? 'lg:hidden' : ''}`} />
        <div className={desktopCollapsed ? 'lg:hidden' : ''}>
          <p className="text-sm font-black tracking-wide text-white">HIUSA</p>
          <p className="text-[11px] font-medium text-slate-500">{roleLabel} System</p>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close menu" className="ml-auto grid h-11 w-11 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-white lg:hidden">
          <X size={18} />
        </button>
        <button type="button" onClick={onToggleDesktop} aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!desktopCollapsed} title={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={`hidden h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16C7F3] lg:grid ${desktopCollapsed ? '' : 'ml-auto'}`}>
          {desktopCollapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
        </button>
      </div>

      <div className={`flex items-center gap-2 border-b border-white/10 px-5 py-3 ${desktopCollapsed ? 'lg:hidden' : ''}`}>
        <OrgMark name={orgName} acronym={orgAcronym} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-white">{orgName}</p>
          <p className="truncate text-[11px] font-medium text-slate-500">{roleLabel}</p>
        </div>
      </div>

      <nav onScroll={() => setFlyout(null)} className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 ${desktopCollapsed ? 'lg:px-3' : ''}`}>
        <div className="flex-1 space-y-1">
          {nav.map((item, index) => {
            const visibleChildren = getVisibleChildren(item, role);
            const hasChildren = visibleChildren.length > 0;
            const itemPath = resolveItemPath(item, role);
            const isGovernanceItem = GOVERNANCE_IDS.has(item.id);
            const showGovernanceCaption = isGovernanceItem && index === firstGovernanceIndex;

            const caption = item.caption
              ? <SectionCaption desktopCollapsed={desktopCollapsed}>{item.caption}</SectionCaption>
              : showGovernanceCaption
                ? <SectionCaption desktopCollapsed={desktopCollapsed}>Governance</SectionCaption>
                : null;

            if (!hasChildren) {
              return (
                <Fragment key={item.id}>
                  {caption}
                  <NavItem label={item.label} path={itemPath} icon={item.icon} end onClick={handleNavItemClick} desktopCollapsed={desktopCollapsed} />
                </Fragment>
              );
            }

            const onParentRoute = visibleChildren.some((child) => location.pathname.startsWith(child.path));
            const isExpanded = expandedMenus[item.id] ?? onParentRoute;

            return (
              <Fragment key={item.id}>
                {caption}
                <div>
                  <button
                    type="button"
                    onClick={(event) => {
                      if (desktopCollapsed && window.innerWidth >= 1024) {
                        flyoutTriggerRef.current = event.currentTarget;
                        const top = Math.min(event.currentTarget.getBoundingClientRect().top, Math.max(16, window.innerHeight - 320));
                        setFlyout((current) => current?.id === item.id ? null : { id: item.id, top });
                        return;
                      }
                      if (!isExpanded) {
                        navigate(itemPath);
                      }

                      setExpandedMenus((previous) => ({
                        ...previous,
                        [item.id]: !isExpanded,
                      }));
                    }}
                    aria-label={desktopCollapsed ? item.label : undefined}
                    aria-expanded={desktopCollapsed && window.innerWidth >= 1024 ? flyout?.id === item.id : isExpanded}
                    title={desktopCollapsed ? item.label : undefined}
                    className={`relative flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16C7F3] ${desktopCollapsed ? 'lg:justify-center lg:px-0' : ''} ${onParentRoute || flyout?.id === item.id ? 'bg-[#0F2F62] text-white' : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'}`}
                  >
                    {onParentRoute && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-600" />}
                    <item.icon size={18} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                    <span className={desktopCollapsed ? 'lg:sr-only' : ''}>{item.label}</span>
                    <ChevronDown size={13} aria-hidden="true" className={`ml-auto text-slate-500 transition-transform duration-200 ${desktopCollapsed ? 'lg:hidden' : ''} ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className={`ml-4 mt-1 space-y-0.5 border-l border-white/15 pl-3 ${desktopCollapsed ? 'lg:hidden' : ''}`}>
                      {visibleChildren.map((sub) => (
                        <div key={sub.id} onClick={handleNavItemClick}>
                          <SubNavItem label={sub.label} path={sub.path} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>

        <div className="space-y-1 border-t border-white/10 pt-4">
          <SectionCaption desktopCollapsed={desktopCollapsed}>Account</SectionCaption>
          {profileNav.map((item) => (
            <div key={item.path} onClick={handleNavItemClick}>
              <NavItem {...item} desktopCollapsed={desktopCollapsed} />
            </div>
          ))}
          <button type="button" onClick={() => { handleNavItemClick(); setLogoutConfirmOpen(true); }} aria-label={desktopCollapsed ? 'Logout' : undefined} title={desktopCollapsed ? 'Logout' : undefined} className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-slate-300 transition-colors duration-200 hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16C7F3] ${desktopCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <LogOut size={18} strokeWidth={2} className="shrink-0" aria-hidden="true" />
            <span className={desktopCollapsed ? 'lg:sr-only' : ''}>Logout</span>
          </button>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <OfficerProfile user={user} roleLabel={roleLabel} desktopCollapsed={desktopCollapsed} />
        </div>
      </nav>
    </>
  );

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-[#0B1831]/60 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside ref={sidebarRef} inert={!isDesktop && !isOpen} role={!isDesktop && isOpen ? 'dialog' : undefined} aria-modal={!isDesktop && isOpen ? 'true' : undefined} aria-label={!isDesktop && isOpen ? 'Navigation menu' : undefined} className={`fixed inset-y-0 left-0 z-50 flex w-[min(280px,88vw)] flex-col bg-[#0B1831] shadow-2xl transition-[transform,width] duration-300 ease-in-out motion-reduce:transition-none sm:w-[260px] lg:translate-x-0 lg:shadow-none ${desktopCollapsed ? 'lg:w-[72px]' : 'lg:w-[260px]'} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>{sidebarContent}</aside>
      {flyoutGroup && createPortal(
        <div ref={flyoutRef} role="region" aria-label={`${flyoutGroup.label} links`} style={{ top: flyout.top }} className="fixed left-[72px] z-[70] max-h-[min(28rem,calc(100dvh-2rem))] w-60 overflow-y-auto rounded-r-lg border border-[#DDE7EF] bg-white p-2 shadow-lg">
          <p className="px-3 py-2 text-xs font-bold text-[#0F2F62]">{flyoutGroup.label}</p>
          <nav aria-label={`${flyoutGroup.label} pages`} className="space-y-0.5">
            {getVisibleChildren(flyoutGroup, role).map((child) => <NavLink key={child.id} to={child.path} onClick={() => setFlyout(null)} className={({ isActive }) => `block min-h-11 rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] ${isActive ? 'bg-[#EEF6FB] text-[#0F2F62]' : 'text-[#0F172A] hover:bg-[#F8FBFD]'}`}>{child.label}</NavLink>)}
          </nav>
        </div>,
        document.body,
      )}
      <ConfirmModal
        open={logoutConfirmOpen}
        title="Log Out"
        message="You will need to sign in again to access your dashboard."
        confirmText="Log Out"
        variant="primary"
        busy={logoutBusy}
        onCancel={() => !logoutBusy && setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
      />
    </>
  );
}
