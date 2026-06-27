import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Users, Search, CheckCircle, Clock } from 'lucide-react';
import { getElectionVoters } from '../../services/electionService';

export default function ManageVotersPage() {
  const { election } = useOutletContext();
  const [voters, setVoters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  useEffect(() => {
    if (!election) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getElectionVoters(election.id);
        if (!cancelled) setVoters(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setError('Failed to load voters.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [election?.id]);

  if (!election) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-slate-500">Election not found.</p>
      </div>
    );
  }

  const filtered = voters.filter((voter) => {
    const fullName = `${voter.first_name} ${voter.last_name}`.toLowerCase();
    const matchesSearch = fullName.includes(search.toLowerCase()) || (voter.school_id || '').includes(search);
    const matchesFilter =
      filterStatus === 'All' ||
      (filterStatus === 'Voted' && voter.has_voted) ||
      (filterStatus === 'Not Yet' && !voter.has_voted);
    return matchesSearch && matchesFilter;
  });

  const votedCount = voters.filter((v) => v.has_voted).length;
  const notVotedCount = voters.length - votedCount;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Voters', value: voters.length, icon: Users, color: { bg: 'bg-[#E6F6FD]', icon: 'text-[#0B8ED0]', border: 'border-[#0B8ED0]/20' } },
          {
            label: 'Voted',
            value: votedCount,
            sub: `${voters.length > 0 ? Math.round((votedCount / voters.length) * 100) : 0}% turnout`,
            icon: CheckCircle,
            color: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-200' },
          },
          {
            label: 'Not Yet Voted',
            value: notVotedCount,
            sub: 'Still pending',
            icon: Clock,
            color: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-200' },
          },
          {
            label: 'Election Status',
            value: election.status,
            sub: 'Current state',
            icon: Users,
            color: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-200' },
          },
        ].map((stat) => (
          <div key={stat.label} className={`flex items-start gap-4 rounded-xl border bg-white p-5 shadow-sm ${stat.color.border}`}>
            <div className={`rounded-lg p-2.5 ${stat.color.bg}`}>
              <stat.icon size={20} className={stat.color.icon} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">{stat.label}</p>
              <p className="mt-0.5 text-2xl font-black text-[#0F172A] tabular-nums">{stat.value}</p>
              {stat.sub && <p className="mt-1 text-xs text-[#64748B]">{stat.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-base font-bold text-[#0F172A]">Voters: {election.title}</h3>
            <p className="text-sm font-medium text-[#64748B]">{voters.length} registered voters for this election</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 p-5 pb-0">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or school ID..."
              className="h-10 w-full rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] pl-9 pr-4 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 transition"
            />
          </div>
          <div className="flex gap-1.5">
            {['All', 'Voted', 'Not Yet'].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                  filterStatus === s ? 'bg-[#0B1831] text-white' : 'border border-[#DDE7EF] bg-[#F8FBFD] text-slate-600 hover:bg-[#EEF6FB]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto p-5 pt-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={() => setFilterStatus(filterStatus)} className="mt-2 text-xs font-semibold text-[#0B8ED0] hover:underline">Retry</button>
            </div>
          ) : (
            <table className="w-full min-w-[550px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">School ID</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Vote Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {filtered.map((voter) => (
                  <tr key={voter.id} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-[10px] font-black text-white">
                          {voter.first_name?.[0] ?? ''}{voter.last_name?.[0] ?? ''}
                        </div>
                        <span className="font-semibold text-[#0F172A]">{voter.first_name} {voter.last_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-[#64748B]">{voter.school_id}</td>
                    <td className="px-4 py-3.5 text-xs text-[#64748B]">{voter.email}</td>
                    <td className="px-4 py-3.5">
                      {voter.has_voted ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F6FD] px-2.5 py-0.5 text-[11px] font-bold text-[#0B8ED0]">
                          <CheckCircle size={11} />
                          Voted
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-[#94A3B8]">
                          Not Yet
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-[#94A3B8]">
                      No voters match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
