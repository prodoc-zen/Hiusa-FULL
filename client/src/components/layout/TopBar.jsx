import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Settings,
  User,
} from 'lucide-react';

export default function TopBar({ title, onMenuToggle }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            HIUSA System
          </p>
          <h1 className="truncate text-lg font-extrabold text-[#0F172A] sm:text-xl">
            {title}
          </h1>
        </div>

        {/* Search */}
        <div className="hidden h-10 w-full max-w-[280px] items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 text-sm text-slate-400 transition hover:border-[#0B8ED0]/30 md:flex">
          <Search size={16} />
          <span className="text-[13px]">Search...</span>
        </div>

        {/* Notifications */}
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
        >
          <Bell size={17} />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#DC2626] ring-2 ring-white" />
        </button>

        {/* Profile dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 rounded-lg border border-[#DDE7EF] px-2 py-1.5 transition hover:bg-[#EEF6FB]"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
              JC
            </div>
            <div className="hidden min-w-0 text-left sm:block">
              <p className="text-[13px] font-bold text-[#0F172A]">John Carlo</p>
              <p className="text-[11px] font-medium text-slate-400">President</p>
            </div>
            <ChevronDown
              size={14}
              className={`hidden text-slate-400 transition-transform sm:block ${
                profileOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-[#DDE7EF] bg-white p-1.5 shadow-xl shadow-slate-200/60 animate-in">
              <div className="border-b border-[#DDE7EF] px-3 py-3 mb-1.5">
                <p className="text-sm font-bold text-[#0F172A]">John Carlo</p>
                <p className="text-xs font-medium text-slate-400">john.carlo@hiusa.edu</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  navigate('/dashboard/settings');
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
              >
                <User size={16} />
                View Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  navigate('/dashboard/settings');
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-[#EEF6FB] hover:text-[#0B8ED0]"
              >
                <Settings size={16} />
                Settings
              </button>
              <div className="my-1.5 border-t border-[#DDE7EF]" />
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  navigate('/login');
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
