import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu, Settings, User } from 'lucide-react';
import { logout } from '../../services/authService';
import { getNotifications, markRead, markAllRead } from '../../services/notificationService';

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TopBar({ title, pathname, onMenuToggle }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const profileRef = useRef(null);
  const notifRef = useRef(null);
  const navigate = useNavigate();

  const storedUser = localStorage.getItem('user');
  const user = storedUser ? JSON.parse(storedUser) : null;
  const initials = user ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() : 'HI';
  const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Guest User';
  const role = user?.role?.toLowerCase() ?? '';
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Member';

  const parentByPrefix = [
    ['/dashboard/announcements/', 'Announcements'],
    ['/dashboard/elections/', 'Elections'],
    ['/dashboard/events/', 'Events'],
    ['/dashboard/finance/', 'Financial'],
    ['/dashboard/tasks/', 'Tasks'],
    ['/dashboard/merchandise/', 'Merchandise'],
  ];
  const parentLabel = parentByPrefix.find(([prefix]) => pathname?.startsWith(prefix))?.[1] || null;

  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications();
      const data = res?.data?.notifications ?? (Array.isArray(res?.data) ? res.data : []);
      setNotifications(data.slice(0, 10));
    } catch {
      // notifications are non-critical; fail silently
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const onFocus = () => loadNotifications();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadNotifications]);

  async function handleMarkRead(id) {
    try {
      await markRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch {}
  }

  async function handleMarkAllRead() {
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  }

  async function handleNotificationClick(notification) {
    await handleMarkRead(notification.id);
    setNotifOpen(false);

    if (String(notification.title || '').startsWith('New Announcement:')) {
      navigate('/dashboard/announcements/view-announcements');
    }
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const recent5 = notifications.slice(0, 5);

  return (
    <header className="sticky top-0 z-30 border-b border-[#DDE7EF] bg-white">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuToggle}
          className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0] lg:hidden"
        >
          <Menu size={19} />
        </button>

        {/* Page title */}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">
            HIUSA{parentLabel ? ` · ${parentLabel}` : ''}
          </p>
          <h1 className="truncate text-lg font-extrabold text-[#0F172A] sm:text-xl">{title}</h1>
        </div>

        {/* Notification Bell */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => {
              setNotifOpen(!notifOpen);
              setProfileOpen(false);
            }}
            className="relative grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-[#16C7F3] px-1 text-[10px] font-black text-white ring-2 ring-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] rounded-lg border border-[#DDE7EF] bg-white shadow-xl shadow-slate-200/60 sm:w-80">
              <div className="flex items-center justify-between border-b border-[#DDE7EF] px-4 py-3">
                <p className="text-sm font-bold text-[#0F172A]">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-2 rounded-full bg-[#16C7F3]/15 px-2 py-0.5 text-[11px] font-black text-[#0B8ED0]">{unreadCount} new</span>
                  )}
                </p>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs font-bold text-[#0B8ED0] hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[340px] overflow-y-auto">
                {recent5.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bell size={28} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm text-slate-400">No notifications yet</p>
                  </div>
                ) : (
                  recent5.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleNotificationClick(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#F8FBFD] ${!n.is_read ? 'bg-[#EEF6FB]' : ''}`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-slate-200' : 'bg-[#16C7F3]'}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[13px] font-semibold ${n.is_read ? 'text-slate-500' : 'text-[#0F172A]'}`}>{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.message}</p>
                        <p className="mt-1 text-[11px] font-medium text-slate-300">{timeAgo(n.created_at)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => {
              setProfileOpen(!profileOpen);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] px-2 py-1.5 transition hover:bg-[#EEF6FB]"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
              {initials}
            </div>
            <div className="hidden min-w-0 text-left sm:block">
              <p className="text-[13px] font-bold text-[#0F172A]">{fullName}</p>
              <p className="text-[11px] font-medium text-slate-400">{roleLabel}</p>
            </div>
            <ChevronDown size={14} className={`hidden text-slate-400 transition-transform sm:block ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-[#DDE7EF] bg-white p-1.5 shadow-xl shadow-slate-200/60">
              <div className="border-b border-[#DDE7EF] px-3 py-3 mb-1.5">
                <p className="text-sm font-bold text-[#0F172A]">{fullName}</p>
                <p className="text-xs font-medium text-slate-400">{user?.email || ''}</p>
              </div>
              <button
                type="button"
                onClick={() => { setProfileOpen(false); navigate('/dashboard/profile'); }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
              >
                <User size={16} />
                View Profile
              </button>
              <button
                type="button"
                onClick={() => { setProfileOpen(false); navigate('/dashboard/settings'); }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
              >
                <Settings size={16} />
                Settings
              </button>
              <div className="my-1.5 border-t border-[#DDE7EF]" />
              <button
                type="button"
                onClick={async () => {
                  setProfileOpen(false);
                  try { await logout(); } finally { navigate('/login'); }
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
    </header>
  );
}
