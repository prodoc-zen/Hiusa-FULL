import { NavLink, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ClipboardList,
  Coins,
  Home,
  LogOut,
  Megaphone,
  Package,
  Settings,
  Vote,
  X,
} from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { logout } from '../../services/authService';
import { useState } from 'react';


const mainNav = [
  { label: 'Dashboard', path: '/dashboard', icon: Home },
  { label: 'Finance', path: '/dashboard/finance', icon: Coins },
  { label: 'Events', path: '/dashboard/events', icon: CalendarDays },
  { label: 'Tasks', path: '/dashboard/tasks', icon: ClipboardList },
  { label: 'Elections', path: '/dashboard/elections', icon: Vote },
  { label: 'Merchandise', path: '/dashboard/merchandise', icon: Package },
  { label: 'Announcements', path: '/dashboard/announcements', icon: Megaphone },
];

const bottomNav = [
  { label: 'Settings', path: '/dashboard/settings', icon: Settings },
];

function NavItem({ label, path, icon: Icon }) {
  return (
    <NavLink
      to={path}
      end={path === '/dashboard'}
      className={({ isActive }) =>
        `flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-all duration-200 ${
          isActive
            ? 'bg-[#16C7F3]/15 text-white shadow-sm shadow-[#16C7F3]/10'
            : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
        }`
      }
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </NavLink>
  );
}

function OfficerProfile() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.06] px-3 py-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
        JC
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">'a'</p>
        <p className="truncate text-xs font-medium text-slate-400">President</p>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  const sidebarContent = (
    <>
      {/* Brand lockup */}
      <div className="flex h-[72px] items-center gap-3 border-b border-white/10 px-5">
        <img src={hiusaLogo} alt="HIUSA logo" className="h-10 w-10 object-contain" />
        <div>
          <p className="text-sm font-black text-white tracking-wide">HIUSA</p>
          <p className="text-[11px] font-medium text-slate-400">Officer System</p>
        </div>

        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="ml-auto grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {/* Main navigation */}
      <nav className="flex flex-1 flex-col px-3 py-4">
        <div className="space-y-1 flex-1">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Modules
          </p>
          {mainNav.map((item) => (
            <div key={item.path} onClick={onClose}>
              <NavItem {...item} />
            </div>
          ))}
        </div>

        {/* Bottom section */}
        <div className="space-y-1 border-t border-white/10 pt-4">
          {bottomNav.map((item) => (
            <div key={item.path} onClick={onClose}>
              <NavItem {...item} />
            </div>
          ))}
          <button
            type="button"
            onClick={handleLogout}
            className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-slate-400 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut size={18} strokeWidth={2} />
            Logout
          </button>
        </div>

        {/* Officer profile */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <OfficerProfile />
        </div>
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop sidebar — always visible */}
      <aside className="hidden min-h-screen w-[260px] shrink-0 flex-col bg-[#0B1831] lg:flex">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0B1831]/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-[#0B1831] shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
