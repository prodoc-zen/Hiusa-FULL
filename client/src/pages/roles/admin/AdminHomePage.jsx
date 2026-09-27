import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  ClipboardCheck,
  Eye,
  FileText,
  GraduationCap,
  Megaphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getUsers } from '../../../services/userService';
import { getAnnouncements } from '../../../services/announcementService';
import { getForecasts } from '../../../services/financeService';
import { listMeta, unwrapList } from '../../../services/pagination';
import FinancialForecastChart from '../../../components/finance/FinancialForecastChart';

const ADMIN_TOOLS = [
  {
    title: 'Manage user accounts',
    description: 'Create accounts, review access, and maintain member records.',
    to: '/dashboard/admin/users',
    icon: Users,
  },
  {
    title: 'SBO positions',
    description: 'Maintain the organization positions assigned to officers.',
    to: '/dashboard/admin/sbo-positions',
    icon: Briefcase,
  },
  {
    title: 'Programs and sections',
    description: 'Keep academic groupings available for scoped administration.',
    to: '/dashboard/admin/programs-sections',
    icon: GraduationCap,
  },
  {
    title: 'General audit log',
    description: 'Review recorded administrative actions and account changes.',
    to: '/dashboard/audit-logs',
    icon: ClipboardCheck,
  },
];

const SUMMARY_BORDERS = [
  '',
  'border-t border-[#DDE7EF] sm:border-l sm:border-t-0',
  'border-t border-[#DDE7EF] sm:border-t xl:border-l xl:border-t-0',
  'border-t border-[#DDE7EF] sm:border-l sm:border-t xl:border-l xl:border-t-0',
];

function readAdminName() {
  try {
    const stored = JSON.parse(localStorage.getItem('user') || 'null');
    return stored?.first_name?.trim() || 'Administrator';
  } catch {
    return 'Administrator';
  }
}

export default function AdminHomePage() {
  const [totalUsers, setTotalUsers] = useState(0);
  const [usersByRole, setUsersByRole] = useState({});
  const [published, setPublished] = useState(0);
  const [drafts, setDrafts] = useState(0);
  const [forecasts, setForecasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const adminName = readAdminName();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');

      try {
        // These endpoints are paginated. Their server totals and role summary
        // provide the complete organization counts without loading every row.
        const [usersRes, publishedRes, draftRes, forecastsRes] = await Promise.all([
          getUsers({ per_page: 1 }),
          getAnnouncements({ publication_status: 'published', per_page: 1 }),
          getAnnouncements({ publication_status: 'draft', per_page: 1 }),
          getForecasts({ per_page: 12 }),
        ]);

        if (cancelled) return;

        setTotalUsers(Number(usersRes?.total ?? 0));
        setUsersByRole(usersRes?.summary?.by_role ?? {});
        setPublished(listMeta(publishedRes?.data).total);
        setDrafts(listMeta(draftRes?.data).total);
        setForecasts(unwrapList(forecastsRes?.data));
      } catch {
        if (!cancelled) {
          setLoadError('Dashboard totals could not be loaded. Your administration tools are still available.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const countByRole = (role) => Number(usersByRole[role] ?? 0);
  const totalAnnouncements = published + drafts;
  const summaryItems = [
    { label: 'Total Accounts', value: totalUsers, icon: Users },
    { label: 'Officers', value: countByRole('SBO_OFFICER'), icon: Briefcase },
    { label: 'Published Announcements', value: published, icon: Megaphone },
    { label: 'Draft Announcements', value: drafts, icon: FileText },
  ];

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-5 overflow-hidden rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-5 text-white sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#16C7F3]">Administrator dashboard</p>
          <h2 className="mt-2 text-2xl font-black sm:text-3xl">Welcome back, {adminName}</h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-200">
            Review organization access first, then continue with account maintenance or official publishing.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-white/15 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-white/10 text-[#16C7F3]">
            <ShieldCheck size={21} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Workspace</p>
            <p className="mt-0.5 text-sm font-bold">Organization control</p>
          </div>
        </div>
      </section>

      {loadError && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="font-semibold">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-xs font-bold text-red-700 transition hover:bg-red-100"
          >
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      )}

      <section className="grid grid-cols-1 overflow-hidden rounded-lg border border-[#DDE7EF] bg-white sm:grid-cols-2 xl:grid-cols-4" aria-label="Administration summary">
        {summaryItems.map((item, index) => (
          <dl
            key={item.label}
            className={`flex min-h-28 items-start justify-between gap-4 p-4 sm:p-5 ${SUMMARY_BORDERS[index]}`}
          >
            <div>
              <dt className="text-xs font-semibold leading-5 text-slate-500">{item.label}</dt>
              <dd className="mt-2 text-2xl font-black tabular-nums text-[#0F172A]">
                {loading
                  ? <span className="block h-8 w-14 animate-pulse rounded bg-slate-100" aria-hidden="true" />
                  : item.value.toLocaleString()}
              </dd>
            </div>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
              <item.icon size={18} />
            </span>
          </dl>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="rounded-lg border border-[#DDE7EF] bg-white p-5">
            <div className="flex flex-col gap-2 border-b border-[#DDE7EF] pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#0878B7]">Financial outlook</p>
                <h3 className="mt-1 text-lg font-black text-[#0F172A]">Income, expenses, and projected balance</h3>
              </div>
              <NavLink to="/dashboard/finance/financial-insights" className="inline-flex min-h-11 items-center text-xs font-bold text-[#0878B7] hover:underline">Open Financial Insights <ArrowRight size={14} className="ml-1" /></NavLink>
            </div>
            {loading ? <div className="mt-5 h-64 animate-pulse rounded-lg bg-slate-100" role="status"><span className="sr-only">Loading financial forecast</span></div> : forecasts.length ? <FinancialForecastChart forecasts={forecasts} /> : <div className="py-10 text-center"><p className="text-sm font-semibold text-slate-600">No financial forecast has been generated yet.</p><NavLink to="/dashboard/finance/financial-insights" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7] hover:underline">Generate the first forecast</NavLink></div>}
          </section>

          <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
            <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
              <div>
                <h3 className="text-base font-black text-[#0F172A]">Administration workspace</h3>
                <p className="mt-1 text-xs font-medium text-slate-500">Core tools for maintaining the organization.</p>
              </div>
              <ShieldCheck size={19} className="text-[#0878B7]" />
            </div>
            <div className="divide-y divide-[#DDE7EF]">
              {ADMIN_TOOLS.map((tool) => (
                <NavLink
                  key={tool.to}
                  to={tool.to}
                  className="group flex min-h-20 items-center gap-3 px-4 py-3 transition hover:bg-[#F8FBFD] sm:px-5"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0F2F62]">
                    <tool.icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-[#0F172A]">{tool.title}</span>
                    <span className="mt-0.5 block text-xs font-medium leading-5 text-slate-500">{tool.description}</span>
                  </span>
                  <ArrowRight size={17} className="shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-[#0878B7]" />
                </NavLink>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-[#DDE7EF] bg-white">
            <div className="bg-[#0F2F62] p-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Publishing overview</p>
                  <h3 className="mt-1 text-lg font-black">Official announcements</h3>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 text-[#16C7F3]">
                  <Megaphone size={19} />
                </span>
              </div>
              <dl className="mt-6 border-t border-white/15 pt-4">
                <dt className="text-xs font-medium text-slate-300">Total Announcements</dt>
                <dd className="mt-1 text-3xl font-black tabular-nums">
                  {loading
                    ? <span className="block h-9 w-16 animate-pulse rounded bg-white/10" aria-hidden="true" />
                    : totalAnnouncements.toLocaleString()}
                </dd>
              </dl>
            </div>

            <div className="p-5">
              <dl className="divide-y divide-[#DDE7EF] border-y border-[#DDE7EF]">
                <div className="flex items-center justify-between py-3">
                  <dt className="text-sm font-semibold text-slate-600">Published</dt>
                  <dd className="font-black tabular-nums text-[#0F172A]">{loading ? '...' : published.toLocaleString()}</dd>
                </div>
                <div className="flex items-center justify-between py-3">
                  <dt className="text-sm font-semibold text-slate-600">Drafts awaiting review</dt>
                  <dd className="font-black tabular-nums text-[#0F172A]">{loading ? '...' : drafts.toLocaleString()}</dd>
                </div>
              </dl>

              {!loading && drafts > 0 && (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-5 text-amber-800">
                  {drafts} {drafts === 1 ? 'draft is' : 'drafts are'} ready for review.
                </p>
              )}

              <NavLink
                to="/dashboard/announcements/create-announcement"
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white transition hover:bg-[#0F2F62]"
              >
                <Plus size={16} /> Create Announcement
              </NavLink>
              <NavLink
                to="/dashboard/announcements/manage-announcements"
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-[#0F172A] transition hover:bg-[#F8FBFD]"
              >
                <FileText size={16} /> Manage Announcements
              </NavLink>
              <NavLink
                to="/dashboard/announcements/view-announcements"
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold text-[#0878B7] transition hover:bg-[#F8FBFD]"
              >
                <Eye size={16} /> View Feed
              </NavLink>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
