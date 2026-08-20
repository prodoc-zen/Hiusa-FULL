import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Vote, Award, Users, Trophy, SlidersHorizontal } from 'lucide-react';
import { getElectionResults } from '../../../services/electionService';

function Avatar({ name, size = 'sm' }) {
  const safeName = name || '?';
  const initials = safeName
    .split(' ')
    .map((value) => value[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  const colors = [
    'bg-[#0B8ED0]',
    'bg-purple-500',
    'bg-emerald-500',
    'bg-red-500',
    'bg-amber-500',
    'bg-indigo-500',
    'bg-pink-500',
  ];
  const bg = colors[safeName.charCodeAt(0) % colors.length];
  const sz = size === 'lg' ? 'w-12 h-12 text-base' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';

  return <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${sz} ${bg}`}>{initials}</div>;
}

export default function ElectionResultsPage() {
  const { election } = useOutletContext();
  const [positionFilter, setPositionFilter] = useState('all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const electionIsClosed = election?.status === 'closed';

  useEffect(() => {
    let cancelled = false;

    if (!election?.id || !electionIsClosed) {
      setResults([]);
      setLoading(false);
      setError('');
      return () => { cancelled = true; };
    }

    setLoading(true);
    setError('');
    getElectionResults(election.id)
      .then((data) => {
        if (!cancelled) setResults(Array.isArray(data) ? data : []);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load election results.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [election?.id, electionIsClosed]);

  if (!election) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-slate-500">Election not found.</p>
      </div>
    );
  }

  if (!electionIsClosed) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
        <Trophy size={32} className="mx-auto mb-3 text-amber-500" />
        <p className="font-bold text-amber-900">Results are sealed while voting is open.</p>
        <p className="mt-1 text-sm font-medium text-amber-700">Final tallies and winners become available after the election closes.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading election results">
        <div className="h-24 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />
        {[1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />)}
        <span className="sr-only">Loading election results...</span>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>;
  }

  const positions = results.map((result) => result.position);
  const allCandidates = results.flatMap((result) => result.candidates || []);
  const totalVotesCast = results.reduce((sum, result) => sum + Number(result.totalVotes || 0), 0);
  const uniqueVoters = results.reduce((highest, result) => Math.max(highest, Number(result.totalVotes || 0)), 0);
  const positionResults = results.filter(({ position }) => positionFilter === 'all' || String(position.id) === positionFilter);

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Official Results</p>
          <h2 className="mt-1 text-xl font-black text-[#0F172A]">{election.title}</h2>
          <p className="mt-1 text-xs font-medium text-[#64748B]">Final winners based on recorded ballots.</p>
        </div>
        <label className="flex min-w-56 items-center gap-2">
          <SlidersHorizontal size={15} className="text-[#64748B]" />
          <span className="sr-only">Filter results by position</span>
          <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} className="h-10 flex-1 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0B8ED0]">
            <option value="all">All positions</option>
            {positions.map((position) => <option key={position.id} value={String(position.id)}>{position.title}</option>)}
          </select>
        </label>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Selections', value: totalVotesCast, sub: `${uniqueVoters} complete ballots`, icon: Vote, color: { bg: 'bg-[#E6F6FD]', icon: 'text-[#0B8ED0]', border: 'border-[#0B8ED0]/20' } },
          { label: 'Voter Turnout', value: uniqueVoters, sub: 'Unique voters participated', icon: Award, color: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-200' } },
          { label: 'Positions', value: positions.length, icon: Award, color: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-200' } },
          { label: 'Candidates', value: allCandidates.length, icon: Users, color: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-200' } },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-xl border bg-white p-5 shadow-sm flex items-start gap-4 ${stat.color.border}`}>
            <div className={`p-2.5 rounded-lg ${stat.color.bg}`}>
              <stat.icon size={20} className={stat.color.icon} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#64748B] font-medium uppercase tracking-wide">{stat.label}</p>
              <p className="text-2xl font-black text-[#0F172A] mt-0.5">{stat.value}</p>
              {stat.sub && <p className="text-xs text-[#64748B] mt-1">{stat.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {positionResults.map(({ position, candidates, totalVotes }) => {
          if (candidates.length === 0) {
            return null;
          }

          if (candidates.length === 1) {
            const candidate = candidates[0];
            return (
              <div key={position.id} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs font-bold text-[#64748B] uppercase tracking-wide">{position.title}</span>
                  {position.max_winners > 1 && <span className="text-[10px] text-[#94A3B8]">(Top {position.max_winners})</span>}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Uncontested</span>
                </div>
                <div className="flex items-center gap-4">
                  <Avatar name={candidate.name} size="lg" />
                  <div>
                    <p className="text-lg font-black text-[#0F172A]">{candidate.name}</p>
                    <span className="inline-block px-2 py-0.5 bg-[#F8FBFD] border border-[#DDE7EF] rounded-full text-[10px] font-bold text-slate-600">{candidate.partylist}</span>
                    <p className="text-xs text-[#64748B] mt-1">{candidate.votes} votes</p>
                  </div>
                  <Trophy size={24} className="text-amber-500 ml-auto" />
                </div>
              </div>
            );
          }

          return (
            <div key={position.id} className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#DDE7EF] bg-[#F8FBFD]">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{position.title}</span>
                {position.max_winners > 1 && <span className="text-[10px] text-[#94A3B8]">(Top {position.max_winners})</span>}
                <span className="text-[10px] text-[#94A3B8] ml-auto">{totalVotes} votes cast</span>
              </div>
              <div className="divide-y divide-[#E5EDF3]">
                {candidates.map((candidate, idx) => {
                  const pct = totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0;
                  const isWinner = idx < position.max_winners && candidate.votes > 0;
                  return (
                    <div key={candidate.id} className={`flex items-center gap-4 px-5 py-4 ${isWinner ? 'bg-[#F0FAFF]' : ''}`}>
                      <Avatar name={candidate.name} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-[#0F172A]">{candidate.name}</p>
                          {isWinner && (
                            <span className="flex items-center gap-1 bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full">
                              <Trophy size={9} />
                              WINNER
                            </span>
                          )}
                        </div>
                        <span className="inline-block mt-0.5 mb-1.5 px-2 py-0.5 bg-[#F8FBFD] border border-[#DDE7EF] rounded-full text-[10px] font-bold text-slate-600">{candidate.partylist}</span>
                        <div className="h-1.5 w-full rounded-full bg-[#EEF6FB]">
                          <div
                            className={`h-1.5 rounded-full transition-all ${isWinner ? 'bg-[#0B8ED0]' : 'bg-slate-300'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-black text-[#0F172A] tabular-nums">{candidate.votes}</p>
                        <p className="text-xs text-[#94A3B8]">{pct}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {positionResults.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#DDE7EF] bg-white p-8 text-center text-sm font-medium text-[#64748B]">
            No result data is available for this position yet.
          </div>
        )}
      </div>
    </div>
  );
}
