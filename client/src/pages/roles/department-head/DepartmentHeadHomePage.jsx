import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ShieldCheck, Vote, BarChart3, CalendarDays, ClipboardCheck, ClipboardList, Megaphone } from 'lucide-react';
import { getElections } from '../../../services/electionService';
import { getEvents } from '../../../services/eventService';
import { getTasks } from '../../../services/taskService';
import { getAnnouncements } from '../../../services/announcementService';
import { getApprovalRequests } from '../../../services/approvalService';

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DepartmentHeadHomePage() {
  const [data, setData] = useState({ elections: [], events: [], tasks: [], announcements: [], pendingApprovals: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [electionsRes, eventsRes, tasksRes, announcementsRes, approvalsRes] = await Promise.all([
          getElections(),
          getEvents(),
          getTasks(),
          getAnnouncements(),
          getApprovalRequests({ status: 'pending' }),
        ]);

        if (cancelled) return;

        setData({
          elections: Array.isArray(electionsRes) ? electionsRes : (Array.isArray(electionsRes?.data) ? electionsRes.data : []),
          events: Array.isArray(eventsRes?.data) ? eventsRes.data : (Array.isArray(eventsRes) ? eventsRes : []),
          tasks: Array.isArray(tasksRes?.data) ? tasksRes.data : (Array.isArray(tasksRes) ? tasksRes : []),
          announcements: Array.isArray(announcementsRes?.data) ? announcementsRes.data : [],
          pendingApprovals: Array.isArray(approvalsRes?.data) ? approvalsRes.data : [],
        });
      } catch {
        if (!cancelled) setData({ elections: [], events: [], tasks: [], announcements: [], pendingApprovals: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const activeElection = data.elections.find((e) => e.status === 'active') || null;
  const upcomingEvents = data.events
    .filter((e) => e.status === 'upcoming' || e.status === 'approved')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 4);
  const completedTasks = data.tasks.filter((t) => t.status === 'completed').length;
  const totalTasks = data.tasks.length;
  const recentAnnouncements = data.announcements.filter((a) => a.is_published).slice(0, 3);

  const stat = (val) => loading ? '-' : val;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Department Head Portal</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Oversight Dashboard</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Monitor election progress, events, and officer task completion.</p>
      </section>

      {!loading && data.pendingApprovals.length > 0 && (
        <NavLink
          to="/dashboard/department-head/approvals"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm transition hover:bg-amber-100"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-white text-amber-600">
              <ClipboardCheck size={20} />
            </div>
            <div>
              <p className="font-bold text-[#0F172A]">{data.pendingApprovals.length} item{data.pendingApprovals.length === 1 ? '' : 's'} awaiting your approval</p>
              <p className="text-sm text-amber-700">Events, budgets, and elections need your sign-off before they go live.</p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-bold text-amber-700">Review →</span>
        </NavLink>
      )}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Active Elections', value: stat(data.elections.filter((e) => e.status === 'active').length), icon: Vote },
          { label: 'Closed Elections', value: stat(data.elections.filter((e) => e.status === 'closed').length), icon: BarChart3 },
          { label: 'Upcoming Events', value: stat(upcomingEvents.length), icon: CalendarDays },
          { label: 'Tasks Completed', value: loading ? '-' : `${completedTasks}/${totalTasks}`, icon: ClipboardList },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
              <item.icon size={20} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A] tabular-nums">{item.value}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Active Election Card */}
          {activeElection ? (
            <section className="rounded-xl border border-[#0B8ED0]/25 bg-gradient-to-br from-[#E6F6FD] to-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Active Election</p>
                  <h3 className="mt-1 text-lg font-black text-[#0F172A]">{activeElection.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(activeElection.start_date)} to {formatDate(activeElection.end_date)}
                  </p>
                </div>
                <span className="mt-1 rounded-full bg-[#0B8ED0] px-3 py-1 text-[11px] font-black text-white">LIVE</span>
              </div>
              <div className="mt-4 flex gap-2">
                <NavLink to="/dashboard/elections" className="rounded-lg border border-[#DDE7EF] bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-[#F8FBFD]">
                  View Details
                </NavLink>
                <NavLink to="/dashboard/elections/election-results" className="rounded-lg bg-[#0B8ED0] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0878B7]">
                  View Results
                </NavLink>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-100 text-slate-400">
                  <Vote size={20} />
                </div>
                <div>
                  <p className="font-bold text-[#0F172A]">No Active Election</p>
                  <p className="text-sm text-slate-400">No elections are currently running.</p>
                </div>
              </div>
            </section>
          )}

          {/* Upcoming Events */}
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
              <h3 className="text-base font-bold text-[#0F172A]">Upcoming Events</h3>
              <NavLink to="/dashboard/events" className="text-xs font-bold text-[#0B8ED0] hover:underline">View all</NavLink>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">{[...Array(3)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : upcomingEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No upcoming events.</p>
            ) : (
              <div className="divide-y divide-[#E5EDF3]">
                {upcomingEvents.map((ev) => (
                  <div key={ev.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                      <CalendarDays size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[#0F172A]">{ev.title}</p>
                      <p className="text-xs text-slate-400">{formatDate(ev.start_time)}{ev.location ? ` · ${ev.location}` : ''}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#E6F6FD] px-2.5 py-0.5 text-[11px] font-bold capitalize text-[#0B8ED0]">{ev.status}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Task Progress */}
          {!loading && totalTasks > 0 && (
            <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-[#0F172A]">Task Progress</h3>
                <span className="text-sm font-black text-[#0B8ED0]">{Math.round((completedTasks / totalTasks) * 100)}%</span>
              </div>
              <div className="h-3 w-full rounded-full bg-[#EEF6FB]">
                <div
                  className="h-3 rounded-full bg-[#0B8ED0] transition-all"
                  style={{ width: `${Math.round((completedTasks / totalTasks) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-medium text-slate-400">{completedTasks} of {totalTasks} completed</p>
            </section>
          )}

          {/* Recent Announcements */}
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
              <h3 className="text-base font-bold text-[#0F172A]">Recent Announcements</h3>
              <NavLink to="/dashboard/announcements/view-announcements" className="text-xs font-bold text-[#0B8ED0] hover:underline">View all</NavLink>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">{[...Array(3)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : recentAnnouncements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No announcements yet.</p>
            ) : (
              <div className="divide-y divide-[#E5EDF3]">
                {recentAnnouncements.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                      <Megaphone size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#0F172A]">{a.title}</p>
                      <p className="line-clamp-2 text-xs text-slate-400">{a.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Actions */}
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-bold text-[#0F172A]">Oversight Actions</h3>
            <div className="space-y-2">
              {[
                { label: 'Review Approvals', path: '/dashboard/department-head/approvals' },
                { label: 'View Elections', path: '/dashboard/elections' },
                { label: 'View Events', path: '/dashboard/events' },
                { label: 'View Tasks', path: '/dashboard/tasks' },
                { label: 'View Results', path: '/dashboard/elections/election-results' },
              ].map((a) => (
                <NavLink
                  key={a.path}
                  to={a.path}
                  className="flex h-10 w-full items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 text-sm font-semibold text-[#0F172A] transition hover:border-[#0B8ED0]/40 hover:bg-white"
                >
                  {a.label}
                </NavLink>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
