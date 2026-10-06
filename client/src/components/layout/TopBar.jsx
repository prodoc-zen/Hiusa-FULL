import { formatDisplayText } from '../../utils/displayText.js';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu, Search, ShoppingCart, User } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import ConfirmModal from '../ConfirmModal';
import { Kbd } from '../ui';
import CommandPalette from './CommandPalette';
import { getAccountProfiles, logout, switchAccountProfile } from '../../services/authService';
import { getNotifications, markRead, markAllRead } from '../../services/notificationService';
import { getActiveAcademicPeriod } from '../../services/systemAdministrationService';
import { unwrapList } from '../../services/pagination';
import { getNotificationDestination } from '../../utils/notificationLinks';
import { notificationIcon } from '../../utils/notificationIcon';
import notify from '../../lib/notify';

const STUDENT_CART_KEY = 'hiusa_student_cart';

const ROLE_LABELS = {
  SUPER_ADMIN: 'SAO',
  ADMIN: 'Organization Admin',
  SBO_OFFICER: 'SBO Officer',
  DEPARTMENT_HEAD: 'Department Head',
  STUDENT: 'Student',
};

const ROLE_HOME_PATHS = {
  SUPER_ADMIN: '/dashboard/super-admin',
  ADMIN: '/dashboard/admin',
  SBO_OFFICER: '/dashboard/officer',
  DEPARTMENT_HEAD: '/dashboard/department-head',
  STUDENT: '/dashboard/student',
};

function readStudentCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDENT_CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatMoney(value) {
  const num = Number.parseFloat(String(value ?? 0));
  return `P${Number.isFinite(num) ? num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TopBar({ title, pathname, onMenuToggle }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountProfiles, setAccountProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(null);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const profileRef = useRef(null);
  const headerRef = useRef(null);
  const profileTriggerRef = useRef(null);
  const notifRef = useRef(null);
  const cartRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    getActiveAcademicPeriod().then(setActiveAcademicPeriod).catch(() => setActiveAcademicPeriod(null));
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const updatePanelPosition = () => {
      const bottom = Math.ceil(header.getBoundingClientRect().bottom);
      header.style.setProperty('--mobile-panel-top', `${bottom + 8}px`);
      document.documentElement.style.setProperty('--dashboard-navbar-bottom', `${bottom}px`);
    };
    updatePanelPosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePanelPosition);
    observer?.observe(header);
    window.addEventListener('resize', updatePanelPosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePanelPosition);
      document.documentElement.style.removeProperty('--dashboard-navbar-bottom');
    };
  }, []);

  const user = (() => {
    try {
      const storedUser = localStorage.getItem('user');
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      return null;
    }
  })();
  const initials = user ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() : 'HI';
  const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Guest User';
  const role = user?.role ?? '';
  const roleLabel = ROLE_LABELS[role] || (role ? role : 'Member');
  const homePath = ROLE_HOME_PATHS[role] || '/dashboard';
  const [paletteOpen, setPaletteOpen] = useState(false);
  const organizationName = user?.organization?.name || 'Organization';
  const isRoleHome = Object.values(ROLE_HOME_PATHS).includes(pathname);
  const headerSubtitle = {
    '/dashboard': 'Start with deadlines, then check events, funds, and merchandise queues.',
    '/dashboard/admin/users': 'Search the organization directory and manage account access.',
    '/dashboard/admin/sbo-positions': 'Maintain titles available to administrators and officers.',
    '/dashboard/admin/positions': 'Maintain titles available to administrators and officers.',
    '/dashboard/admin/programs-sections': 'Configure programs and update academic records.',
    '/dashboard/approvals': 'Review approval requests awaiting your sign-off.',
    '/dashboard/department-head/approvals': 'Review approval requests awaiting your sign-off.',
    '/dashboard/approval-requests/new': 'Choose a request type to begin the approval process.',
    '/dashboard/approval-requests/new/announcement': 'Submit an announcement for approval.',
    '/dashboard/approval-requests/new/budget': 'Submit a budget request for approval.',
    '/dashboard/approval-requests/new/event': 'Submit an event request for approval.',
    '/dashboard/approval-requests/new/election': 'Submit an election request for approval.',
    '/dashboard/officer': 'Start with deadlines, then check events, funds, and merchandise queues.',
    '/dashboard/department-head': 'Review approvals, elections, events, and announcements.',
    '/dashboard/student': 'Official updates, events, and elections from your organization.',
    '/dashboard/super-admin': 'Review reports, administer organizations, and publish university notices.',
    '/dashboard/super-admin/approvals': 'Review reports and requests awaiting SAO action.',
    '/dashboard/adviser': 'Review organization activity and requests.',
    '/dashboard/super-admin/organizations': 'Register and manage student organizations.',
    '/dashboard/super-admin/colleges': 'Maintain the colleges assigned to student organizations.',
    '/dashboard/super-admin/admins': 'Manage authorized administrators for each organization.',
    '/dashboard/super-admin/announcements': 'Publish official notices across HIUSA.',
    '/dashboard/super-admin/notifications': 'SAO approval activity and system notices.',
    '/dashboard/super-admin/event-requirements': 'Set the files organizations must submit for events.',
    '/dashboard/super-admin/financial-reports': 'Review reports forwarded by Department Heads.',
    '/dashboard/finance': 'Track organization funds and financial activity.',
    '/dashboard/audit-logs': 'Trace who changed a record, what changed, and when.',
    '/dashboard/announcements/manage-announcements': 'Review, edit, and publish organization announcements.',
    '/dashboard/announcements/create-announcement': 'Write an announcement and choose its audience.',
    '/dashboard/announcements/view-announcements': 'Updates from your organization.',
    '/dashboard/finance/financial-ledger': 'Review income and expenses in the organization ledger.',
    '/dashboard/finance/collections': 'Track money received, its verification and remittance, and cash advances to officers.',
    '/dashboard/finance/student-accounts': 'Review charges, payments, and student clearance.',
    '/dashboard/finance/budget-allocation': 'Plan and review organization budgets.',
    '/dashboard/finance/financial-insights': 'Review financial forecasts and trends.',
    '/dashboard/finance/transaction-history': 'Review saved financial reports and transaction history.',
    '/dashboard/finance/personal-receipts': 'View and print your payment receipts.',
    '/dashboard/finance/statement-of-account': 'Review your account and financial clearance.',
    '/dashboard/events/activity-calendar': 'Browse approved activities and upcoming events.',
    '/dashboard/events': 'Plan activities and review event records.',
    '/dashboard/events/manage-events': 'Review and update organization events.',
    '/dashboard/events/event-planner': 'Plan tasks and resources for upcoming events.',
    '/dashboard/events/check-in': 'Verify participants and manage event attendance.',
    '/dashboard/tasks': 'Track assignments and officer progress.',
    '/dashboard/tasks/task-board': 'Review work by status and deadline.',
    '/dashboard/tasks/create-task': 'Assign a task to an officer or event.',
    '/dashboard/tasks/task-progress': 'Review progress across organization tasks.',
    '/dashboard/tasks/assigned-tasks': 'Review work assigned to you.',
    '/dashboard/tasks/ai-delegation': 'Review suggested officers for each task.',
    '/dashboard/elections': 'Review elections in your organization.',
    '/dashboard/elections/manage-elections': 'Configure ballots and election schedules.',
    '/dashboard/elections/manage-candidates': 'Review the candidates on the selected ballot.',
    '/dashboard/elections/manage-partylists': 'Maintain party identities for the selected election.',
    '/dashboard/elections/manage-voters': 'Review eligibility and turnout without exposing ballots.',
    '/dashboard/elections/cast-vote': 'Review the ballot and cast your vote.',
    '/dashboard/elections/election-results': 'Review available vote totals and winners.',
    '/dashboard/merchandise': 'Browse organization products and orders.',
    '/dashboard/merchandise/manage-inventory': 'Track products, stock, and sales.',
    '/dashboard/merchandise/gcash-payment': 'Review merchandise payments and fulfillment.',
    '/dashboard/merchandise/manage-orders': 'Review merchandise payments and fulfillment.',
    '/dashboard/merchandise/claim-tokens': 'Verify orders and release purchases.',
    '/dashboard/merchandise/order-merchandise': 'Browse products and place an order.',
    '/dashboard/merchandise/my-orders': 'Review your purchases and claim details.',
    '/dashboard/announcements': 'Updates from your organization.',
    '/dashboard/profile': 'Keep your personal details and account access current.',
    '/dashboard/organization': 'Keep your organization details current.',
    '/dashboard/settings': 'Keep your personal details and account access current.',
  }[pathname];
  const availableProfiles = accountProfiles.filter((profile) => profile.account_status === 'active' && profile.organization?.is_active);
  const canOrderMerchandise = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'].includes(role);

  const parentByPrefix = [
    ['/dashboard/announcements/', 'Announcements'],
    ['/dashboard/elections/', 'Elections'],
    ['/dashboard/events/', 'Events'],
    ['/dashboard/finance/', 'Financial'],
    ['/dashboard/tasks/', 'Tasks'],
    ['/dashboard/merchandise/', 'Merchandise'],
    ['/dashboard/super-admin/', 'Student Affairs'],
  ];
  const parentLabel = parentByPrefix.find(([prefix]) => pathname?.startsWith(prefix))?.[1] || null;

  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ per_page: 10 });
      const data = unwrapList(res?.data);
      setNotifications(data.slice(0, 10));
      setUnreadCount(Number(res?.data?.unread_count ?? data.filter((notification) => !notification.is_read).length));
    } catch {
      // notifications are non-critical; fail silently
    }
  }, []);

  const loadCart = useCallback(() => {
    setCartItems(readStudentCart());
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!canOrderMerchandise) {
      return undefined;
    }

    loadCart();

    const onCartUpdate = () => loadCart();
    const onStorage = (event) => {
      if (!event.key || event.key === STUDENT_CART_KEY) {
        loadCart();
      }
    };

    window.addEventListener('hiusa-cart-updated', onCartUpdate);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('hiusa-cart-updated', onCartUpdate);
      window.removeEventListener('storage', onStorage);
    };
  }, [canOrderMerchandise, loadCart]);

  async function handleMarkRead(id) {
    const wasUnread = notifications.some((notification) => notification.id === id && !notification.is_read);
    try {
      await markRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    } catch {}
  }

  async function handleMarkAllRead() {
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      notify.success('All notifications marked as read.');
    } catch {
      notify.error('Could not mark notifications as read. Try again.');
    }
  }

  async function handleNotificationClick(notification) {
    await handleMarkRead(notification.id);
    const destination = getNotificationDestination(notification, user?.role);
    if (destination) {
      setNotifOpen(false);
      setSelectedNotification(null);
      navigate(destination);
      return;
    }
    setSelectedNotification({ ...notification, is_read: true });
  }

  async function handleLogout() {
    setLogoutBusy(true);
    try {
      await logout();
    } finally {
      setLogoutBusy(false);
      setLogoutConfirmOpen(false);
      navigate('/login');
    }
  }

  async function loadAccountProfiles() {
    setProfileLoading(true);
    try {
      const response = await getAccountProfiles();
      setAccountProfiles(response.data.profiles || []);
      setActiveProfileId(response.data.active_profile_id);
      setProfileError('');
    } catch {
      setProfileError('Could not load your profiles.');
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleSwitchProfile(profile) {
    if (switchingProfile || profile.id === activeProfileId) return;
    setSwitchingProfile(true);
    try {
      const response = await switchAccountProfile(profile.id);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      const destinations = { SUPER_ADMIN: '/dashboard/super-admin', ADMIN: '/dashboard/admin', SBO_OFFICER: '/dashboard/officer', DEPARTMENT_HEAD: '/dashboard/department-head', STUDENT: '/dashboard/student' };
      window.location.assign(destinations[response.data.user.role] || '/dashboard');
    } catch {
      setProfileError('Could not switch organization. Try again.');
      setSwitchingProfile(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (cartRef.current && !cartRef.current.contains(e.target)) setCartOpen(false);
    }
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape' && profileOpen) {
        setProfileOpen(false);
        profileTriggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [profileOpen]);

  useEffect(() => {
    function handlePaletteShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    document.addEventListener('keydown', handlePaletteShortcut);
    return () => document.removeEventListener('keydown', handlePaletteShortcut);
  }, []);

  const recent5 = notifications.slice(0, 5);
  const cartTypeCount = cartItems.length;
  const cartTotal = cartItems.reduce((sum, row) => sum + (Number(row?.item?.price || 0) * Number(row?.quantity || 0)), 0);

  return (
    <header ref={headerRef} className="relative z-30 mx-3 mt-3 shrink-0 rounded-3xl border border-[#DDE7EF] bg-white shadow-sm sm:mx-6 sm:mt-6">
      <div className="flex min-h-16 flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3">
        {/* Hamburger toggle */}
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuToggle}
          className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#F8FBFD] hover:text-[#0878B7] lg:hidden"
        >
          <Menu size={19} />
        </button>
        <img src={hiusaLogo} alt="" className="h-8 w-8 shrink-0 object-contain lg:hidden" />

        {/* Page title */}
        <div className="order-last min-w-0 w-full flex-none border-t border-[#DDE7EF] pt-2 sm:order-none sm:w-auto sm:flex-1 sm:border-0 sm:pt-0">
          <nav aria-label="Breadcrumb" className="truncate text-xs font-medium text-ink-muted">
            <Link to={homePath} className="rounded-control hover:text-brand-700 hover:underline focus-visible:text-brand-700">Home</Link>
            {parentLabel && <span aria-hidden="true" className="px-1.5 text-ink-soft">/</span>}
            {parentLabel && <span>{parentLabel}</span>}
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="break-words text-lg font-extrabold text-[#0F172A] sm:text-xl">{title}</h1>
            {activeAcademicPeriod?.academic_year?.label && <span className="rounded-full border border-[#DDE7EF] bg-[#EEF6FB] px-2.5 py-1 text-[11px] font-semibold text-[#0F2F62]">AY {activeAcademicPeriod.academic_year.label} · {activeAcademicPeriod.number === 1 ? '1st' : '2nd'} Semester</span>}
          </div>
          {!isRoleHome && headerSubtitle && <p className="mt-0.5 text-xs font-medium text-slate-500 sm:text-sm">{headerSubtitle}</p>}
        </div>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Go to page"
          aria-keyshortcuts="Control+K Meta+K"
          className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-[#F8FBFD] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:px-3"
        >
          <Search size={16} aria-hidden="true" />
          <span className="hidden md:inline">Go to page</span>
          <Kbd className="hidden md:inline-flex">Ctrl K</Kbd>
        </button>

        {canOrderMerchandise && (
          <div className="relative ml-auto sm:ml-0" ref={cartRef}>
            <button
              type="button"
              aria-label="Cart"
              aria-expanded={cartOpen}
              aria-controls="topbar-cart-panel"
              onClick={() => {
                setCartOpen(!cartOpen);
                setNotifOpen(false);
                setProfileOpen(false);
              }}
              className="relative grid h-11 w-11 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#F8FBFD] hover:text-[#0878B7]"
            >
              <ShoppingCart size={17} />
              {cartTypeCount > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-[#0878B7] px-1 text-[10px] font-black text-white ring-2 ring-white">
                  {cartTypeCount > 9 ? '9+' : cartTypeCount}
                </span>
              )}
            </button>

            {cartOpen && (
              <div
                id="topbar-cart-panel"
                role="region"
                aria-label="Cart summary"
                className="fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 flex max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] flex-col overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-xl shadow-slate-200/60 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-3rem)]"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-[#DDE7EF] px-4 py-3">
                  <p className="text-sm font-bold text-[#0F172A]">Your Cart</p>
                  <span className="rounded-full bg-[#EEF6FB] px-2 py-0.5 text-[11px] font-black text-[#0F2F62]">{cartTypeCount} item type{cartTypeCount === 1 ? '' : 's'}</span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[300px]">
                  {cartItems.length === 0 ? (
                    <div className="py-10 text-center">
                      <ShoppingCart size={28} className="mx-auto mb-2 text-slate-200" />
                      <p className="text-sm text-slate-500">Cart is empty</p>
                    </div>
                  ) : (
                    cartItems.map((row) => (
                      <div key={row.item?.id || row.item?.name} className="flex items-center justify-between gap-3 border-b border-[#EEF6FB] px-4 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-[#0F172A]">{formatDisplayText(row.item?.name) || 'Item'}</p>
                          <p className="text-[11px] text-slate-500">Qty: {row.quantity || 0} - {formatMoney(row.item?.price || 0)}</p>
                        </div>
                        <p className="text-xs font-black text-[#0F172A]">{formatMoney((row.item?.price || 0) * (row.quantity || 0))}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="shrink-0 border-t border-[#DDE7EF] px-4 py-3">
                  <p className="mb-2 text-xs font-bold text-slate-500">Total: <span className="text-[#0F172A]">{formatMoney(cartTotal)}</span></p>
                  <button
                    type="button"
                    onClick={() => {
                      setCartOpen(false);
                      navigate('/dashboard/merchandise/order-merchandise', { state: { openCartAt: Date.now() } });
                    }}
                    className="h-9 w-full rounded-lg bg-[#0878B7] text-xs font-bold text-white transition hover:bg-[#0F2F62]"
                  >
                    Open Cart
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notification Bell */}
        <div className={`relative ${canOrderMerchandise ? '' : 'ml-auto sm:ml-0'}`} ref={notifRef}>
          <button
            type="button"
            aria-label="Notifications"
            aria-expanded={notifOpen}
            aria-controls="topbar-notifications-panel"
            onClick={() => {
              setNotifOpen(!notifOpen);
              setSelectedNotification(null);
              setProfileOpen(false);
              setCartOpen(false);
            }}
            className="relative grid h-11 w-11 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#F8FBFD] hover:text-[#0878B7]"
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-[#0878B7] px-1 text-[10px] font-black text-white ring-2 ring-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              id="topbar-notifications-panel"
              role="region"
              aria-label="Notifications panel"
              className="fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 flex max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] flex-col overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-xl shadow-slate-200/60 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-3rem)]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-[#DDE7EF] px-4 py-3">
                <p className="text-sm font-bold text-[#0F172A]">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-2 rounded-full bg-[#16C7F3]/15 px-2 py-0.5 text-[11px] font-black text-[#0878B7]">{unreadCount} new</span>
                  )}
                </p>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs font-bold text-[#0878B7] hover:underline"
                  >
                    Mark all as read
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[340px]">
                {selectedNotification ? (
                  <div className="p-4">
                    <button
                      type="button"
                      onClick={() => setSelectedNotification(null)}
                      className="mb-3 text-xs font-bold text-[#0878B7] hover:underline"
                    >
                      Back to notifications
                    </button>
                    <p className="text-sm font-black text-[#0F172A]">{formatDisplayText(selectedNotification.title)}</p>
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{selectedNotification.message}</p>
                    <p className="mt-3 text-[11px] font-medium text-slate-300">{timeAgo(selectedNotification.created_at)}</p>
                    {getNotificationDestination(selectedNotification, user?.role) && (
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          setSelectedNotification(null);
                          navigate(getNotificationDestination(selectedNotification, user?.role));
                        }}
                        className="mt-4 h-9 rounded-lg bg-[#0878B7] px-4 text-xs font-bold text-white hover:bg-[#0F2F62]"
                      >
                        Open related record
                      </button>
                    )}
                  </div>
                ) : recent5.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bell size={28} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm text-slate-500">No notifications yet</p>
                  </div>
                ) : (
                  recent5.map((n) => {
                    const Icon = notificationIcon(n);
                    return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleNotificationClick(n)}
                      className={`flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition hover:bg-[#F8FBFD] ${!n.is_read ? 'border-[#0B8ED0] bg-[#E6F6FD]' : 'border-transparent'}`}
                    >
                      <Icon size={18} className={`mt-0.5 shrink-0 ${n.is_read ? 'text-slate-400' : 'text-[#0878B7]'}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[13px] font-semibold ${n.is_read ? 'text-slate-500' : 'text-[#0F172A]'}`}>{formatDisplayText(n.title)}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>
                        <p className="mt-1 text-[11px] font-medium text-slate-300">{timeAgo(n.created_at)}</p>
                      </div>
                    </button>
                  ); })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            ref={profileTriggerRef}
            aria-label={`Account menu for ${fullName}`}
            aria-expanded={profileOpen}
            aria-controls="topbar-profile-panel"
            onClick={() => {
              setProfileOpen(!profileOpen);
              if (!profileOpen) loadAccountProfiles();
              setNotifOpen(false);
              setCartOpen(false);
            }}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-[#DDE7EF] px-2 py-1.5 transition hover:bg-[#F8FBFD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
              {initials}
            </div>
            <div className="hidden min-w-0 max-w-[min(12rem,25vw)] text-left sm:block">
              <p className="truncate text-[13px] font-bold text-[#0F172A]" title={fullName}>{fullName}</p>
              <p className="max-w-40 truncate text-[11px] font-medium text-slate-600">{organizationName} · {roleLabel}</p>
            </div>
            <ChevronDown size={14} className={`text-slate-600 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div id="topbar-profile-panel" role="region" aria-label="Account and profiles" className="fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-1.5 shadow-xl shadow-slate-200/60 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-3rem)]">
              <div className="border-b border-[#DDE7EF] px-3 py-3 mb-1.5">
                <p className="text-sm font-bold text-[#0F172A]">{fullName}</p>
                <p className="break-all text-xs font-medium text-slate-500">{user?.email || ''}</p>
              </div>
              <section aria-label="Profiles" className="border-b border-[#DDE7EF] px-2 pb-2">
                <div className="flex items-center justify-between px-1 pb-1">
                  <h2 className="text-xs font-bold text-[#0F172A]">Profiles</h2>
                  {availableProfiles.length > 1 && <span className="text-xs text-slate-600">Switch profile</span>}
                </div>
                {profileLoading ? <p role="status" className="px-2 py-3 text-xs text-slate-600">Loading profiles…</p> : profileError ? <div className="px-2 py-2"><p role="alert" className="text-xs text-red-700">{profileError}</p><button type="button" onClick={loadAccountProfiles} className="mt-2 min-h-11 text-xs font-semibold text-[#0878B7] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">Try again</button></div> : availableProfiles.length === 0 ? <p className="px-2 py-3 text-xs text-slate-600">No active profiles available.</p> : <div className="space-y-1">
                  {availableProfiles.map((profile) => {
                    const current = profile.id === (activeProfileId ?? user?.active_profile_id);
                    return <button key={profile.id} type="button" disabled={current || switchingProfile} onClick={() => handleSwitchProfile(profile)} aria-current={current ? 'true' : undefined} className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] disabled:cursor-default ${current ? 'bg-[#EEF6FB]' : 'hover:bg-[#F8FBFD] active:bg-[#EEF6FB]'} ${switchingProfile && !current ? 'opacity-60' : ''}`}>
                      <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold ${current ? 'bg-[#0F2F62] text-white' : 'bg-[#EEF6FB] text-[#0F2F62]'}`}>{(profile.organization?.acronym || profile.organization?.name || '?').slice(0, 2).toUpperCase()}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#0F172A]">{formatDisplayText(profile.organization?.name) || 'Organization'}</span><span className="block text-xs text-slate-600">{ROLE_LABELS[profile.role] || profile.role}</span></span>
                      {current && <span className="text-xs font-semibold text-[#0F2F62]">Current</span>}
                    </button>;
                  })}
                  {availableProfiles.length === 1 && <p className="px-2 pb-2 text-xs leading-5 text-slate-600">This is your only active profile. Other profiles appear here when an organization adds you.</p>}
                </div>}
                {switchingProfile && <p role="status" className="px-2 py-2 text-xs text-slate-600">Switching profile…</p>}
              </section>
              <button
                type="button"
                onClick={() => { setProfileOpen(false); navigate('/dashboard/profile'); }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-[#F8FBFD] hover:text-[#0878B7]"
              >
                <User size={16} />
                View Profile
              </button>
              <div className="my-1.5 border-t border-[#DDE7EF]" />
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  setLogoutConfirmOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold text-red-500 transition hover:bg-red-50"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={role} />
    </header>
  );
}
