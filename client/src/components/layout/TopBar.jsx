import { formatDisplayText } from '../../utils/displayText.js';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, Check, ChevronDown, History, LogOut, Menu, Search, ShoppingCart, User } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import ConfirmModal from '../ConfirmModal';
import { Button, Kbd } from '../ui';
import CommandPalette from './CommandPalette';
import { ROLE_LABELS } from './navigation';
import { logout } from '../../services/authService';
import { clearApiCache } from '../../services/api';
import { getNotifications, markRead, markAllRead } from '../../services/notificationService';
import { getActiveAcademicPeriod, getAcademicPeriods } from '../../services/systemAdministrationService';
import { unwrapList } from '../../services/pagination';
import { getNotificationDestination } from '../../utils/notificationLinks';
import { notificationIcon } from '../../utils/notificationIcon';
import notify from '../../lib/notify';
import { peso } from '../../lib/format';
import { notificationAppearance } from '../../utils/notificationTone';
import { organizationLabel } from '../../utils/collegeIdentity';
import { PERIOD_EVENT, PERIOD_RESET_EVENT, readSelectedPeriod, writeSelectedPeriod } from '../../utils/academicPeriodStore';
import useActiveSubAccount from '../../hooks/useActiveSubAccount';
import useWorkspaces from '../../hooks/useWorkspaces';
import WorkspaceSwitcher from './WorkspaceSwitcher';

const STUDENT_CART_KEY = 'hiusa_student_cart';

function readStudentCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STUDENT_CART_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TopBar({ onMenuToggle }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeAcademicPeriod, setActiveAcademicPeriod] = useState(null);
  const [viewingPeriod, setViewingPeriod] = useState(null);
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);
  const notificationRequestRef = useRef(0);
  const periodRef = useRef(null);
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
    getActiveAcademicPeriod().then((p) => {
      setActiveAcademicPeriod(p);
      const stored = readSelectedPeriod();
      if (stored) setViewingPeriod(stored);
    }).catch(() => setActiveAcademicPeriod(null));

    if (typeof getAcademicPeriods === 'function') {
      getAcademicPeriods().then((list) => {
        const periods = Array.isArray(list) ? list : (list?.data || []);
        setAvailablePeriods(periods);
        const stored = readSelectedPeriod();
        const known = periods.find((period) => period.id === stored?.id);
        if (stored && periods.length > 0 && (!known || known.status === 'completed')) {
          writeSelectedPeriod(null);
          setViewingPeriod(null);
          clearApiCache();
          window.dispatchEvent(new CustomEvent(PERIOD_RESET_EVENT));
        }
      }).catch(() => setAvailablePeriods([]));
    }
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const organizationName = organizationLabel(user);
  const showCart = role === 'STUDENT';
  const hasRecords = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER'].includes(role);
  const canPlanAhead = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'].includes(role);
  const { subAccount } = useActiveSubAccount();
  const workspaces = useWorkspaces({ enabled: role !== 'SUPER_ADMIN', activeSubAccount: subAccount });
  const accountProfiles = workspaces.profiles;
  const activeProfileId = workspaces.activeProfileId;
  const profileLoading = workspaces.loading;
  const profileError = workspaces.error || workspaces.switchError;
  const switchingProfile = workspaces.switching;
  // The switcher takes the room the period label needs, so for these users the label folds into the icon below the xl width, the search into its icon and the name into a shorter one below 2xl.
  const hasSwitcher = workspaces.spaces.length >= 2 && Boolean(workspaces.current);
  const availableProfiles = accountProfiles.filter((profile) => profile.account_status === 'active' && profile.organization?.is_active && profile.organization.college_is_active !== false);

  useEffect(() => {
    const handleReset = () => {
      setViewingPeriod(activeAcademicPeriod);
      writeSelectedPeriod(null);
      clearApiCache();
    };
    window.addEventListener(PERIOD_RESET_EVENT, handleReset);
    return () => window.removeEventListener(PERIOD_RESET_EVENT, handleReset);
  }, [activeAcademicPeriod]);

  const handleSelectPeriod = (period) => {
    setPeriodDropdownOpen(false);
    if (period.status === 'completed') {
      navigate('/dashboard/records');
      return;
    }
    const isLive = period.id === activeAcademicPeriod?.id;
    setViewingPeriod(isLive ? null : period);
    writeSelectedPeriod(isLive ? null : period);
    clearApiCache();
    window.dispatchEvent(new CustomEvent(PERIOD_EVENT, { detail: isLive ? null : period }));
    notify.info(`Switched to AY ${period.academic_year?.label} · ${period.number === 1 ? '1st' : '2nd'} Sem`);
  };

  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationRequestRef.current;
    try {
      const res = await getNotifications({ per_page: 10 });
      if (requestId !== notificationRequestRef.current) return;
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
    window.addEventListener('hiusa-notifications-changed', loadNotifications);
    return () => window.removeEventListener('hiusa-notifications-changed', loadNotifications);
  }, [loadNotifications]);

  useEffect(() => {
    if (!showCart) {
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
  }, [showCart, loadCart]);

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

  function handleSwitchProfile(profile) {
    if (profile.id === (activeProfileId ?? user?.active_profile_id)) return;
    workspaces.switchProfile(profile);
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (cartRef.current && !cartRef.current.contains(e.target)) setCartOpen(false);
      if (periodRef.current && !periodRef.current.contains(e.target)) setPeriodDropdownOpen(false);
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
  const cartUnitPrice = (row) => Number(row?.item?.effective_price ?? row?.item?.price ?? 0);
  const cartTotal = cartItems.reduce((sum, row) => sum + cartUnitPrice(row) * Number(row?.quantity || 0), 0);


  const iconButton = 'relative grid h-11 w-11 place-items-center rounded-control text-ink-muted-strong transition-colors hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:h-10 sm:w-10';
  const countBadge = 'absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-700 px-1 text-xs font-semibold text-white ring-2 ring-white';
  const panelBase = 'fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 rounded-card border border-line bg-white shadow-raised sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-w-[calc(100vw-3rem)]';
  const panelItem = 'flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

  return (
    <header ref={headerRef} className="relative z-30 flex h-14 min-w-0 shrink-0 items-center gap-1.5 border-b border-line bg-white px-4 sm:gap-3 sm:px-6">
      <button
        type="button"
        aria-label="Open menu"
        onClick={onMenuToggle}
        className={`${iconButton} lg:hidden`}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <img src={hiusaLogo} alt="" className="hidden h-8 w-8 shrink-0 object-contain min-[420px]:block lg:hidden" />

      {(() => {
        const currentDisplayPeriod = (canPlanAhead && viewingPeriod) || activeAcademicPeriod;
        const isAdvanceMode = Boolean(activeAcademicPeriod && currentDisplayPeriod && currentDisplayPeriod.id !== activeAcademicPeriod.id && currentDisplayPeriod.status !== 'completed');
        const isArchiveMode = Boolean(currentDisplayPeriod && currentDisplayPeriod.status === 'completed');
        return (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2" ref={periodRef}>
            {currentDisplayPeriod?.academic_year?.label && (
              <div className={`relative min-w-0 ${hasSwitcher ? 'max-xl:shrink-0' : ''}`}>
                <button
                  type="button"
                  onClick={() => setPeriodDropdownOpen((open) => !open)}
                  aria-expanded={periodDropdownOpen}
                  aria-haspopup="listbox"
                  aria-label={`Academic Period: AY ${currentDisplayPeriod.academic_year.label} · ${currentDisplayPeriod.number === 1 ? '1st' : '2nd'} Semester`}
                  title={`AY ${currentDisplayPeriod.academic_year.label} · ${currentDisplayPeriod.number === 1 ? '1st' : '2nd'} Semester`}
                  className={`inline-flex h-11 max-w-full items-center gap-1.5 rounded-control border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:h-10 ${hasSwitcher ? 'max-xl:w-11 max-xl:justify-center max-xl:px-0 sm:max-xl:w-10' : ''} ${
                    isAdvanceMode
                      ? 'border-warning/40 bg-warning-tint text-ink hover:bg-warning-tint'
                      : isArchiveMode
                      ? 'border-line bg-page text-ink-muted-strong hover:bg-line-soft'
                      : 'border-line bg-white text-ink hover:bg-page'
                  }`}
                >
                  <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
                  <span className={`truncate sm:hidden ${hasSwitcher ? 'max-xl:hidden' : ''}`}>AY {currentDisplayPeriod.academic_year.label} · {currentDisplayPeriod.number === 1 ? '1st' : '2nd'}</span>
                  <span className={`hidden truncate ${hasSwitcher ? 'xl:inline' : 'sm:inline'}`}>AY {currentDisplayPeriod.academic_year.label} · {currentDisplayPeriod.number === 1 ? '1st' : '2nd'} Semester</span>
                  {isAdvanceMode && <span className={`hidden text-xs font-semibold text-warning-strong ${hasSwitcher ? 'xl:inline' : 'min-[480px]:inline'}`}>Planning</span>}
                  {isArchiveMode && <span className={`hidden text-xs font-semibold text-ink-muted-strong ${hasSwitcher ? 'xl:inline' : 'min-[480px]:inline'}`}>Archive</span>}
                  <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${hasSwitcher ? 'max-xl:hidden' : ''} ${periodDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {periodDropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Academic Periods"
                    className="absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-white p-1 shadow-raised"
                  >
                    <div className="border-b border-line px-3 pb-2 pt-1.5">
                      <p className="text-sm font-semibold text-ink">School year and semester</p>
                      <p className="mt-0.5 text-xs text-ink-muted">Pick an upcoming semester to plan ahead. Closed semesters are in Records.</p>
                    </div>
                    <div className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
                      {(availablePeriods.length > 0 ? availablePeriods : (activeAcademicPeriod ? [activeAcademicPeriod] : []))
                        .filter((p) => p.id === activeAcademicPeriod?.id || (p.status === 'completed' ? hasRecords : canPlanAhead))
                        .map((p) => {
                        const isSelected = p.id === currentDisplayPeriod.id;
                        const isLive = p.id === activeAcademicPeriod?.id;
                        const isUpcoming = p.status === 'upcoming';
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleSelectPeriod(p)}
                            className={`flex min-h-11 w-full items-center justify-between rounded-control px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                              isSelected ? 'bg-brand-50' : 'hover:bg-page'
                            }`}
                          >
                            <div>
                              <p className="text-sm font-medium text-ink">AY {p.academic_year?.label} · {p.number === 1 ? '1st' : '2nd'} Semester</p>
                              <p className="text-xs text-ink-muted">
                                {isLive ? 'Current semester' : isUpcoming ? 'Upcoming, for planning' : 'Closed, open in Records'}
                              </p>
                            </div>
                            {isSelected && <Check size={16} aria-hidden="true" className="text-brand-700" />}
                          </button>
                        );
                      })}
                    </div>
                    {hasRecords && (
                      <button
                        type="button"
                        onClick={() => { setPeriodDropdownOpen(false); navigate('/dashboard/records'); }}
                        className="mt-1 flex min-h-11 w-full items-center gap-2 border-t border-line px-3 pt-2 text-left text-sm font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        <History size={16} aria-hidden="true" />
                        Open records
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <WorkspaceSwitcher workspaces={workspaces} role={role} onProfileChange={handleSwitchProfile} />
          </div>
        );
      })()}

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Go to page"
        aria-keyshortcuts="Control+K Meta+K"
        className={`hidden h-10 items-center justify-between gap-3 rounded-control border border-line bg-white px-3 text-sm text-ink-muted transition-colors hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 min-[480px]:flex ${hasSwitcher ? '2xl:min-w-[270px]' : 'md:min-w-[210px] lg:min-w-[270px]'}`}
      >
        <span className="flex items-center gap-2">
          <Search size={16} aria-hidden="true" />
          <span className={`hidden ${hasSwitcher ? '2xl:inline' : 'md:inline'}`}>Go to page</span>
        </span>
        <span className={hasSwitcher ? 'hidden 2xl:contents' : 'contents'}>
          <Kbd className="hidden md:inline-flex">Ctrl K</Kbd>
        </span>
      </button>

      {showCart && (
        <div className="relative" ref={cartRef}>
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
            className={iconButton}
          >
            <ShoppingCart size={18} aria-hidden="true" />
            {cartTypeCount > 0 && <span className={countBadge}>{cartTypeCount > 9 ? '9+' : cartTypeCount}</span>}
          </button>

          {cartOpen && (
            <div
              id="topbar-cart-panel"
              role="region"
              aria-label="Cart summary"
              className={`${panelBase} flex max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] flex-col overflow-hidden sm:w-96`}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-ink">Your cart</p>
                <span className="text-xs text-ink-muted">{cartTypeCount} item type{cartTypeCount === 1 ? '' : 's'}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[300px]">
                {cartItems.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-ink-muted">Your cart is empty.</p>
                ) : (
                  cartItems.map((row) => (
                    <div key={row.item?.id || row.item?.name} className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{formatDisplayText(row.item?.name) || 'Item'}</p>
                        <p className="text-xs text-ink-muted">Qty: {row.quantity || 0} - {peso(cartUnitPrice(row))}</p>
                      </div>
                      <p className="text-sm font-medium tabular-nums text-ink">{peso(cartUnitPrice(row) * (row.quantity || 0))}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="shrink-0 border-t border-line px-4 py-3">
                <p className="mb-2 text-sm text-ink-muted">Total: <span className="font-medium tabular-nums text-ink">{peso(cartTotal)}</span></p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setCartOpen(false);
                    navigate('/dashboard/merchandise/order-merchandise', { state: { openCartAt: Date.now() } });
                  }}
                >
                  Open cart
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notification Bell */}
      <div className="relative" ref={notifRef}>
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
          className={iconButton}
        >
          <Bell size={18} aria-hidden="true" />
          {unreadCount > 0 && <span className={countBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>

        {notifOpen && (
          <div
            id="topbar-notifications-panel"
            role="region"
            aria-label="Notifications panel"
            className={`${panelBase} flex max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] flex-col overflow-hidden sm:w-80`}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-ink">
                Notifications
                {unreadCount > 0 && <span className="ml-2 text-xs font-medium text-brand-800">{unreadCount} new</span>}
              </p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="min-h-11 text-xs font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
                    className="mb-3 min-h-11 text-xs font-medium text-brand-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    Back to notifications
                  </button>
                  <p className="text-sm font-semibold text-ink">{formatDisplayText(selectedNotification.title)}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted-strong">{selectedNotification.message}</p>
                  <p className="mt-3 text-xs text-ink-muted">{timeAgo(selectedNotification.created_at)}</p>
                  {getNotificationDestination(selectedNotification, user?.role) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        setNotifOpen(false);
                        setSelectedNotification(null);
                        navigate(getNotificationDestination(selectedNotification, user?.role));
                      }}
                    >
                      Open related record
                    </Button>
                  )}
                </div>
              ) : recent5.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-muted">No notifications yet.</p>
              ) : (
                recent5.map((n) => {
                  const Icon = notificationIcon(n);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleNotificationClick(n)}
                      className={`flex w-full items-start gap-3 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-page ${n.is_read ? '' : 'bg-brand-50'}`}
                    >
                      <Icon size={18} className={`mt-0.5 shrink-0 ${notificationAppearance(n).icon}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${n.is_read ? 'font-normal text-ink-muted-strong' : 'font-semibold text-ink'}`}>{formatDisplayText(n.title)}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted-strong">{n.message}</p>
                        <p className="mt-1 text-xs text-ink-muted">{timeAgo(n.created_at)}</p>
                      </div>
                    </button>
                  );
                })
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
            if (!profileOpen && !workspaces.error && !workspaces.loading) workspaces.reload({ quiet: true });
            setNotifOpen(false);
            setCartOpen(false);
          }}
          className="flex h-11 items-center gap-2 rounded-control px-1.5 transition-colors hover:bg-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:px-2"
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-white">
            {initials}
          </div>
          <p className={`hidden truncate text-sm font-semibold text-ink sm:block ${hasSwitcher ? 'max-w-32 2xl:max-w-[min(12rem,25vw)]' : 'max-w-[min(12rem,25vw)]'}`} title={fullName}>{fullName}</p>
          <ChevronDown size={14} aria-hidden="true" className={`hidden text-ink-muted transition-transform motion-reduce:transition-none sm:block ${profileOpen ? 'rotate-180' : ''}`} />
        </button>

        {profileOpen && (
          <div id="topbar-profile-panel" role="region" aria-label="Account and profiles" className={`${panelBase} max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] overflow-y-auto p-1 sm:w-80`}>
            <div className="mb-1 border-b border-line px-3 py-3">
              <p className="text-sm font-semibold text-ink">{fullName}</p>
              <p className="break-all text-xs text-ink-muted-strong">{user?.email || ''}</p>
              <p className="mt-1 break-words text-xs text-ink-muted-strong">{organizationName} · {roleLabel}</p>
            </div>
            <section aria-label="Profiles" className="border-b border-line px-1 pb-2">
              <div className="flex items-center justify-between px-2 pb-1">
                <h2 className="text-xs font-medium text-ink-muted-strong">Profiles</h2>
                {availableProfiles.length > 1 && <span className="text-xs text-ink-muted-strong">Switch profile</span>}
              </div>
              {profileLoading ? <p role="status" className="px-2 py-3 text-xs text-ink-muted-strong">Loading profiles…</p> : profileError ? <div className="px-2 py-2"><p role="alert" className="text-xs text-danger-strong">{profileError}</p><button type="button" onClick={() => workspaces.reload()} className="mt-2 min-h-11 text-xs font-medium text-brand-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Try again</button></div> : availableProfiles.length === 0 ? <p className="px-2 py-3 text-xs text-ink-muted-strong">No active profiles available.</p> : <div className="space-y-0.5">
                {availableProfiles.map((profile) => {
                  const current = profile.id === (activeProfileId ?? user?.active_profile_id);
                  return <button key={profile.id} type="button" disabled={current || switchingProfile} onClick={() => handleSwitchProfile(profile)} aria-current={current ? 'true' : undefined} className={`flex min-h-12 w-full items-center gap-3 rounded-control px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-default ${current ? 'bg-brand-50' : 'hover:bg-page'} ${switchingProfile && !current ? 'opacity-60' : ''}`}>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{formatDisplayText(profile.organization?.name) || 'Organization'}</span><span className="block text-xs text-ink-muted">{profile.organization?.organization_type === 'COLLEGE' ? 'College profile' : 'Organization profile'} · {ROLE_LABELS[profile.role] || profile.role}</span></span>
                    {current && <span className="text-xs font-medium text-ink-muted-strong">Current</span>}
                  </button>;
                })}
                {availableProfiles.length === 1 && <p className="px-2 pb-2 text-xs leading-5 text-ink-muted-strong">{availableProfiles[0].organization?.organization_type === 'COLLEGE' ? 'Your college dashboard is available without an organization membership. If an organization adds you, its profile will appear here.' : 'This is your only active profile. Other profiles appear here when an organization adds you.'}</p>}
              </div>}
              {switchingProfile && <p role="status" className="px-2 py-2 text-xs text-ink-muted-strong">Switching profile…</p>}
            </section>
            <button
              type="button"
              onClick={() => { setProfileOpen(false); navigate('/dashboard/profile'); }}
              className={panelItem}
            >
              <User size={16} aria-hidden="true" />
              View profile
            </button>
            <button
              type="button"
              onClick={() => {
                setProfileOpen(false);
                setLogoutConfirmOpen(true);
              }}
              className={panelItem}
            >
              <LogOut size={16} aria-hidden="true" />
              Log out
            </button>
          </div>
        )}
      </div>
      <ConfirmModal
        open={logoutConfirmOpen}
        title="Log out"
        message="You will need to sign in again to access your dashboard."
        confirmText="Log out"
        variant="primary"
        busy={logoutBusy}
        onCancel={() => !logoutBusy && setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={role} />
    </header>
  );
}
