import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock3, MapPin, Vote } from 'lucide-react';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import PageHeader from '../../../components/ui/PageHeader';
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
    <p className="mt-3 text-xs font-semibold text-[#64748B]">
      Results:{' '}
      {link.available
        ? <Link to={link.to} className="font-bold text-[#0878B7] hover:underline">{link.label}</Link>
        : <span>{link.text}</span>}
    </p>
  );
}

function WhatNext({ election, state }) {
  if (state.key === 'voted') {
    return (
      <div className="mt-4 rounded-lg bg-[#EEF6FB] p-3">
        <p className="text-xs font-bold text-[#0F2F62]">Your ballot receipt</p>
        <p className="mt-1 break-all font-mono text-xs text-[#0F172A]">{election.my_votes[0].vote_hash}</p>
      </div>
    );
  }
  if (state.key === 'open') {
    return <Button to={`/elections/${election.id}/vote`} className="mt-4">Vote in this election</Button>;
  }
  if (state.key === 'upcoming') {
    return <p className="mt-4 text-sm font-medium text-[#64748B]">{election.finalized_at ? `Voting opens ${formatWhen(election.start_time)}. Come back then to cast your ballot.` : 'The ballot is still being built. Voting opens after the Admin finalizes it.'}</p>;
  }
  return <p className="mt-4 text-sm font-medium text-[#64748B]">Voting has ended for this election.</p>;
}

export default function CastVoteRedirectPage() {
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role ?? null; } catch {}

  useEffect(() => {
    let cancelled = false;
    async function load() {
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
  }, []);

  const cards = elections
    .map((election) => ({ election, state: studentVoteState(election) }))
    .sort((a, b) => STATE_ORDER[a.state.key] - STATE_ORDER[b.state.key]);

  return (
    <div className="space-y-5">
      <PageHeader />
      {loading && <div role="status" className="h-48 animate-pulse rounded-lg border border-[#DDE7EF] bg-white"><span className="sr-only">Loading elections</span></div>}
      {!loading && error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</p>}
      {!loading && !error && cards.length === 0 && (
        <section className="rounded-lg border border-dashed border-[#DDE7EF] bg-white">
          <EmptyState icon={Vote} title="No election is open for voting" description="Elections appear here when the Admin opens one. Check back during the election period." />
        </section>
      )}
      {!loading && !error && cards.length > 0 && (
        <section aria-label="Elections you can vote in" className="grid gap-4 lg:grid-cols-2">
          {cards.map(({ election, state }) => {
            const start = new Date(election.start_time);
            const end = new Date(election.end_time);
            const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
            return (
              <article key={election.id} className="rounded-lg border border-[#DDE7EF] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <Vote size={18} aria-hidden="true" className="text-[#0878B7]" />
                  <StatusBadge label={state.label} tone={STATE_TONES[state.key]} />
                </div>
                <h2 className="mt-2 text-lg font-bold text-[#0F172A]">{formatDisplayText(election.title)}</h2>
                <dl className="mt-4 space-y-2 text-xs text-[#64748B]">
                  <div className="flex gap-2"><CalendarDays size={14} aria-hidden="true" /><dt className="sr-only">Date</dt><dd>{start.toLocaleDateString()}</dd></div>
                  <div className="flex gap-2"><Clock3 size={14} aria-hidden="true" /><dt className="sr-only">Time and duration</dt><dd>{start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} to {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {durationMinutes} minutes</dd></div>
                  <div className="flex gap-2"><MapPin size={14} aria-hidden="true" /><dt className="sr-only">Room</dt><dd>{election.room || 'Online ballot'}</dd></div>
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
