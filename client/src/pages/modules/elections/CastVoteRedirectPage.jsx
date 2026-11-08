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

const STATE_TONES = { open: 'success', voted: 'info', upcoming: 'warning', closed: 'neutral' };
const STATE_ORDER = { open: 0, upcoming: 1, voted: 2, closed: 3 };

function formatWhen(value) {
  return new Date(value).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-ink-muted">Your ballot receipt</p>
        <p className="mt-1 break-all font-mono text-sm text-ink">{election.my_votes[0].vote_hash}</p>
      </div>
    );
  }
  if (state.key === 'open') {
    return <Button to={`/elections/${election.id}/vote`} className="mt-3">Vote in this election</Button>;
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
        const list = await getElections();
        const votable = (Array.isArray(list) ? list : list.data || []).filter((item) => item.status !== 'pending_approval');
        const details = await Promise.allSettled(votable.map((item) => getElectionDetails(item.id)));
        if (!cancelled) setElections(votable.map((item, index) => (details[index].status === 'fulfilled' ? { ...item, ...details[index].value } : item)));
      } catch (requestError) {
        if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load elections.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [retryKey]);

  const cards = elections
    .map((election) => ({ election, state: studentVoteState(election) }))
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
            const start = new Date(election.start_time);
            const end = new Date(election.end_time);
            const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
            return (
              <article key={election.id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-ink">{formatDisplayText(election.title)}</h2>
                  <StatusBadge label={state.label} tone={STATE_TONES[state.key]} />
                </div>
                <dl className="mt-2 space-y-1 text-sm text-ink-muted">
                  <div className="flex gap-2"><dt className="sr-only">Date</dt><dd>{start.toLocaleDateString()}</dd></div>
                  <div className="flex gap-2"><dt className="sr-only">Time and duration</dt><dd>{start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, {durationMinutes} minutes</dd></div>
                  <div className="flex gap-2"><dt className="sr-only">Room</dt><dd>{election.room || 'Online ballot'}</dd></div>
                </dl>
                <WhatNext election={election} state={state} />
                <ElectionResultsLine election={election} role={role} />
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
