import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ShieldCheck, Vote, BarChart3, CalendarDays, ClipboardList } from 'lucide-react';
import { getElections } from '../../../services/electionService';
import { getEvents } from '../../../services/eventService';
import { getTasks } from '../../../services/taskService';

export default function AdviserHomePage() {
  const [data, setData] = useState({ elections: [], events: [], tasks: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [electionsRes, eventsRes, tasksRes] = await Promise.all([
          getElections(),
          getEvents(),
          getTasks(),
        ]);

        if (cancelled) return;

        const elections = Array.isArray(electionsRes) ? electionsRes : (Array.isArray(electionsRes?.data) ? electionsRes.data : []);
        const events = Array.isArray(eventsRes?.data) ? eventsRes.data : (Array.isArray(eventsRes) ? eventsRes : []);
        const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : (Array.isArray(tasksRes) ? tasksRes : []);

        setData({ elections, events, tasks });
      } catch {
        if (!cancelled) setData({ elections: [], events: [], tasks: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const active = data.elections.filter((e) => e.status === 'active').length;
  const closed = data.elections.filter((e) => e.status === 'closed').length;
  const upcomingEvents = data.events.filter((e) => e.status === 'upcoming' || e.status === 'approved').length;
  const completedTasks = data.tasks.filter((t) => t.status === 'completed').length;
  const totalTasks = data.tasks.length;

  const stat = (val) => loading ? '—' : val;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Adviser Portal</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Oversight Dashboard</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Monitor election progress, events, and officer task completion.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active Elections', value: stat(active), icon: Vote },
          { label: 'Closed Elections', value: stat(closed), icon: BarChart3 },
          { label: 'Upcoming Events', value: stat(upcomingEvents), icon: CalendarDays },
          { label: 'Tasks Completed', value: loading ? '—' : `${completedTasks}/${totalTasks}`, icon: ClipboardList },
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

      {!loading && totalTasks > 0 && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-[#0F172A]">Task Completion Progress</h3>
            <span className="text-sm font-bold text-[#0B8ED0]">{Math.round((completedTasks / totalTasks) * 100)}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-[#EEF6FB]">
            <div
              className="h-3 rounded-full bg-[#0B8ED0] transition-all"
              style={{ width: `${Math.round((completedTasks / totalTasks) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">{completedTasks} of {totalTasks} tasks completed</p>
        </section>
      )}

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-[#0F172A]">Oversight Actions</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <NavLink to="/dashboard/elections" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
            View Elections
          </NavLink>
          <NavLink to="/dashboard/events" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
            View Events
          </NavLink>
          <NavLink to="/dashboard/tasks" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
            View Tasks
          </NavLink>
          <NavLink to="/dashboard/elections/results" className="rounded-lg bg-[#0B8ED0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0878B7]">
            View Results
          </NavLink>
        </div>
      </section>
    </div>
  );
}
