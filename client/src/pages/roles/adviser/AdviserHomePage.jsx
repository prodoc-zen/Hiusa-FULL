import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ShieldCheck, Vote, BarChart3 } from 'lucide-react';
import { getElections } from '../../../services/electionService';

export default function AdviserHomePage() {
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

  const active = useMemo(() => elections.filter((election) => election.status === 'active').length, [elections]);
  const closed = useMemo(() => elections.filter((election) => election.status === 'closed').length, [elections]);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Adviser Portal</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Election Oversight</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Monitor election progress and review verified results.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Active Elections', value: active, icon: Vote },
          { label: 'Closed Elections', value: closed, icon: BarChart3 },
          { label: 'Oversight Status', value: 'On Track', icon: ShieldCheck },
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
        <h3 className="text-lg font-bold text-[#0F172A]">Election Monitoring</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <NavLink to="/dashboard/elections" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
            View Elections
          </NavLink>
          <NavLink to="/dashboard/elections/results" className="rounded-lg bg-[#0B8ED0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0878B7]">
            View Results
          </NavLink>
        </div>
      </section>
    </div>
  );
}
