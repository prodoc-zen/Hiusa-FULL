import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Award, BarChart3, Trophy, UsersRound, Vote } from 'lucide-react';
import { getElectionResults, getElections } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { canViewElectionResults } from '../../../utils/electionAccess';
import StatusBadge from '../../../components/ui/StatusBadge';

function CandidatePortrait({ candidate, name, className = 'h-12 w-12' }) {
  if (candidate.image_url) return <img src={resolveAssetUrl(candidate.image_url)} alt={formatDisplayText(name)} className={`${className} shrink-0 rounded-lg border border-line object-cover`} />;
  const initials = name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return <div className={`${className} grid shrink-0 place-items-center rounded-lg bg-navy-800 text-sm font-semibold text-white`}>{initials}</div>;
}

function isWinnerOf(result, candidate) {
  if (Array.isArray(result.winner_ids)) return result.winner_ids.includes(candidate.id);
  return (result.candidates || []).indexOf(candidate) < Number(result.position.max_winners || 1) && candidate.votes > 0;
}

export default function ElectionResultsPage() {
  const { election, role, selectElection } = useOutletContext();
  const [positionFilter, setPositionFilter] = useState('all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availableElections, setAvailableElections] = useState([]);
  const resultsAvailable = canViewElectionResults(election, role);
  const isFinal = election?.status === 'closed';

  useEffect(() => {
    let cancelled = false;
    getElections().then((list) => {
      if (!cancelled) setAvailableElections((Array.isArray(list) ? list : list.data || []).filter((item) => canViewElectionResults(item, role)));
    }).catch(() => { if (!cancelled) setAvailableElections([]); });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    let cancelled = false;
    if (!election?.id || !resultsAvailable) {
      setResults([]); setLoading(false); setError('');
      return () => { cancelled = true; };
    }
    setLoading(true); setError('');
    getElectionResults(election.id)
      .then((data) => { if (!cancelled) setResults(Array.isArray(data) ? data : []); })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load election results.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [election?.id, resultsAvailable]);

  const summary = useMemo(() => {
    const candidates = results.flatMap((result) => result.candidates || []);
    return {
      candidates,
      selections: results.reduce((sum, result) => sum + Number(result.totalVotes || 0), 0),
      voters: Number(election?.voters_count || 0),
      winners: isFinal ? results.flatMap((result) => (result.candidates || []).filter((candidate) => isWinnerOf(result, candidate)).map((candidate) => ({ ...candidate, position: result.position.title }))) : [],
      handedOver: results.some((result) => result.access_handed_over),
      ties: results.filter((result) => result.tie),
    };
  }, [results, isFinal, election?.voters_count]);

  if (!election) return <div className="py-20 text-center text-sm text-ink-muted">Election not found.</div>;
  if (!resultsAvailable) return <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center"><Trophy size={36} className="mx-auto text-amber-600" /><h2 className="mt-4 text-xl font-semibold text-amber-900">Election results are not available yet.</h2><p className="mt-2 text-sm font-medium text-amber-800">Vote totals appear once the finalized ballot opens. Winners are declared after closing.</p></div>;
  if (loading) return <div className="space-y-4" role="status" aria-label="Loading election results"><div className="h-72 animate-pulse rounded-lg border border-line bg-slate-100" />{[1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-lg border border-line bg-slate-100" />)}<span className="sr-only">Loading election results...</span></div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>;

  const positions = results.map((result) => result.position);
  const positionResults = results.filter(({ position }) => positionFilter === 'all' || String(position.id) === positionFilter);

  return (
    <div className="space-y-5">
      {availableElections.length > 1 && <section aria-label="Choose election results"><h2 className="mb-3 text-sm font-bold text-ink">Available results</h2><div className="grid gap-3 sm:grid-cols-2">{availableElections.map((item) => <button key={item.id} type="button" onClick={() => selectElection?.(item.id)} aria-current={item.id === election.id ? 'true' : undefined} className={`rounded-lg border p-4 text-left ${item.id === election.id ? 'border-brand-600 bg-page' : 'border-line bg-white hover:border-brand-600'}`}><span className="text-xs font-bold text-brand-700">{item.status === 'closed' ? 'Final results' : 'Live totals'}</span><p className="mt-1 text-sm font-bold text-ink">{formatDisplayText(item.title)}</p><p className="mt-1 text-xs text-ink-muted">{new Date(item.start_time).toLocaleString()} – {new Date(item.end_time).toLocaleString()}</p><p className="mt-1 text-xs text-ink-muted">{item.room || 'Online ballot'} · {Math.round((new Date(item.end_time) - new Date(item.start_time)) / 60000)} minutes</p></button>)}</div></section>}
      <section className="grid overflow-hidden rounded-lg border border-line bg-white shadow-sm lg:grid-cols-[minmax(300px,.7fr)_minmax(0,1.3fr)]">
        <div className="relative min-h-56 bg-navy-800">
          {election.image_url ? <img src={resolveAssetUrl(election.image_url)} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/70"><Trophy size={64} strokeWidth={1.5} /></div>}
          <div className="absolute inset-0 bg-navy-950/30" />
          <span className="absolute left-4 top-4 rounded-full border border-white/20 bg-navy-950/80 px-3 py-1.5 text-xs font-bold text-white">{isFinal ? 'Official final results' : 'Live vote totals'}</span>
        </div>
        <div className="p-5 sm:p-7 lg:p-8">
          <p className="text-xs font-bold text-brand-700">{isFinal ? 'Election concluded' : 'Voting in progress'}</p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-ink sm:text-3xl">{formatDisplayText(election.title)}</h2>
          <p className="mt-3 text-sm leading-6 text-ink-muted">{isFinal ? 'Verified vote totals and declared winners across every ballot position.' : 'Vote totals update while voting is open. Winners will be declared after closing.'}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[{ label: 'Ballots', value: summary.voters, icon: Vote }, { label: 'Selections', value: summary.selections, icon: BarChart3 }, { label: 'Positions', value: positions.length, icon: Award }, { label: 'Candidates', value: summary.candidates.length, icon: UsersRound }].map((stat) => <div key={stat.label} className="rounded-lg border border-line bg-subtle p-3"><stat.icon size={16} className="text-brand-700" /><p className="mt-2 text-xl font-semibold text-ink">{stat.value}</p><p className="text-xs font-bold text-ink-muted">{stat.label}</p></div>)}
          </div>
        </div>
      </section>

      {isFinal && (summary.handedOver || summary.ties.length > 0) && (
        <section aria-label="Officer access" className="space-y-2 rounded-lg border border-line bg-white p-4 shadow-sm">
          {summary.handedOver && <div className="flex flex-wrap items-center gap-2"><StatusBadge status="access_handed_over" /><p className="text-sm text-ink-muted">Winners now have access to the organization in their positions. Officers they replaced no longer do.</p></div>}
          {summary.ties.map((result) => <div key={result.position.id} className="flex flex-wrap items-center gap-2"><StatusBadge status="tie" /><p className="text-sm text-ink-muted">{formatDisplayText(result.position.title)} is tied. Give access to the person you choose from People and access.</p></div>)}
        </section>
      )}

      {summary.winners.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2"><Trophy size={18} className="text-amber-500" /><h2 className="text-lg font-semibold text-ink">Winner spotlight</h2></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{summary.winners.map((winner) => <article key={`${winner.position}-${winner.id}`} className="flex items-center gap-4 rounded-lg border border-amber-200 bg-white p-4 shadow-sm"><CandidatePortrait candidate={winner} name={winner.name} className="h-16 w-16" /><div className="min-w-0 flex-1"><span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><Trophy size={10} /> WINNER</span><h3 className="mt-1 truncate text-base font-semibold text-ink">{formatDisplayText(winner.name)}</h3><p className="truncate text-xs font-bold text-brand-700">{winner.position}</p><p className="mt-1 text-xs text-ink-muted">{winner.votes} vote{winner.votes === 1 ? '' : 's'} · {winner.partylist}</p></div></article>)}</div>
        </section>
      )}

      <section className="rounded-lg border border-line bg-white p-3 shadow-sm">
        <p className="px-2 pb-2 text-xs font-bold text-ink-muted">Filter by position</p>
        <div className="flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => setPositionFilter('all')} className={`h-10 shrink-0 rounded-lg border px-4 text-xs font-bold ${positionFilter === 'all' ? 'border-brand-600 bg-brand-700 text-white' : 'border-line text-ink-muted hover:bg-subtle'}`}>All positions</button>{positions.map((position) => <button key={position.id} type="button" onClick={() => setPositionFilter(String(position.id))} className={`h-10 shrink-0 rounded-lg border px-4 text-xs font-bold ${positionFilter === String(position.id) ? 'border-brand-600 bg-brand-700 text-white' : 'border-line text-ink-muted hover:bg-subtle'}`}>{formatDisplayText(position.title)}</button>)}</div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {positionResults.map((result) => { const { position, candidates, totalVotes } = result; return (
          <article key={position.id} className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
            <header className="flex items-start justify-between gap-3 border-b border-line bg-subtle p-4"><div><p className="text-xs font-bold text-brand-700">Ballot position</p><h2 className="mt-1 text-lg font-semibold text-ink">{formatDisplayText(position.title)}</h2>{isFinal && result.tie && <div className="mt-2"><StatusBadge status="tie" /></div>}</div><div className="text-right"><p className="text-lg font-semibold text-ink">{totalVotes}</p><p className="text-xs font-bold text-ink-muted">Votes cast</p></div></header>
            {candidates.length > 1 && <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line bg-page p-4 text-center">{candidates.slice(0, 2).map((candidate, index) => <div key={candidate.id} className={index === 1 ? 'order-3' : ''}><CandidatePortrait candidate={candidate} name={candidate.name} className="mx-auto h-14 w-14" /><p className="mt-2 truncate text-xs font-bold text-ink">{formatDisplayText(candidate.name)}</p><p className="text-xs font-semibold text-brand-700">{totalVotes ? Math.round(candidate.votes / totalVotes * 100) : 0}% · {candidate.votes} votes</p></div>)}<span className="order-2 rounded-full border border-line bg-white px-2 py-1 text-xs font-semibold text-navy-800">VS</span></div>}
            <div className="divide-y divide-line">
              {candidates.map((candidate) => {
                const percentage = totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0;
                const isWinner = isFinal && isWinnerOf(result, candidate);
                return (
                  <div key={candidate.id} className={`p-4 ${isWinner ? 'bg-subtle' : ''}`}>
                    <div className="flex items-center gap-3"><CandidatePortrait candidate={candidate} name={candidate.name} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-ink">{formatDisplayText(candidate.name)}</h3>{isWinner && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"><Trophy size={9} /> WINNER</span>}</div><p className="mt-0.5 truncate text-xs font-semibold text-ink-muted">{candidate.partylist}</p></div><div className="shrink-0 text-right"><p className="text-lg font-semibold tabular-nums text-ink">{candidate.votes}</p><p className="text-xs font-bold text-ink-muted">{percentage}%</p></div></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${isWinner ? 'bg-brand-700' : 'bg-slate-400'}`} style={{ width: `${percentage}%` }} /></div>
                  </div>
                );
              })}
              {candidates.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">No candidate result data is available.</div>}
            </div>
          </article>
        ); })}
      </section>
      {positionResults.length === 0 && <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center text-sm font-medium text-ink-muted">No result data is available for this position.</div>}
    </div>
  );
}
