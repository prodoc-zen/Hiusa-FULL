import { formatDisplayText } from '../../utils/displayText.js';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Building2, Check, ChevronDown, LogOut, Menu, MousePointerClick, Search, ShoppingCart, User, X } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import ConfirmModal from '../ConfirmModal';
import { Kbd } from '../ui';
import CommandPalette from './CommandPalette';
import { ROLE_LABELS } from './navigation';
import { getAccountProfiles, logout, switchAccountProfile } from '../../services/authService';
import { getNotifications, markRead, markAllRead } from '../../services/notificationService';
import { getActiveAcademicPeriod, getAcademicPeriods } from '../../services/systemAdministrationService';
import { getCollegeOrganizations } from '../../services/collegeOrganizationService';
import { unwrapList } from '../../services/pagination';
import { getNotificationDestination } from '../../utils/notificationLinks';
import { notificationIcon } from '../../utils/notificationIcon';
import notify from '../../lib/notify';
import { notificationAppearance } from '../../utils/notificationTone';
import { organizationLabel } from '../../utils/collegeIdentity';

const STUDENT_CART_KEY = 'hiusa_student_cart';

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

export default function TopBar({ onMenuToggle }) {
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
  const [viewingPeriod, setViewingPeriod] = useState(null);
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);
  const periodRef = useRef(null);
  const [subAccountDropdownOpen, setSubAccountDropdownOpen] = useState(false);
  const [collegeOrganizations, setCollegeOrganizations] = useState([]);
  const [activeSubAccount, setActiveSubAccount] = useState(() => {
    try {
      const stored = sessionStorage.getItem('hiusa_active_subaccount');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [subAccountSearch, setSubAccountSearch] = useState('');
  const subAccountRef = useRef(null);
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
      const stored = sessionStorage.getItem('hiusa_selected_academic_period');
      if (stored) {
        try { setViewingPeriod(JSON.parse(stored)); } catch {}
      }
    }).catch(() => setActiveAcademicPeriod(null));

    if (typeof getAcademicPeriods === 'function') {
      getAcademicPeriods().then((list) => {
        setAvailablePeriods(Array.isArray(list) ? list : (list?.data || []));
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
  const availableProfiles = accountProfiles.filter((profile) => profile.account_status === 'active' && profile.organization?.is_active && profile.organization.college_is_active !== false);
  const canOrderMerchandise = ['ADMIN', 'SBO_OFFICER', 'STUDENT'].includes(role);

  useEffect(() => {
    if (role === 'DEPARTMENT_HEAD' && typeof getCollegeOrganizations === 'function') {
      getCollegeOrganizations()
        .then((res) => {
          const list = unwrapList(res?.data);
          setCollegeOrganizations(list);
        })
        .catch(() => {});
    }
  }, [role]);

  useEffect(() => {
    const handleSubaccountChange = (e) => {
      setActiveSubAccount(e.detail || null);
    };
    window.addEventListener('hiusa-subaccount-switched', handleSubaccountChange);
    return () => window.removeEventListener('hiusa-subaccount-switched', handleSubaccountChange);
  }, []);

  useEffect(() => {
    const handleReset = () => {
      setViewingPeriod(activeAcademicPeriod);
      sessionStorage.removeItem('hiusa_selected_academic_period');
    };
    window.addEventListener('hiusa-reset-academic-period', handleReset);
    return () => window.removeEventListener('hiusa-reset-academic-period', handleReset);
  }, [activeAcademicPeriod]);

  const handleSelectPeriod = (period) => {
    setViewingPeriod(period);
    setPeriodDropdownOpen(false);
    sessionStorage.setItem('hiusa_selected_academic_period', JSON.stringify(period));
    window.dispatchEvent(new CustomEvent('hiusa-period-switched', { detail: period }));
    notify.info(`Switched view to AY ${period.academic_year?.label} · ${period.number === 1 ? '1st' : '2nd'} Sem`);
  };

  const handleSelectSubAccount = (org) => {
    setActiveSubAccount(org);
    setSubAccountDropdownOpen(false);
    if (org) {
      sessionStorage.setItem('hiusa_active_subaccount', JSON.stringify(org));
      window.dispatchEvent(new CustomEvent('hiusa-subaccount-switched', { detail: org }));
      notify.success(`Sub-Account: ${org.name}`);
    } else {
      sessionStorage.removeItem('hiusa_active_subaccount');
      window.dispatchEvent(new CustomEvent('hiusa-subaccount-switched', { detail: null }));
      notify.info("Returned to Dean's Office (Master View)");
    }
  };

  const filteredSubAccounts = useMemo(() => {
    if (!subAccountSearch.trim()) return collegeOrganizations;
    const term = subAccountSearch.toLowerCase();
    return collegeOrganizations.filter(
      (org) => org.name?.toLowerCase().includes(term) || org.acronym?.toLowerCase().includes(term)
    );
  }, [collegeOrganizations, subAccountSearch]);

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
      setProfileError('Could not switch profile. Try again.');
      setSwitchingProfile(false);
    }
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (cartRef.current && !cartRef.current.contains(e.target)) setCartOpen(false);
      if (periodRef.current && !periodRef.current.contains(e.target)) setPeriodDropdownOpen(false);
      if (subAccountRef.current && !subAccountRef.current.contains(e.target)) setSubAccountDropdownOpen(false);
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
    <header ref={headerRef} className="relative z-30 mx-2 mt-2 min-w-0 shrink-0 rounded-2xl border border-[#DDE7EF] bg-white shadow-sm sm:mx-6 sm:mt-6 sm:rounded-3xl">
      <div className="flex min-h-16 min-w-0 items-center gap-1.5 px-2 py-2 sm:gap-3 sm:px-6 sm:py-3">
        {/* Hamburger toggle */}
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuToggle}
          className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#F8FBFD] hover:text-[#0878B7] lg:hidden"
        >
          <Menu size={19} />
        </button>
        <img src={hiusaLogo} alt="" className="hidden h-8 w-8 shrink-0 object-contain min-[420px]:block lg:hidden" />

        {(() => {
          const currentDisplayPeriod = viewingPeriod || activeAcademicPeriod;
          const isAdvanceMode = Boolean(activeAcademicPeriod && currentDisplayPeriod && currentDisplayPeriod.id !== activeAcademicPeriod.id && currentDisplayPeriod.status !== 'completed');
          const isArchiveMode = Boolean(currentDisplayPeriod && currentDisplayPeriod.status === 'completed');
          return (
            <div className="flex min-w-0 flex-1 items-center gap-2.5" data-tour="topbar-period" ref={periodRef}>
              {currentDisplayPeriod?.academic_year?.label && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPeriodDropdownOpen((open) => !open)}
                    aria-expanded={periodDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label={`Academic Period: AY ${currentDisplayPeriod.academic_year.label} · ${currentDisplayPeriod.number === 1 ? '1st' : '2nd'} Semester`}
                    className={`hidden max-w-full items-center gap-2 truncate rounded-full border px-3.5 py-1.5 text-xs font-semibold transition min-[520px]:inline-flex active:scale-[0.98] cursor-pointer ${
                      isAdvanceMode
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : isArchiveMode
                        ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'border-[#DDE7EF] bg-[#F8FBFD] text-[#0F2F62] hover:border-[#0878B7]/40 hover:bg-white'
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isAdvanceMode ? 'bg-amber-500' : isArchiveMode ? 'bg-slate-400' : 'bg-[#0878B7]'
                      }`}
                      aria-hidden="true"
                    />
                    <span>AY {currentDisplayPeriod.academic_year.label} · {currentDisplayPeriod.number === 1 ? '1st' : '2nd'} Semester</span>
                    {isAdvanceMode && (
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                        Planning
                      </span>
                    )}
                    {isArchiveMode && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                        Archive
                      </span>
                    )}
                    <ChevronDown size={13} className={`text-slate-500 transition-transform duration-150 ${periodDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {periodDropdownOpen && (
                    <div
                      role="listbox"
                      aria-label="Academic Periods"
                      className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-[#DDE7EF] bg-white p-2 shadow-xl shadow-slate-200/60"
                    >
                      <div className="border-b border-[#DDE7EF] px-2.5 pb-2 pt-1">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">School Year &amp; Semester</p>
                        <p className="mt-0.5 text-xs font-medium text-slate-600">Switch context to prepare upcoming periods in advance.</p>
                      </div>
                      <div className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
                        {(availablePeriods.length > 0 ? availablePeriods : (activeAcademicPeriod ? [activeAcademicPeriod] : [])).map((p) => {
                          const isSelected = p.id === currentDisplayPeriod.id;
                          const isLive = p.id === activeAcademicPeriod?.id;
                          const isUpcoming = p.status === 'upcoming';
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSelectPeriod(p)}
                              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                                isSelected ? 'bg-[#EEF6FB] font-bold text-[#0878B7]' : 'text-[#0F172A] hover:bg-[#F8FBFD]'
                              }`}
                            >
                              <div>
                                <p className="font-semibold text-[#0F172A]">AY {p.academic_year?.label} · {p.number === 1 ? '1st' : '2nd'} Semester</p>
                                <p className="text-[10px] text-slate-500">
                                  {isLive ? '🟢 Live University Period' : isUpcoming ? '🟡 Advance Planning' : '⚪ Completed Archive'}
                                </p>
                              </div>
                              {isSelected && <Check size={14} className="text-[#0878B7]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {role === 'DEPARTMENT_HEAD' && (
                <div className="relative" ref={subAccountRef} data-tour="topbar-subaccount">
                  <button
                    type="button"
                    onClick={() => setSubAccountDropdownOpen((open) => !open)}
                    aria-expanded={subAccountDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label="Sub-Account Context Switcher"
                    className={`hidden max-w-full items-center gap-2 truncate rounded-full border px-3.5 py-1.5 text-xs font-semibold transition min-[640px]:inline-flex active:scale-[0.98] cursor-pointer ${
                      activeSubAccount
                        ? 'border-[#0878B7]/50 bg-[#EEF6FB] text-[#0878B7] hover:bg-brand-100'
                        : 'border-[#DDE7EF] bg-[#F8FBFD] text-[#0F2F62] hover:border-[#0878B7]/40 hover:bg-white'
                    }`}
                  >
                    <Building2 size={13} className={activeSubAccount ? 'text-[#0878B7]' : 'text-slate-500'} />
                    <span className="truncate max-w-[140px] sm:max-w-[180px]">
                      {activeSubAccount ? activeSubAccount.acronym || activeSubAccount.name : 'Dean’s Office'}
                    </span>
                    {activeSubAccount ? (
                      <span className="rounded bg-[#0878B7] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                        Sub-Account
                      </span>
                    ) : (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-700">
                        Master
                      </span>
                    )}
                    <ChevronDown size={13} className={`text-slate-500 transition-transform duration-150 ${subAccountDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {subAccountDropdownOpen && (
                    <div
                      role="listbox"
                      aria-label="Sub-Account Organizations"
                      className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-[#DDE7EF] bg-white p-2 shadow-xl shadow-slate-200/60"
                    >
                      <div className="border-b border-[#DDE7EF] px-2.5 pb-2 pt-1">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">GHL Sub-Account Switcher</p>
                        <p className="mt-0.5 text-xs font-medium text-slate-600">Switch into any student organization to oversee in supervisor mode.</p>
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder="Search organizations…"
                            value={subAccountSearch}
                            onChange={(e) => setSubAccountSearch(e.target.value)}
                            className="w-full rounded-lg border border-[#DDE7EF] px-2.5 py-1 text-xs text-[#0F172A] placeholder-slate-400 focus:border-[#0878B7] focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => handleSelectSubAccount(null)}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                            !activeSubAccount ? 'bg-[#EEF6FB] font-bold text-[#0878B7]' : 'text-[#0F172A] hover:bg-[#F8FBFD]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="grid h-6 w-6 place-items-center rounded bg-[#0F2F62] text-[10px] font-bold text-white">
                              HQ
                            </span>
                            <div>
                              <p className="font-semibold text-[#0F172A]">Dean’s Office (Master View)</p>
                              <p className="text-[10px] text-slate-500">Full college oversight</p>
                            </div>
                          </div>
                          {!activeSubAccount && <Check size={14} className="text-[#0878B7]" />}
                        </button>

                        <div className="my-1 border-t border-[#DDE7EF] px-2.5 pt-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Student Organizations ({collegeOrganizations.length})
                          </p>
                        </div>

                        {filteredSubAccounts.map((org) => {
                          const isSelected = activeSubAccount?.id === org.id;
                          return (
                            <button
                              key={org.id}
                              type="button"
                              onClick={() => handleSelectSubAccount(org)}
                              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                                isSelected ? 'bg-[#EEF6FB] font-bold text-[#0878B7]' : 'text-[#0F172A] hover:bg-[#F8FBFD]'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-brand-50 text-[10px] font-bold text-[#0878B7]">
                                  {(org.acronym || org.name || '?').slice(0, 2).toUpperCase()}
                                </span>
                                <div className="min-w-0 truncate">
                                  <p className="truncate font-semibold text-[#0F172A]">{formatDisplayText(org.name)}</p>
                                  <p className="text-[10px] text-slate-500">{org.acronym || 'Student Org'} · {org.members_count ?? 0} members</p>
                                </div>
                              </div>
                              {isSelected && <Check size={14} className="shrink-0 text-[#0878B7]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeSubAccount && (
                <button
                  type="button"
                  onClick={() => handleSelectSubAccount(null)}
                  title="Exit Sub-Account Mode and return to Dean's Office"
                  className="hidden items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900 transition hover:bg-amber-200 active:scale-95 sm:inline-flex"
                >
                  <span>Exit {activeSubAccount.acronym || 'Sub-Account'}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                data-tour="topbar-tour-btn"
                onClick={() => window.dispatchEvent(new CustomEvent('hiusa-open-onboarding-tour'))}
                className="hidden h-9 items-center gap-1.5 rounded-full border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-[#0F2F62] transition-colors hover:border-[#0B8ED0] hover:bg-[#F8FBFD] md:inline-flex"
              >
                <MousePointerClick size={14} className="text-[#0878B7]" aria-hidden="true" />
                <span>Interactive Tour</span>
              </button>
            </div>
          );
        })()}

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Go to page"
          aria-keyshortcuts="Control+K Meta+K"
          className="hidden h-10 items-center justify-between gap-3 rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] px-3 text-sm font-medium text-ink-muted transition-colors hover:border-[#0B8ED0]/40 hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 min-[360px]:flex md:min-w-[210px] lg:min-w-[270px]"
        >
          <span className="flex items-center gap-2">
            <Search size={16} aria-hidden="true" />
            <span className="hidden md:inline">Go to page</span>
          </span>
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
                      className={`flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition hover:bg-[#F8FBFD] ${notificationAppearance(n).row}`}
                    >
                      <Icon size={18} className={`mt-0.5 shrink-0 ${notificationAppearance(n).icon}`} aria-hidden="true" />
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
              {role === 'DEPARTMENT_HEAD' ? (
                <div title={`${organizationName} · ${roleLabel}`}>
                  <p className="break-words text-[11px] font-medium leading-tight text-slate-600">{organizationName}</p>
                  <p className="text-[11px] font-semibold leading-tight text-[#0878B7]">{roleLabel}</p>
                </div>
              ) : (
                <p className="max-w-40 truncate text-[11px] font-medium text-slate-600" title={`${organizationName} · ${roleLabel}`}>{organizationName} · {roleLabel}</p>
              )}
            </div>
            <ChevronDown size={14} className={`text-slate-600 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div id="topbar-profile-panel" role="region" aria-label="Account and profiles" className="fixed left-3 right-3 top-[var(--mobile-panel-top,7.5rem)] z-50 max-h-[calc(100dvh_-_var(--mobile-panel-top,7.5rem)_-_0.75rem)] overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white p-1.5 shadow-xl shadow-slate-200/60 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-3rem)]">
              <div className="border-b border-[#DDE7EF] px-3 py-3 mb-1.5">
                <p className="text-sm font-bold text-[#0F172A]">{fullName}</p>
                <p className="break-all text-xs font-medium text-slate-500">{user?.email || ''}</p>
                {role === 'DEPARTMENT_HEAD' && <p className="mt-1 text-xs font-semibold text-[#0878B7] sm:hidden">{organizationName} · {roleLabel}</p>}
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
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#0F172A]">{formatDisplayText(profile.organization?.name) || 'Organization'}</span><span className="block text-xs text-slate-600">{profile.organization?.organization_type === 'COLLEGE' ? 'College profile' : 'Organization profile'} · {ROLE_LABELS[profile.role] || profile.role}</span></span>
                      {current && <span className="text-xs font-semibold text-[#0F2F62]">Current</span>}
                    </button>;
                  })}
                  {availableProfiles.length === 1 && <p className="px-2 pb-2 text-xs leading-5 text-slate-600">{availableProfiles[0].organization?.organization_type === 'COLLEGE' ? 'Your college dashboard is available without an organization membership. If an organization adds you, its profile will appear here.' : 'This is your only active profile. Other profiles appear here when an organization adds you.'}</p>}
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
