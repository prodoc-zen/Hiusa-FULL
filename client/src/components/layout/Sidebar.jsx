import { useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, CheckSquare, ChevronDown, ClipboardCheck, Coins, Home, LogOut, Megaphone, Package, Users, Vote, X } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { logout } from '../../services/authService';

const ROLE_LABELS = {
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
      ADMIN: '/dashboard/admin',
      SBO_OFFICER: '/dashboard/officer',
      DEPARTMENT_HEAD: '/dashboard/department-head',
      STUDENT: '/dashboard/student',
    },
    roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'],
  },
  {
    id: 'users',
    label: 'Manage Users',
    icon: Users,
    path: '/dashboard/admin/users',
    roles: ['ADMIN'],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: ClipboardCheck,
    path: '/dashboard/department-head/approvals',
    roles: ['DEPARTMENT_HEAD'],
  },
  {
    id: 'announcements',
    label: 'Announcements',
    icon: Megaphone,
    roles: ['ADMIN', 'SBO_OFFICER', 'STUDENT'],
    children: [
      { id: 'manage-announcements', label: 'Manage', path: '/dashboard/announcements/manage-announcements', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'create-announcement', label: 'Create', path: '/dashboard/announcements/create-announcement', roles: ['ADMIN', 'SBO_OFFICER'] },
      { id: 'view-announcements', label: 'View Feed', path: '/dashboard/announcements/view-announcements', roles: ['ADMIN', 'SBO_OFFICER', 'STUDENT'] },
    ],
  },
  {
    id: 'elections',
    label: 'Elections',
    icon: Vote,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'],
    children: [
      { id: 'manage-elections', label: 'Manage Election', path: '/dashboard/elections/manage-elections', roles: ['SBO_OFFICER'] },
      { id: 'manage-candidates', label: 'Candidates', path: '/dashboard/elections/manage-candidates', roles: ['SBO_OFFICER'] },
      { id: 'manage-voters', label: 'Voters', path: '/dashboard/elections/manage-voters', roles: ['SBO_OFFICER'] },
      { id: 'manage-partylists', label: 'Party Lists', path: '/dashboard/elections/manage-partylists', roles: ['SBO_OFFICER'] },
      { id: 'cast-vote', label: 'Cast Vote', path: '/dashboard/elections/cast-vote', roles: ['STUDENT'] },
      { id: 'election-results', label: 'Results', path: '/dashboard/elections/election-results', roles: ['SBO_OFFICER', 'ADMIN'] },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    icon: CalendarDays,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'],
    children: [
      { id: 'manage-events', label: 'Manage Events', path: '/dashboard/events/manage-events', roles: ['SBO_OFFICER'] },
      { id: 'event-planner', label: 'Event Planner', path: '/dashboard/events/event-planner', roles: ['SBO_OFFICER'] },
      { id: 'event-operations', label: 'Event Operations', path: '/dashboard/events/event-operations', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'activity-calendar', label: 'Activity Calendar', path: '/dashboard/events/activity-calendar', roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'] },
    ],
  },
  {
    id: 'financial',
    label: 'Financial',
    icon: Coins,
    roles: ['SBO_OFFICER', 'ADMIN'],
    children: [
      { id: 'financial-ledger', label: 'Digital Ledger', path: '/dashboard/finance/financial-ledger', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'budget-allocation', label: 'Budget Allocation', path: '/dashboard/finance/budget-allocation', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'financial-insights', label: 'Financial Insights', path: '/dashboard/finance/financial-insights', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'transaction-history', label: 'Transaction History', path: '/dashboard/finance/transaction-history', roles: ['SBO_OFFICER', 'ADMIN'] },
    ],
  },
  {
    id: 'tasks',
    label: 'Task Management',
    icon: CheckSquare,
    roles: ['SBO_OFFICER', 'ADMIN'],
    children: [
      { id: 'task-board', label: 'Task Board', path: '/dashboard/tasks/task-board', roles: ['SBO_OFFICER'] },
      { id: 'create-task', label: 'Create Task', path: '/dashboard/tasks/create-task', roles: ['SBO_OFFICER'] },
      { id: 'task-progress', label: 'Monitor Progress', path: '/dashboard/tasks/task-progress', roles: ['SBO_OFFICER', 'ADMIN'] },
    ],
  },
  {
    id: 'merchandise',
    label: 'Merchandise',
    icon: Package,
    roles: ['SBO_OFFICER', 'ADMIN', 'STUDENT'],
    children: [
      { id: 'manage-inventory', label: 'Inventory', path: '/dashboard/merchandise/manage-inventory', roles: ['SBO_OFFICER', 'ADMIN'] },
      { id: 'manage-orders', label: 'Manage Orders', path: '/dashboard/merchandise/manage-orders', roles: ['SBO_OFFICER'] },
      { id: 'claim-tokens', label: 'Issue Tokens', path: '/dashboard/merchandise/claim-tokens', roles: ['SBO_OFFICER'] },
      { id: 'order-merchandise', label: 'Order Merchandise', path: '/dashboard/merchandise/order-merchandise', roles: ['STUDENT'] },
      { id: 'my-orders', label: 'My Orders', path: '/dashboard/merchandise/my-orders', roles: ['STUDENT'] },
      { id: 'student-claim-tokens', label: 'Claim Tokens', path: '/dashboard/merchandise/claim-tokens', roles: ['STUDENT'] },
    ],
  },
];

const profileNav = [
  { label: 'Profile', path: '/dashboard/profile', icon: Users },
];

function NavItem({ label, path, icon: Icon, end, onClick }) {
  return (
    <NavLink
      to={path}
      end={end}
      onClick={onClick}
      className={({ isActive }) => `flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-all duration-200 ${isActive ? 'bg-[#16C7F3]/15 text-white shadow-sm shadow-[#16C7F3]/10' : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'}`}
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </NavLink>
  );
}

function SubNavItem({ label, path, onClick }) {
  return (
    <NavLink
      to={path}
      onClick={onClick}
      className={({ isActive }) => `flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold transition-all duration-200 ${isActive ? 'bg-[#0B8ED0] text-white shadow-sm' : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'}`}
    >
      {label}
    </NavLink>
  );
}

function OfficerProfile({ user, roleLabel }) {
  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || 'HI';
  const name = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Guest User';

  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.06] px-3 py-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">{initials}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{name}</p>
        <p className="truncate text-xs font-medium text-slate-400 capitalize">{roleLabel}</p>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});

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
  const nav = NAV_STRUCTURE.filter((item) => item.roles.includes(role));

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
    try {
      await logout();
    } finally {
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
      <div className="flex h-[72px] items-center gap-3 border-b border-white/10 px-5">
        <img src={hiusaLogo} alt="HIUSA logo" className="h-10 w-10 object-contain" />
        <div>
          <p className="text-sm font-black tracking-wide text-white">HIUSA</p>
          <p className="text-[11px] font-medium text-slate-400">{roleLabel} System</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close menu" className="ml-auto grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden">
          <X size={18} />
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <div className="flex-1 space-y-1">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Modules</p>
          {nav.map((item) => {
            const visibleChildren = getVisibleChildren(item);
            const hasChildren = visibleChildren.length > 0;
            const itemPath = resolveItemPath(item);

            if (!hasChildren) {
              return <NavItem key={item.id} label={item.label} path={itemPath} icon={item.icon} end onClick={handleNavItemClick} />;
            }

            const onParentRoute = visibleChildren.some((child) => location.pathname.startsWith(child.path));
            const isExpanded = expandedMenus[item.id] ?? onParentRoute;

            return (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!isExpanded) {
                      navigate(itemPath);
                    }

                    setExpandedMenus((previous) => ({
                      ...previous,
                      [item.id]: !isExpanded,
                    }));
                  }}
                  className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-all duration-200 ${onParentRoute ? 'bg-[#16C7F3]/15 text-white shadow-sm shadow-[#16C7F3]/10' : 'text-slate-300 hover:bg-white/[0.07] hover:text-white'}`}
                >
                  <item.icon size={18} strokeWidth={2} />
                  {item.label}
                  <ChevronDown size={13} className={`ml-auto text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && (
                  <div className="ml-4 mt-1 space-y-0.5 border-l border-white/15 pl-3">
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
              <NavItem {...item} />
            </div>
          ))}
          <button type="button" onClick={handleLogout} className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-semibold text-slate-400 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400">
            <LogOut size={18} strokeWidth={2} />
            Logout
          </button>
        </div>

        <div className="mt-4 border-t border-white/10 pt-4">
          <OfficerProfile user={user} roleLabel={roleLabel} />
        </div>
      </nav>
    </>
  );

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-[#0B1831]/60 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-[#0B1831] shadow-2xl transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>{sidebarContent}</aside>
    </>
  );
}
