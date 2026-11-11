import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getElectionResults, getElections } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { canViewElectionResults } from '../../../utils/electionAccess';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Field from '../../../components/ui/Field';
import HiusaSelect from '../../../components/ui/Select';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import StatusBadge from '../../../components/ui/StatusBadge';

function CandidatePortrait({ candidate, name, className = 'h-10 w-10' }) {
  if (candidate.image_url) return <img src={resolveAssetUrl(candidate.image_url)} alt={formatDisplayText(name)} className={`${className} shrink-0 rounded-lg border border-line object-cover`} />;
  const initials = name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return <div className={`${className} grid shrink-0 place-items-center rounded-lg bg-navy-800 text-sm font-semibold text-white`}>{initials}</div>;
}

function isWinnerOf(result, candidate) {
  if (Array.isArray(result.winner_ids)) return result.winner_ids.includes(candidate.id);
  return (result.candidates || []).indexOf(candidate) < Number(result.position.max_winners || 1) && candidate.votes > 0;
}

function CandidateCell({ candidate, bold }) {
  return (
    <div className="flex items-center gap-3 text-left">
      <CandidatePortrait candidate={candidate} name={candidate.name} />
      <span className={bold ? 'font-semibold' : 'font-medium'}>{formatDisplayText(candidate.name)}</span>
    </div>
  );
}

const winnerColumns = [
  { key: 'position', header: 'Position', render: (winner) => formatDisplayText(winner.position) },
  { key: 'name', header: 'Winner', render: (winner) => <CandidateCell candidate={winner} bold /> },
  { key: 'partylist', header: 'Party list', render: (winner) => winner.partylist },
  { key: 'votes', header: 'Votes', align: 'right', render: (winner) => winner.votes },
];

export default function ElectionResultsPage() {
  const { election, role, selectElection } = useOutletContext();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
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
  }, [election?.id, resultsAvailable, retryKey]);

  const summary = useMemo(() => ({
    selections: results.reduce((sum, result) => sum + Number(result.totalVotes || 0), 0),
    voters: Number(election?.voters_count || 0),
    winners: isFinal ? results.flatMap((result) => (result.candidates || []).filter((candidate) => isWinnerOf(result, candidate)).map((candidate) => ({ ...candidate, position: result.position.title }))) : [],
    handedOver: results.some((result) => result.access_handed_over),
    ties: results.filter((result) => result.tie),
  }), [results, isFinal, election?.voters_count]);

  if (!election) return <EmptyState title="Election not found" description="Go back and choose an election." />;
  if (!resultsAvailable) return <EmptyState title="Election results are not available yet." description="Turnout appears once the finalized ballot opens. Results appear when the election closes." />;
  if (loading) return <div role="status" aria-label="Loading election results"><SkeletonTable columns={4} rows={5} /><span className="sr-only">Loading election results</span></div>;
  if (error) return <ErrorState title="Results did not load" description={error} onRetry={() => setRetryKey((key) => key + 1)} />;

  const chooseElection = (value) => selectElection?.(availableElections.find((item) => String(item.id) === value)?.id ?? value);

  return (
    <div className="space-y-5">
      {availableElections.length > 1 && (
        <Field label="Election" className="max-w-md">
          <HiusaSelect value={String(election.id)} onChange={(event) => chooseElection(event.target.value)}>
            {availableElections.map((item) => <option key={item.id} value={String(item.id)}>{formatDisplayText(item.title)} ({item.status === 'closed' ? 'final results' : 'voting open'})</option>)}
          </HiusaSelect>
        </Field>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-prose text-sm text-ink-muted-strong">{isFinal ? 'Final results for every position.' : 'Voting is open. Only turnout shows now. Results appear when the election closes.'}</p>
        <dl className="flex gap-8">
          <div><dt className="text-xs text-ink-muted">Ballots</dt><dd className="text-xl font-semibold tabular-nums text-ink">{summary.voters}</dd></div>
          {isFinal && <div><dt className="text-xs text-ink-muted">Votes cast</dt><dd className="text-xl font-semibold tabular-nums text-ink">{summary.selections}</dd></div>}
        </dl>
      </div>

      {isFinal && (summary.handedOver || summary.ties.length > 0) && (
        <section aria-label="Officer access" className="space-y-2 border-t border-line pt-4">
          {summary.handedOver && <div className="flex flex-wrap items-center gap-2"><StatusBadge status="access_handed_over" /><p className="text-sm text-ink-muted">Winners now have access to the organization in their positions. Officers they replaced no longer do.</p></div>}
          {summary.ties.map((result) => <div key={result.position.id} className="flex flex-wrap items-center gap-2"><StatusBadge status="tie" /><p className="text-sm text-ink-muted">{formatDisplayText(result.position.title)} is tied. Give access to the person you choose from People and access.</p></div>)}
        </section>
      )}

      {summary.winners.length > 0 && (
        <section className="border-t border-line pt-4">
          <h2 className="mb-3 text-base font-semibold text-ink">Winners</h2>
          <DataTable caption="Final winners by position" columns={winnerColumns} rows={summary.winners} rowKey={(winner) => `${winner.position}-${winner.id}`} stickyHeader={false} />
        </section>
      )}

      {results.length === 0 && <EmptyState title="No result data yet" description="Results for this election are not available." />}

      {results.map((result) => {
        const { position, candidates, totalVotes } = result;
        const columns = [
          { key: 'name', header: 'Candidate', render: (candidate) => <CandidateCell candidate={candidate} bold={isFinal && isWinnerOf(result, candidate)} /> },
          { key: 'partylist', header: 'Party list', render: (candidate) => candidate.partylist },
          ...(isFinal ? [
            { key: 'votes', header: 'Votes', align: 'right', render: (candidate) => candidate.votes },
            { key: 'share', header: 'Share', align: 'right', render: (candidate) => `${totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0}%` },
          ] : []),
        ];
        return (
          <section key={position.id} className="border-t border-line pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-ink">{formatDisplayText(position.title)}</h2>
                {isFinal && result.tie && <StatusBadge status="tie" />}
              </div>
              {isFinal && <p className="text-sm text-ink-muted"><span className="tabular-nums">{totalVotes}</span> votes cast</p>}
            </div>
            {(candidates || []).length > 0
              ? <DataTable caption={`Results for ${formatDisplayText(position.title)}`} columns={columns} rows={candidates} stickyHeader={false} />
              : <p className="text-sm text-ink-muted">No candidate result data is available.</p>}
          </section>
        );
      })}
    </div>
  );
}
