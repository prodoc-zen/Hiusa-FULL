import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Building2, CalendarDays, CheckSquare, ChevronDown, ClipboardCheck, Coins, FileText, Home, LogOut, Megaphone, Package, PanelLeftClose, PanelLeftOpen, ShieldCheck, Users, Vote, X } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { logout } from '../../services/authService';

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SBO_OFFICER: 'Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

const NAV_STRUCTURE = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: Home,
    rolePaths: {
      SUPER_ADMIN: '/dashboard/super-admin',
      ADMIN: '/dashboard/admin',
      SBO_OFFICER: '/dashboard/officer',
      DEPARTMENT_HEAD: '/dashboard/department-head',
      STUDENT: '/dashboard/student',
    },
    roles: ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'],
  },
  {
    id: 'users',
    label: 'Users & Positions',
    icon: Users,
    roles: ['ADMIN', 'SBO_OFFICER'],
    children: [
      { id: 'manage-users', label: 'Manage Users', path: '/dashboard/admin/users', roles: ['ADMIN'] },
      { id: 'participant-biometrics', label: 'Participant Biometrics', path: '/dashboard/admin/users', roles: ['SBO_OFFICER'] },
      { id: 'manage-positions', label: 'Manage Positions', path: '/dashboard/admin/positions', roles: ['ADMIN'] },
      { id: 'manage-programs-sections', label: 'Programs & Sections', path: '/dashboard/admin/programs-sections', roles: ['ADMIN'] },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: ClipboardCheck,
    rolePaths: {
      ADMIN: '/dashboard/approvals',
      DEPARTMENT_HEAD: '/dashboard/department-head/approvals',
    },
    roles: ['ADMIN', 'DEPARTMENT_HEAD'],
  },
  { id: 'submit-request', label: 'Submit Request', icon: ClipboardCheck, path: '/dashboard/approval-requests/new', roles: ['ADMIN', 'SBO_OFFICER'] },
  { id: 'audit-logs', label: 'General Audit Log', icon: ClipboardCheck, path: '/dashboard/audit-logs', roles: ['ADMIN'] },
  {
    id: 'announcements',
    label: 'Announcements',
    icon: Megaphone,
    roles: ['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'],
    children: [
      { id: 'manage-announcements', label: 'Manage', path: '/dashboard/announcements/manage-announcements', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'create-announcement', label: 'Create', path: '/dashboard/announcements/create-announcement', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'view-announcements', label: 'View Feed', path: '/dashboard/announcements/view-announcements', roles: ['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] },
    ],
  },
  {
    id: 'elections',
    label: 'Elections',
    icon: Vote,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT', 'DEPARTMENT_HEAD'],
    children: [
      { id: 'manage-elections', label: 'Election Workspace', path: '/dashboard/elections/manage-elections', roles: ['ADMIN'] },
      { id: 'manage-candidates', label: 'Candidates', path: '/dashboard/elections/manage-candidates', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'manage-voters', label: 'Voters', path: '/dashboard/elections/manage-voters', roles: ['SBO_OFFICER'] },
      { id: 'manage-partylists', label: 'Party Lists', path: '/dashboard/elections/manage-partylists', roles: ['ADMIN'] },
      { id: 'cast-vote', label: 'Cast Vote', path: '/dashboard/elections/cast-vote', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
      { id: 'election-results', label: 'Results', path: '/dashboard/elections/election-results', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    icon: CalendarDays,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT', 'DEPARTMENT_HEAD'],
    children: [
      { id: 'manage-events', label: 'Manage Events', path: '/dashboard/events/manage-events', roles: ['ADMIN'] },
      { id: 'event-planner', label: 'Event Planner', path: '/dashboard/events/event-planner', roles: ['ADMIN'] },
      { id: 'check-in', label: 'Check In', path: '/dashboard/events/check-in', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'activity-calendar', label: 'Activity Calendar', path: '/dashboard/events/activity-calendar', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT', 'DEPARTMENT_HEAD'] },
    ],
  },
  {
    id: 'financial',
    label: 'Financial',
    icon: Coins,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'],
    children: [
      { id: 'financial-ledger', label: 'Financial Oversight', path: '/dashboard/finance/financial-ledger', roles: ['ADMIN'] },
      { id: 'collections', label: 'Collections & Remittances', path: '/dashboard/finance/collections', roles: ['ADMIN'] },
      { id: 'student-accounts', label: 'Student Financial Accounts', path: '/dashboard/finance/student-accounts', roles: ['ADMIN'] },
      { id: 'budget-allocation', label: 'Budget Allocation', path: '/dashboard/finance/budget-allocation', roles: ['ADMIN'] },
      { id: 'financial-insights', label: 'Financial Insights', path: '/dashboard/finance/financial-insights', roles: ['ADMIN'] },
      { id: 'transaction-history', label: 'Transaction History', path: '/dashboard/finance/transaction-history', roles: ['ADMIN'] },
      { id: 'personal-receipts', label: 'My Receipts', path: '/dashboard/finance/personal-receipts', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'] },
      { id: 'statement-of-account', label: 'Statement of Account', path: '/dashboard/finance/statement-of-account', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'] },
    ],
  },
  {
    id: 'tasks',
    label: 'Task Management',
    icon: CheckSquare,
    roles: ['SBO_OFFICER', 'ADMIN'],
    children: [
      { id: 'task-board', label: 'Task Board', path: '/dashboard/tasks/task-board', roles: ['ADMIN'] },
      { id: 'create-task', label: 'Create Task', path: '/dashboard/tasks/create-task', roles: ['ADMIN'] },
      { id: 'assigned-tasks', label: 'Assigned Tasks', path: '/dashboard/tasks/assigned-tasks', roles: ['SBO_OFFICER'] },
      { id: 'task-progress', label: 'Monitor Progress', path: '/dashboard/tasks/task-progress', roles: ['ADMIN'] },
      { id: 'ai-delegation', label: 'AI Delegation', path: '/dashboard/tasks/ai-delegation', roles: ['SBO_OFFICER', 'ADMIN'] },
    ],
  },
  {
    id: 'merchandise',
    label: 'Merchandise',
    icon: Package,
    roles: ['SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD', 'STUDENT'],
    children: [
      { id: 'manage-inventory', label: 'Inventory', path: '/dashboard/merchandise/manage-inventory', roles: ['ADMIN'] },
      { id: 'manage-orders', label: 'Manage Orders', path: '/dashboard/merchandise/manage-orders', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'claim-tokens', label: 'Validate Tokens', path: '/dashboard/merchandise/claim-tokens', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'order-merchandise', label: 'Order Merchandise', path: '/dashboard/merchandise/order-merchandise', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
      { id: 'my-orders', label: 'My Orders', path: '/dashboard/merchandise/my-orders', roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
    ],
  },
];

const profileNav = [
  { label: 'Profile', path: '/dashboard/profile', icon: Users },
];

const SUPER_ADMIN_NAV = [
  NAV_STRUCTURE[0],
  {
    id: 'sao-administration',
    label: 'SAO Administration',
    icon: ShieldCheck,
    roles: ['SUPER_ADMIN'],
    children: [
      { id: 'sao-organizations', label: 'Organizations', path: '/dashboard/super-admin/organizations', roles: ['SUPER_ADMIN'] },
      { id: 'sao-colleges', label: 'Colleges', path: '/dashboard/super-admin/colleges', roles: ['SUPER_ADMIN'], icon: Building2 },
      { id: 'sao-event-requirements', label: 'Event Requirements', path: '/dashboard/super-admin/event-requirements', roles: ['SUPER_ADMIN'], icon: FileText },
      { id: 'sao-admins', label: 'Administrators', path: '/dashboard/super-admin/admins', roles: ['SUPER_ADMIN'] },
      { id: 'sao-announcements', label: 'Official Notices', path: '/dashboard/super-admin/announcements', roles: ['SUPER_ADMIN'] },
      { id: 'sao-financial-reports', label: 'Received Reports', path: '/dashboard/super-admin/financial-reports', roles: ['SUPER_ADMIN'], icon: FileText },
      { id: 'sao-notifications', label: 'Notifications', path: '/dashboard/super-admin/notifications', roles: ['SUPER_ADMIN'] },
    ],
  },
];

function NavItem({ label, path, icon: Icon, end, onClick, desktopCollapsed = false }) {
  return (
    <NavLink
      to={path}
      end={end}
      onClick={onClick}
      aria-label={desktopCollapsed ? label : undefined}
      title={desktopCollapsed ? label : undefined}
      className={({ isActive }) => `flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16C7F3] ${desktopCollapsed ? 'lg:justify-center lg:px-0' : ''} ${isActive ? 'bg-[#0F2F62] text-white' : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'}`}
    >
      <Icon size={18} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      <span className={desktopCollapsed ? 'lg:sr-only' : ''}>{label}</span>
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
  const nav = role === 'SUPER_ADMIN' ? SUPER_ADMIN_NAV : NAV_STRUCTURE.filter((item) => item.roles.includes(role));
  const flyoutGroup = desktopCollapsed && flyout ? nav.find((item) => item.id === flyout.id) : null;

  const getVisibleChildren = (item) => (item.children || []).filter((child) => child.roles.includes(role));

  const resolveItemPath = (item) => {
    if (item.rolePaths) {
      return item.rolePaths[role] || item.rolePaths.SBO_OFFICER;
    }

    if (item.path) {
      return item.path;
    }

    const children = getVisibleChildren(item);
    return children[0]?.path || '/dashboard';
  };

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

      <nav onScroll={() => setFlyout(null)} className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 ${desktopCollapsed ? 'lg:px-3' : ''}`}>
        <div className="flex-1 space-y-1">
          <p className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 ${desktopCollapsed ? 'lg:sr-only' : ''}`}>Modules</p>
          {nav.map((item) => {
            const visibleChildren = getVisibleChildren(item);
            const hasChildren = visibleChildren.length > 0;
            const itemPath = resolveItemPath(item);

            if (!hasChildren) {
              return <NavItem key={item.id} label={item.label} path={itemPath} icon={item.icon} end onClick={handleNavItemClick} desktopCollapsed={desktopCollapsed} />;
            }

            const onParentRoute = visibleChildren.some((child) => location.pathname.startsWith(child.path));
            const isExpanded = expandedMenus[item.id] ?? onParentRoute;

            return (
              <div key={item.id}>
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
                  className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16C7F3] ${desktopCollapsed ? 'lg:justify-center lg:px-0' : ''} ${onParentRoute || flyout?.id === item.id ? 'bg-[#0F2F62] text-white' : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'}`}
                >
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
            );
          })}
        </div>

        <div className="space-y-1 border-t border-white/10 pt-4">
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
            {getVisibleChildren(flyoutGroup).map((child) => <NavLink key={child.id} to={child.path} onClick={() => setFlyout(null)} className={({ isActive }) => `block min-h-11 rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] ${isActive ? 'bg-[#EEF6FB] text-[#0F2F62]' : 'text-[#0F172A] hover:bg-[#F8FBFD]'}`}>{child.label}</NavLink>)}
          </nav>
        </div>,
        document.body,
      )}
      <ConfirmModal
        open={logoutConfirmOpen}
        title="Log Out"
        message="You will need to sign in again to access your dashboard."
        confirmText="Log Out"
        busy={logoutBusy}
        onCancel={() => !logoutBusy && setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
      />
    </>
  );
}
