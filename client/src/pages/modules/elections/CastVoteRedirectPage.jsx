import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import PageHeader from '../../../components/ui/PageHeader';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import StatusBadge from '../../../components/ui/StatusBadge';
import { resultsLink, studentVoteState } from '../../../components/elections/electionFlow';
import { getElectionDetails, getElections } from '../../../services/electionService';
import { closedPeriodParams } from '../../../utils/academicPeriodStore';

const STATE_TONES = { open: 'success', voted: 'info', upcoming: 'warning', filing: 'success', screening: 'info', campaign: 'info', counting: 'neutral', closed: 'neutral', cancelled: 'neutral' };
const STATE_ORDER = { open: 0, filing: 1, screening: 1, campaign: 1, upcoming: 1, voted: 2, counting: 3, closed: 3, cancelled: 4 };

// Phases of an election run through the full process; an election with no phase keeps the cards it always had.
const PHASE_STATES = {
  scheduled: { key: 'upcoming', label: 'Upcoming' },
  filing: { key: 'filing', label: 'Filing' },
  screening: { key: 'screening', label: 'Screening' },
  campaign: { key: 'campaign', label: 'Campaign' },
  canvassing: { key: 'counting', label: 'Counting' },
  tie_resolution: { key: 'counting', label: 'Counting' },
  completed: { key: 'closed', label: 'Closed' },
  cancelled: { key: 'cancelled', label: 'Cancelled' },
};

const MANILA = 'Asia/Manila';

const infoLink = (election) => `/dashboard/elections/election-info?record=${election.id}`;

// What the server recorded for this student: the receipt reference and the time, never the choices.
const receiptOf = (election) => election.my_ballot?.receipt_ref || election.my_votes?.[0]?.vote_hash;
const receiptTimeOf = (election) => election.my_ballot?.submitted_at || election.my_votes?.[0]?.cast_at;
const hasVotedIn = (election) => election.has_voted === true || (election.has_voted === undefined && (election.my_votes ?? []).length > 0);

function cardState(election) {
  if (election.phase === 'voting' || election.phase === 'runoff') {
    if (hasVotedIn(election)) return { key: 'voted', label: 'Voted' };
    return election.open_round === 1 || election.open_round === 2 ? { key: 'open', label: election.phase === 'runoff' ? 'Runoff' : 'Open' } : { key: 'upcoming', label: 'Paused' };
  }
  if (election.phase && PHASE_STATES[election.phase]) return PHASE_STATES[election.phase];
  if (hasVotedIn(election)) return { key: 'voted', label: 'Voted' };
  return studentVoteState(election);
}

// The server refuses a student the details of an election that is not open, or closed with results released.
const studentMayOpen = (election) => Boolean(election.finalized_at) && (election.status === 'active' || (election.status === 'closed' && Boolean(election.results_visible)));

function formatPart(value, options) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: MANILA }).format(new Date(value));
}

const formatDay = (value, withYear) => formatPart(value, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
const formatTime = (value) => formatPart(value, { hour: 'numeric', minute: '2-digit' });

function formatWhen(value) {
  return `${formatDay(value)}, ${formatTime(value)}`;
}

// "Nov 7 to Nov 15, 2026, 7:00 PM" when voting opens and closes at the same time of day, otherwise
// each end carries its own time. Same-day elections read "Nov 7, 2026, 7:00 AM to 5:00 PM".
function formatSchedule(startValue, endValue) {
  if (Number.isNaN(new Date(startValue).getTime()) || Number.isNaN(new Date(endValue).getTime())) return 'Schedule not set';
  const sameDay = formatDay(startValue, true) === formatDay(endValue, true);
  const sameTime = formatTime(startValue) === formatTime(endValue);
  if (sameDay) return `${formatDay(startValue, true)}, ${formatTime(startValue)} to ${formatTime(endValue)}`;
  if (sameTime) return `${formatDay(startValue)} to ${formatDay(endValue, true)}, ${formatTime(startValue)}`;
  return `${formatWhen(startValue)} to ${formatDay(endValue, true)}, ${formatTime(endValue)}`;
}

function ElectionResultsLine({ election, role }) {
  const link = resultsLink(election, role);
  return (
    <p className="mt-3 text-sm text-ink-muted">
      Results:{' '}
      {link.available
        ? <Link to={link.to} className="inline-flex min-h-10 items-center rounded-control font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">{link.label}</Link>
        : <span>{link.text}</span>}
    </p>
  );
}

function WhatNext({ election, state }) {
  if (state.key === 'voted') {
    const votedAt = receiptTimeOf(election);
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-ink-muted">Your ballot receipt</p>
        <p className="mt-1 break-all font-mono text-sm text-ink">{receiptOf(election)}</p>
        {votedAt && !Number.isNaN(new Date(votedAt).getTime()) && <p className="mt-1 text-sm text-ink-muted">{`Submitted ${formatWhen(votedAt)}`}</p>}
      </div>
    );
  }
  if (state.key === 'open') {
    if (election.ballot_refusal) return <p className="mt-3 text-sm text-ink-muted">{election.ballot_refusal}</p>;
    return <Button to={`/elections/${election.id}/vote`} className="mt-3">Vote in this election</Button>;
  }
  if (election.phase) {
    if (election.phase === 'scheduled') return <p className="mt-3 text-sm text-ink-muted">{election.filing_starts_at ? `Filing opens ${formatWhen(election.filing_starts_at)}.` : 'The election dates are not set yet.'}</p>;
    if (election.phase === 'filing') return <Button to={infoLink(election)} className="mt-3">Read the rules and file candidacy</Button>;
    if (election.phase === 'screening' || election.phase === 'campaign') return <Button to={infoLink(election)} variant="secondary" className="mt-3">See the election</Button>;
    if (election.phase === 'voting' || election.phase === 'runoff') return <p className="mt-3 text-sm text-ink-muted">Voting is not open right now.</p>;
    if (election.phase === 'canvassing' || election.phase === 'tie_resolution') return <p className="mt-3 text-sm text-ink-muted">The votes are being counted.</p>;
    if (election.phase === 'cancelled') return <p className="mt-3 text-sm text-ink-muted">This election was cancelled.</p>;
    return null;
  }
  if (state.key === 'upcoming') {
    return <p className="mt-3 text-sm text-ink-muted">{election.finalized_at ? `Voting opens ${formatWhen(election.start_time)}. Come back then to cast your ballot.` : 'The ballot is still being built. Voting opens after the Admin finalizes it.'}</p>;
  }
  return <p className="mt-3 text-sm text-ink-muted">Voting has ended for this election.</p>;
}

export default function CastVoteRedirectPage() {
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role ?? null; } catch {}

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const list = await getElections(closedPeriodParams(role));
        const votable = (Array.isArray(list) ? list : list.data || []).filter((item) => item.status !== 'pending_approval');
        const details = await Promise.allSettled(votable.map((item) => (studentMayOpen(item) ? getElectionDetails(item.id) : null)));
        if (!cancelled) setElections(votable.map((item, index) => (details[index].status === 'fulfilled' ? { ...item, ...details[index].value } : item)));
      } catch (requestError) {
        if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load elections.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [retryKey, role]);

  const cards = elections
    .map((election) => ({ election, state: cardState(election) }))
    .sort((a, b) => STATE_ORDER[a.state.key] - STATE_ORDER[b.state.key]);

  return (
    <div className="space-y-5">
      <PageHeader />
      {loading && <div role="status" aria-label="Loading elections"><SkeletonTable columns={3} rows={3} /><span className="sr-only">Loading elections</span></div>}
      {!loading && error && <ErrorState title="Elections did not load" description={error} onRetry={() => setRetryKey((key) => key + 1)} />}
      {!loading && !error && cards.length === 0 && (
        <EmptyState title="No election is open for voting" description="Elections appear here when the Admin opens one. Check back during the election period." />
      )}
      {!loading && !error && cards.length > 0 && (
        <section aria-label="Elections you can vote in" className="space-y-3">
          {cards.map(({ election, state }) => {
            return (
              <article key={election.id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-ink">{formatDisplayText(election.title)}</h2>
                  <StatusBadge label={state.label} tone={STATE_TONES[state.key]} />
                </div>
                <dl className="mt-2 space-y-1 text-sm text-ink-muted">
                  {election.organization?.name && <div className="flex gap-2"><dt className="sr-only">Organization</dt><dd>{formatDisplayText(election.organization.name)}</dd></div>}
                  <div className="flex gap-2"><dt className="sr-only">Voting period</dt><dd>{formatSchedule(election.start_time, election.end_time)}</dd></div>
                  <div className="flex gap-2"><dt className="sr-only">Room</dt><dd>{election.room || 'Online ballot'}</dd></div>
                </dl>
                <WhatNext election={election} state={state} />
                {(!election.phase || ['voting', 'runoff', 'canvassing', 'tie_resolution', 'completed'].includes(election.phase)) && <ElectionResultsLine election={election} role={role} />}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
