import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Vote, CalendarDays, Megaphone } from 'lucide-react';
import { getElections } from '../../../services/electionService';

export default function StudentHomePage() {
  const [elections, setElections] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await getElections();
        if (!cancelled) {
          setElections(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (!cancelled) {
          setElections([]);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeCount = useMemo(
    () => elections.filter((election) => election.status === 'active').length,
    [elections]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Student Portal</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Welcome to HIUSA Voting</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Vote securely in active elections and review your election options.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Active Elections', value: activeCount, icon: Vote },
          { label: 'Upcoming Events', value: '-', icon: CalendarDays },
          { label: 'Announcements', value: '-', icon: Megaphone },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
              <item.icon size={20} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[#0F172A]">Voting Actions</h3>
            <p className="text-sm text-slate-500">Go directly to election list or ballot page.</p>
          </div>
          <div className="flex gap-2">
            <NavLink to="/dashboard/elections" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
              Election List
            </NavLink>
            <NavLink to="/dashboard/elections/cast-vote" className="rounded-lg bg-[#0B8ED0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0878B7]">
              Vote Now
            </NavLink>
          </div>
        </div>
      </section>
    </div>
  );
}
