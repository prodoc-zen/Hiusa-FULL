import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CheckCircle, Plus, Trash2, Vote, X, AlertCircle } from 'lucide-react';
import { createElectionPosition, deleteElectionPosition } from '../../services/electionService';

function Avatar({ name, size = 'sm' }) {
  const initials = name
    .split(' ')
    .map((value) => value[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const colors = ['bg-[#0B8ED0]', 'bg-purple-500', 'bg-emerald-500', 'bg-red-500', 'bg-amber-500', 'bg-indigo-500', 'bg-pink-500'];
  const bg = colors[name.charCodeAt(0) % colors.length];
  const sizeClass = size === 'lg' ? 'w-12 h-12 text-base' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';
  return <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${sizeClass} ${bg}`}>{initials}</div>;
}

export default function ElectionDetailPage() {
  const { election, refreshElection } = useOutletContext();
  const [newPositionTitle, setNewPositionTitle] = useState('');
  const [newPositionMaxWinners, setNewPositionMaxWinners] = useState(1);
  const [localPositions, setLocalPositions] = useState(() => election?.positions || []);
  const [error, setError] = useState('');

  useEffect(() => {
    setLocalPositions(election?.positions || []);
  }, [election]);

  if (!election) {
    return <div className="py-20 text-center text-sm text-slate-500">Election not found.</div>;
  }

  const positions = localPositions;
  const candidates = election.candidates || [];
  const votes = election.votes || [];

  const groupedCandidates = positions.map((position) => ({
    position,
    candidates: candidates.filter((candidate) => candidate.position_id === position.id),
  }));

  const handleAddPosition = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const created = await createElectionPosition(election.id, {
        title: newPositionTitle,
        max_winners: newPositionMaxWinners,
      });
      setLocalPositions((current) => [...current, created]);
      setNewPositionTitle('');
      setNewPositionMaxWinners(1);
      await refreshElection();
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to create election position.');
    }
  };

  const handleRemovePosition = async (positionId) => {
    setError('');

    try {
      await deleteElectionPosition(election.id, positionId);
      setLocalPositions((current) => current.filter((position) => position.id !== positionId));
      await refreshElection();
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || 'Unable to remove election position.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Election Workspace</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">{election.title}</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">{positions.length} positions, {candidates.length} candidates, {votes.length} votes</p>
          </div>
          <form onSubmit={handleAddPosition} className="flex flex-col gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3 sm:flex-row sm:items-end">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">New position</label>
              <input value={newPositionTitle} onChange={(event) => setNewPositionTitle(event.target.value)} className="mt-1 h-10 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" placeholder="e.g. Treasurer" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">Max winners</label>
              <input type="number" min="1" value={newPositionMaxWinners} onChange={(event) => setNewPositionMaxWinners(Number(event.target.value))} className="mt-1 h-10 w-28 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
            </div>
            <button type="submit" className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7]">Add Position</button>
          </form>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      )}

      <div className="space-y-4">
        {groupedCandidates.map(({ position, candidates: positionCandidates }) => (
          <div key={position.id} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">{position.title}</h3>
                <p className="text-sm text-slate-500">Up to {position.max_winners} winner{position.max_winners > 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#EEF6FB] px-3 py-1 text-xs font-bold text-[#0B8ED0]">{positionCandidates.length} candidates</span>
                <button
                  type="button"
                  onClick={() => handleRemovePosition(position.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100"
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {positionCandidates.map((candidate) => {
                const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim();
                return (
                  <div key={candidate.id} className="flex items-center justify-between rounded-lg bg-[#F8FBFD] px-4 py-3">
                    <div>
                      <p className="font-semibold text-[#0F172A]">{name}</p>
                      <p className="text-xs text-slate-500">{candidate.partylist?.name || 'Independent'}</p>
                    </div>
                    <span className="text-xs font-bold text-[#0B8ED0]">{votes.filter((vote) => vote.candidate_id === candidate.id).length} votes</span>
                  </div>
                );
              })}
              {positionCandidates.length === 0 && <p className="text-sm text-slate-500">No candidates for this position.</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
