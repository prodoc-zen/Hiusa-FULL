import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock3, MapPin, Vote } from 'lucide-react';
import { isVotingOpen } from '../../../utils/electionAccess';
import { getElectionDetails, getElections } from '../../../services/electionService';

export default function CastVoteRedirectPage() {
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await getElections();
        const active = (Array.isArray(list) ? list : list.data || []).filter(isVotingOpen);
        const details = await Promise.all(active.map((item) => getElectionDetails(item.id)));
        if (!cancelled) setElections(details);
      } catch (requestError) {
        if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load active elections.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div role="status" className="h-48 animate-pulse rounded-lg border border-[#DDE7EF] bg-white"><span className="sr-only">Loading active elections</span></div>;
  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</p>;
  if (elections.length === 0) return <div className="relative overflow-hidden rounded-lg border border-[#DDE7EF] bg-white p-8 text-center"><div aria-hidden="true" className="pointer-events-none space-y-3 opacity-30 blur-sm"><div className="h-8 rounded-lg bg-[#DDE7EF]" /><div className="h-24 rounded-lg bg-[#EEF6FB]" /></div><div className="absolute inset-0 grid place-items-center bg-white/65 p-4"><div><h2 className="text-lg font-black text-[#0F172A]">No active election</h2><p className="mt-2 text-sm text-[#64748B]">Voting becomes available during an approved election period.</p></div></div></div>;

  return <section className="mx-auto max-w-6xl"><h1 className="text-xl font-bold text-[#0F172A]">Active elections</h1><p className="mt-1 text-sm text-[#64748B]">Choose an election to vote or check your ballot receipt.</p><div className="mt-5 grid gap-4 lg:grid-cols-2">{elections.map((election) => {
    const votes = election.my_votes || [];
    const start = new Date(election.start_time);
    const end = new Date(election.end_time);
    const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
    return <article key={election.id} className="rounded-lg border border-[#DDE7EF] bg-white p-5"><div className="flex items-center gap-2 text-[#0878B7]"><Vote size={18} /><span className="text-xs font-semibold">{votes.length ? 'Ballot recorded' : 'Voting open'}</span></div><h2 className="mt-2 text-lg font-bold text-[#0F172A]">{formatDisplayText(election.title)}</h2><dl className="mt-4 space-y-2 text-xs text-[#64748B]"><div className="flex gap-2"><CalendarDays size={14} /><dt className="sr-only">Date</dt><dd>{start.toLocaleDateString()}</dd></div><div className="flex gap-2"><Clock3 size={14} /><dt className="sr-only">Time and duration</dt><dd>{start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {durationMinutes} minutes</dd></div><div className="flex gap-2"><MapPin size={14} /><dt className="sr-only">Room</dt><dd>{election.room || 'Online ballot'}</dd></div></dl>{votes.length ? <div className="mt-4 rounded-lg bg-[#EEF6FB] p-3"><p className="text-xs font-bold text-[#0F2F62]">Your ballot receipt</p><p className="mt-1 break-all font-mono text-xs text-[#0F172A]">{votes[0].vote_hash}</p></div> : <Link to={`/elections/${election.id}/vote`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white hover:bg-[#0F2F62]">Vote in this election</Link>}</article>;
  })}</div></section>;
}
