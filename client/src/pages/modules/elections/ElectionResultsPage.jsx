import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getElectionResults, getElections } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { closedPeriodParams } from '../../../utils/academicPeriodStore';
import { canViewElectionResults } from '../../../utils/electionAccess';
import DataTable from '../../../components/ui/DataTable';
import ElectionReportsMenu from '../../../components/elections/ElectionReportsMenu';
import RunoffScheduleForm from '../../../components/elections/RunoffScheduleForm';
import TieResolutionForm from '../../../components/elections/TieResolutionForm';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Field from '../../../components/ui/Field';
import HiusaSelect from '../../../components/ui/Select';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import StatusBadge from '../../../components/ui/StatusBadge';
import { manilaDate } from '../../../lib/format';
import { formatDateTime } from '../../../utils/dateTime';

function CandidatePortrait({ candidate, name, className = 'h-10 w-10' }) {
  if (candidate.image_url) return <img src={resolveAssetUrl(candidate.image_url)} alt={formatDisplayText(name)} className={`${className} shrink-0 rounded-lg border border-line object-cover`} />;
  const initials = name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return <div className={`${className} grid shrink-0 place-items-center rounded-lg bg-navy-800 text-sm font-semibold text-white`}>{initials}</div>;
}

function isWinnerOf(result, candidate) {
  if (Array.isArray(result.winner_ids)) return result.winner_ids.includes(candidate.id);
  return (result.candidates || []).indexOf(candidate) < Number(result.position.max_winners || 1) && candidate.votes > 0;
}

const REPORT_ROLES = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'];

const votesText = (count) => `${count} ${Number(count) === 1 ? 'vote' : 'votes'}`;

// The one status line of a position in a counted election (tally version 2).
function statusLine(result, election) {
  const candidates = result.candidates || [];
  const named = (ids) => candidates.filter((candidate) => (ids || []).includes(candidate.id)).map((candidate) => formatDisplayText(candidate.name));
  switch (result.status) {
    case 'decided': {
      const winners = candidates.filter((candidate) => (result.winner_ids || []).includes(candidate.id));
      return `${winners.length === 1 ? 'Winner' : 'Winners'}: ${winners.map((candidate) => `${formatDisplayText(candidate.name)} (${votesText(candidate.votes)})`).join(', ')}`;
    }
    case 'unopposed': return 'Elected unopposed';
    case 'vacant': return 'Vacant: no candidates';
    case 'runoff_required': return `Runoff required: ${named(result.runoff?.candidate_ids).join(', ')}`;
    case 'runoff_scheduled': return `Runoff scheduled for ${formatDateTime(result.runoff?.starts_at ?? election?.runoff_starts_at)} to ${formatDateTime(result.runoff?.ends_at ?? election?.runoff_ends_at)}`;
    case 'runoff_voting': return 'Runoff voting is open';
    case 'tie_pending': return 'Pending tie resolution by the Department Head';
    case 'resolved': return `Tie resolved by ${formatDisplayText(result.resolution?.resolved_by) || 'the Department Head'}`;
    default: return null;
  }
}

function officerAccessLine(result) {
  if (result.officer_access === 'active') return 'Officer access active';
  if (result.officer_access === 'upcoming') return result.term_starts_on ? `Upcoming officer, access starts ${manilaDate(result.term_starts_on)}` : 'Upcoming officer';
  return null;
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
  const { election, role, selectElection, refreshElection } = useOutletContext();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [availableElections, setAvailableElections] = useState([]);
  const isFinal = election?.status === 'closed';
  const counted = Number(election?.tally_version) >= 2;
  // The reviewer reads a tie that waits for a decision even before the results are published.
  const tieReviewer = ['DEPARTMENT_HEAD', 'SUPER_ADMIN'].includes(role) && isFinal && election?.phase === 'tie_resolution';
  const resultsAvailable = canViewElectionResults(election, role) || tieReviewer;
  const canResolveTie = counted && (role === 'DEPARTMENT_HEAD' || (role === 'SUPER_ADMIN' && election?.approval_required_role === 'SUPER_ADMIN'));

  useEffect(() => {
    let cancelled = false;
    getElections(closedPeriodParams(role)).then((list) => {
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
    ties: counted ? [] : results.filter((result) => result.tie),
  }), [results, isFinal, counted, election?.voters_count]);

  const refresh = () => { setRetryKey((key) => key + 1); refreshElection?.(); };
  const runoffRows = counted ? results.filter((result) => ['runoff_required', 'runoff_scheduled'].includes(result.status)) : [];
  const runoffSchedule = {
    starts_at: election?.runoff_starts_at ?? runoffRows.find((result) => result.runoff?.starts_at)?.runoff.starts_at ?? null,
    ends_at: election?.runoff_ends_at ?? runoffRows.find((result) => result.runoff?.ends_at)?.runoff.ends_at ?? null,
    publish_at: election?.runoff_publish_at ?? runoffRows.find((result) => result.runoff?.publish_at)?.runoff.publish_at ?? null,
  };
  // The server reads a runoff as scheduled only until it starts, so a row in these statuses means it can still be set.
  const showRunoffForm = role === 'ADMIN' && runoffRows.length > 0;

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
        <p className="max-w-prose text-sm text-ink-muted-strong">{isFinal ? 'Final results for every position.' : 'Voting is open. Only turnout shows until the election closes.'}</p>
        <div className="flex flex-wrap items-end gap-6">
          {REPORT_ROLES.includes(role) && <ElectionReportsMenu election={election} role={role} />}
          <dl className="flex gap-8">
            <div><dt className="text-xs text-ink-muted">Ballots</dt><dd className="text-xl font-semibold tabular-nums text-ink">{summary.voters}</dd></div>
            {isFinal && <div><dt className="text-xs text-ink-muted">Votes cast</dt><dd className="text-xl font-semibold tabular-nums text-ink">{summary.selections}</dd></div>}
          </dl>
        </div>
      </div>

      {showRunoffForm && (
        <section aria-label="Runoff schedule" className="space-y-3 border-t border-line pt-4">
          <h2 className="text-base font-semibold text-ink">Runoff schedule</h2>
          <p className="text-sm text-ink-muted-strong">Runoff for {runoffRows.map((result) => formatDisplayText(result.position.title)).join(', ')}. Only the tied candidates are on the runoff ballot.</p>
          <RunoffScheduleForm key={runoffSchedule.starts_at ?? 'new'} electionId={election.id} initial={runoffSchedule.starts_at ? runoffSchedule : null} onScheduled={refresh} />
        </section>
      )}

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
        const showRunoff = counted && (candidates || []).some((candidate) => candidate.runoff_votes !== null && candidate.runoff_votes !== undefined);
        const line = isFinal && counted ? statusLine(result, election) : null;
        const access = isFinal && counted ? officerAccessLine(result) : null;
        const columns = [
          { key: 'name', header: 'Candidate', render: (candidate) => <CandidateCell candidate={candidate} bold={isFinal && isWinnerOf(result, candidate)} /> },
          { key: 'partylist', header: 'Party list', render: (candidate) => candidate.partylist },
          ...(isFinal ? [
            { key: 'votes', header: 'Votes', align: 'right', render: (candidate) => candidate.votes },
            { key: 'share', header: 'Share', align: 'right', render: (candidate) => `${totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0}%` },
            ...(showRunoff ? [{ key: 'runoff_votes', header: 'Runoff votes', align: 'right', render: (candidate) => candidate.runoff_votes ?? '' }] : []),
          ] : []),
        ];
        return (
          <section key={position.id} className="border-t border-line pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-ink">{formatDisplayText(position.title)}</h2>
                {isFinal && !counted && result.tie && <StatusBadge status="tie" />}
              </div>
              {isFinal && <p className="text-sm text-ink-muted"><span className="tabular-nums">{totalVotes}</span> {Number(totalVotes) === 1 ? 'vote' : 'votes'} cast</p>}
            </div>
            {line && <p className="mb-3 text-sm font-medium text-ink">{line}</p>}
            {result.status === 'resolved' && result.resolution && (
              <div className="mb-3 space-y-1 text-sm text-ink-muted-strong">
                {result.resolution.rule_used && <p>Rule used: {result.resolution.rule_used}</p>}
                {result.resolution.explanation && <p>{result.resolution.explanation}</p>}
              </div>
            )}
            {access && <p className="mb-3 text-sm text-ink-muted-strong">{access}</p>}
            {isFinal && canResolveTie && result.status === 'tie_pending' && (
              <div className="mb-4"><TieResolutionForm electionId={election.id} election={election} result={result} onResolved={refresh} /></div>
            )}
            {(candidates || []).length > 0
              ? <DataTable caption={`Results for ${formatDisplayText(position.title)}`} columns={columns} rows={candidates} stickyHeader={false} />
              : (!(counted && result.status === 'vacant') && <p className="text-sm text-ink-muted">No candidate result data is available.</p>)}
          </section>
        );
      })}
    </div>
  );
}
