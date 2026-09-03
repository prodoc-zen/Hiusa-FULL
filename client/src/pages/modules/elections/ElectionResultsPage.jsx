import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Award, BarChart3, Trophy, UsersRound, Vote } from 'lucide-react';
import { getElectionResults } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';

function CandidatePortrait({ candidate, name, className = 'h-12 w-12' }) {
  if (candidate.image_url) return <img src={resolveAssetUrl(candidate.image_url)} alt={name} className={`${className} shrink-0 rounded-lg border border-[#DDE7EF] object-cover`} />;
  const initials = name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return <div className={`${className} grid shrink-0 place-items-center rounded-lg bg-[#0F2F62] text-sm font-black text-white`}>{initials}</div>;
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
      setResults([]); setLoading(false); setError('');
      return () => { cancelled = true; };
    }
    setLoading(true); setError('');
    getElectionResults(election.id)
      .then((data) => { if (!cancelled) setResults(Array.isArray(data) ? data : []); })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load election results.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [election?.id, electionIsClosed]);

  const summary = useMemo(() => {
    const candidates = results.flatMap((result) => result.candidates || []);
    return {
      candidates,
      selections: results.reduce((sum, result) => sum + Number(result.totalVotes || 0), 0),
      voters: results.reduce((highest, result) => Math.max(highest, Number(result.totalVotes || 0)), 0),
      winners: results.flatMap((result) => (result.candidates || []).slice(0, Number(result.position.max_winners || 1)).filter((candidate) => candidate.votes > 0).map((candidate) => ({ ...candidate, position: result.position.title }))),
    };
  }, [results]);

  if (!election) return <div className="py-20 text-center text-sm text-[#64748B]">Election not found.</div>;
  if (!electionIsClosed) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"><Trophy size={36} className="mx-auto text-amber-600" /><h2 className="mt-4 text-xl font-black text-amber-900">Official results are not available yet</h2><p className="mt-2 text-sm font-medium text-amber-800">Final winners and vote totals appear after the election closes.</p></div>;
  if (loading) return <div className="space-y-4" role="status" aria-label="Loading election results"><div className="h-72 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />{[1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />)}<span className="sr-only">Loading election results...</span></div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>;

  const positions = results.map((result) => result.position);
  const positionResults = results.filter(({ position }) => positionFilter === 'all' || String(position.id) === positionFilter);

  return (
    <div className="space-y-5">
      <section className="grid overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm lg:grid-cols-[minmax(300px,.7fr)_minmax(0,1.3fr)]">
        <div className="relative min-h-56 bg-[#0F2F62]">
          {election.image_url ? <img src={resolveAssetUrl(election.image_url)} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/70"><Trophy size={64} strokeWidth={1.5} /></div>}
          <div className="absolute inset-0 bg-[#0B1831]/30" />
          <span className="absolute left-4 top-4 rounded-full border border-white/20 bg-[#0B1831]/80 px-3 py-1.5 text-xs font-bold text-white">Official final results</span>
        </div>
        <div className="p-5 sm:p-7 lg:p-8">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Election concluded</p>
          <h1 className="mt-2 text-2xl font-black leading-tight text-[#0F172A] sm:text-3xl">{election.title}</h1>
          <p className="mt-3 text-sm leading-6 text-[#64748B]">Verified vote totals and declared winners across every ballot position.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[{ label: 'Ballots', value: summary.voters, icon: Vote }, { label: 'Selections', value: summary.selections, icon: BarChart3 }, { label: 'Positions', value: positions.length, icon: Award }, { label: 'Candidates', value: summary.candidates.length, icon: UsersRound }].map((stat) => <div key={stat.label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><stat.icon size={16} className="text-[#0B8ED0]" /><p className="mt-2 text-xl font-black text-[#0F172A]">{stat.value}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">{stat.label}</p></div>)}
          </div>
        </div>
      </section>

      {summary.winners.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2"><Trophy size={18} className="text-amber-500" /><h2 className="text-lg font-black text-[#0F172A]">Winner spotlight</h2></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{summary.winners.map((winner) => <article key={`${winner.position}-${winner.id}`} className="flex items-center gap-4 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"><CandidatePortrait candidate={winner} name={winner.name} className="h-16 w-16" /><div className="min-w-0 flex-1"><span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700"><Trophy size={10} /> WINNER</span><h3 className="mt-1 truncate text-base font-black text-[#0F172A]">{winner.name}</h3><p className="truncate text-xs font-bold text-[#0B8ED0]">{winner.position}</p><p className="mt-1 text-xs text-[#64748B]">{winner.votes} vote{winner.votes === 1 ? '' : 's'} · {winner.partylist}</p></div></article>)}</div>
        </section>
      )}

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-3 shadow-sm">
        <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-widest text-[#64748B]">Filter by position</p>
        <div className="flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => setPositionFilter('all')} className={`h-10 shrink-0 rounded-lg border px-4 text-xs font-bold ${positionFilter === 'all' ? 'border-[#0B8ED0] bg-[#0B8ED0] text-white' : 'border-[#DDE7EF] text-[#64748B] hover:bg-[#F8FBFD]'}`}>All positions</button>{positions.map((position) => <button key={position.id} type="button" onClick={() => setPositionFilter(String(position.id))} className={`h-10 shrink-0 rounded-lg border px-4 text-xs font-bold ${positionFilter === String(position.id) ? 'border-[#0B8ED0] bg-[#0B8ED0] text-white' : 'border-[#DDE7EF] text-[#64748B] hover:bg-[#F8FBFD]'}`}>{position.title}</button>)}</div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {positionResults.map(({ position, candidates, totalVotes }) => (
          <article key={position.id} className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <header className="flex items-start justify-between gap-3 border-b border-[#DDE7EF] bg-[#F8FBFD] p-4"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Ballot position</p><h2 className="mt-1 text-lg font-black text-[#0F172A]">{position.title}</h2></div><div className="text-right"><p className="text-lg font-black text-[#0F172A]">{totalVotes}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Votes cast</p></div></header>
            <div className="divide-y divide-[#E5EDF3]">
              {candidates.map((candidate, index) => {
                const percentage = totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0;
                const isWinner = index < position.max_winners && candidate.votes > 0;
                return (
                  <div key={candidate.id} className={`p-4 ${isWinner ? 'bg-[#F0FAFF]' : ''}`}>
                    <div className="flex items-center gap-3"><CandidatePortrait candidate={candidate} name={candidate.name} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-black text-[#0F172A]">{candidate.name}</h3>{isWinner && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-800"><Trophy size={9} /> WINNER</span>}</div><p className="mt-0.5 truncate text-xs font-semibold text-[#64748B]">{candidate.partylist}</p></div><div className="shrink-0 text-right"><p className="text-lg font-black tabular-nums text-[#0F172A]">{candidate.votes}</p><p className="text-[11px] font-bold text-[#64748B]">{percentage}%</p></div></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E5EDF3]"><div className={`h-full rounded-full ${isWinner ? 'bg-[#0B8ED0]' : 'bg-slate-400'}`} style={{ width: `${percentage}%` }} /></div>
                  </div>
                );
              })}
              {candidates.length === 0 && <div className="p-8 text-center text-sm text-[#64748B]">No candidate result data is available.</div>}
            </div>
          </article>
        ))}
      </section>
      {positionResults.length === 0 && <div className="rounded-xl border border-dashed border-[#DDE7EF] bg-white p-8 text-center text-sm font-medium text-[#64748B]">No result data is available for this position.</div>}
    </div>
  );
}
