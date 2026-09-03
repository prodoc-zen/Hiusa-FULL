import { CalendarDays, ChevronLeft, LayoutDashboard, ListChecks, Trophy, UserRoundCheck, UsersRound, Vote } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { resolveAssetUrl } from '../../utils/assetUrl';

const statusStyles = {
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  upcoming: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

const statusLabels = {
  pending_approval: 'Pending Approval',
  upcoming: 'Upcoming',
  active: 'Live Voting',
  closed: 'Closed',
};

function getRole() {
  try {
    return JSON.parse(localStorage.getItem('user'))?.role || null;
  } catch {
    return null;
  }
}

export default function ElectionBreadcrumb({ election, onClear }) {
  const isActive = election?.status === 'active';
  const role = getRole();
  const tabs = [
    { label: 'Overview', path: '/dashboard/elections/manage-elections', icon: LayoutDashboard, roles: ['ADMIN'] },
    { label: 'Candidates', path: '/dashboard/elections/manage-candidates', icon: UserRoundCheck, roles: ['ADMIN', 'SBO_OFFICER'] },
    { label: 'Party Lists', path: '/dashboard/elections/manage-partylists', icon: UsersRound, roles: ['ADMIN'] },
    { label: 'Voters', path: '/dashboard/elections/manage-voters', icon: ListChecks, roles: ['SBO_OFFICER'] },
    { label: 'Cast Vote', path: '/dashboard/elections/cast-vote', icon: Vote, roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
    { label: 'Results', path: '/dashboard/elections/election-results', icon: Trophy, roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] },
  ].filter((tab) => tab.roles.includes(role));

  return (
    <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
      <div className="grid min-h-44 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="relative min-h-36 overflow-hidden bg-[#0B1831] md:min-h-full">
          {election?.image_url ? (
            <img src={resolveAssetUrl(election.image_url)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-[#0F2F62] text-white/80">
              <Vote size={54} strokeWidth={1.5} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B1831]/75 via-transparent to-transparent" />
          <button type="button" onClick={onClear} className="absolute left-3 top-3 inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/30 bg-[#0B1831]/75 px-3 text-xs font-bold text-white backdrop-blur-sm hover:bg-[#0B1831]">
            <ChevronLeft size={14} /> Change election
          </button>
        </div>

        <div className="flex min-w-0 flex-col justify-center p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusStyles[election?.status] || statusStyles.closed}`}>
              {isActive && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
              {statusLabels[election?.status] || election?.status}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748B]">
              <CalendarDays size={14} />
              {new Date(election?.start_time).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' – '}
              {new Date(election?.end_time).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Selected election</p>
          <h1 className="mt-1 text-2xl font-black leading-tight text-[#0F172A] sm:text-3xl">{election?.title}</h1>
          <p className="mt-2 text-sm font-medium text-[#64748B]">Manage this election from one focused workspace.</p>
        </div>
      </div>

      <nav aria-label="Election workspace" className="overflow-x-auto border-t border-[#DDE7EF] bg-[#F8FBFD]">
        <div className="flex min-w-max px-2 sm:px-3">
          {tabs.map((tab) => (
            <NavLink key={tab.path} to={tab.path} className={({ isActive: tabActive }) => `inline-flex h-12 items-center gap-2 border-b-2 px-3 text-xs font-bold transition sm:px-4 sm:text-sm ${tabActive ? 'border-[#0B8ED0] bg-white text-[#0B8ED0]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}>
              <tab.icon size={15} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </section>
  );
}
