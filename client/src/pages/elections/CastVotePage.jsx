import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Check, CheckCircle, ChevronLeft, ChevronRight, Eye, ShieldCheck, Vote } from 'lucide-react';
import { castVotes } from '../../services/electionService';

function Avatar({ name, size = 'sm' }) {
  const safeName = name || 'Candidate';
  const initials = safeName
    .split(' ')
    .map((value) => value[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const colors = ['bg-[#0B8ED0]', 'bg-purple-500', 'bg-emerald-500', 'bg-red-500', 'bg-amber-500', 'bg-indigo-500', 'bg-pink-500'];
  const bg = colors[safeName.charCodeAt(0) % colors.length];
  const sizeClass = size === 'lg' ? 'w-12 h-12 text-base' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';

  return <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${sizeClass} ${bg}`}>{initials}</div>;
}

export default function CastVotePage() {
  const { election, refreshElection } = useOutletContext();
  const [phase, setPhase] = useState('preview');
  const [votes, setVotes] = useState({});
  const [positionIndex, setPositionIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState('');

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);

  if (!election) {
    return <div className="py-20 text-center text-sm text-slate-500">Election not found.</div>;
  }

  const groupedPositions = (election.positions || [])
    .map((position) => ({
      position,
      candidates: (election.candidates || []).filter((candidate) => candidate.position_id === position.id),
    }))
    .filter((entry) => entry.candidates.length > 0);

  const currentPosition = groupedPositions[positionIndex];
  // my_votes contains only the current student's own votes (server strips other voters' identities)
  const currentUserVotes = election.my_votes || (election.votes || []).filter((vote) => vote.voter_id === currentUser?.id);
  const hasVoted = currentUserVotes.length > 0;
  const allSelected = groupedPositions.length > 0 && groupedPositions.every((entry) => votes[entry.position.id]);

  if (election.status !== 'active') {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm text-center">
        <h2 className="text-xl font-black text-slate-900">Voting Is Closed</h2>
        <p className="text-sm text-slate-500 mt-2">This election is currently not accepting votes.</p>
      </div>
    );
  }

  if (hasVoted || phase === 'submitted') {
    const selectedByPosition = (election.positions || []).map((position) => {
      const vote = currentUserVotes.find((entry) => entry.position_id === position.id);
      const candidate = (election.candidates || []).find((entry) => entry.id === vote?.candidate_id);
      return {
        position: position.title,
        candidateName: candidate ? `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() : 'Abstained',
      };
    });

    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
        <div className="text-center py-5">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-4 border border-emerald-200">
            <CheckCircle size={32} />
          </div>
          <h2 className="text-xl font-black text-slate-900">Ballot Submitted</h2>
          <p className="text-sm text-slate-500 mt-1.5">Your vote has been securely recorded for this election.</p>
        </div>
        <div className="my-5 rounded-lg border border-slate-200 bg-[#F8FBFD] p-4 text-center">
          <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Ballot Receipt Hash</p>
          <p className="text-lg font-mono font-black text-[#0B8ED0] mt-1 select-all">{receipt || currentUserVotes[0]?.vote_hash || 'CAST-SUCCESSFUL'}</p>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-800 border-b border-[#DDE7EF] pb-2">Your Selections</h3>
          {selectedByPosition.map((entry) => (
            <div key={entry.position} className="flex items-center justify-between rounded-lg bg-[#F8FBFD] px-4 py-3 text-sm">
              <p className="font-semibold text-[#0F172A]">{entry.position}</p>
              <p className="text-xs font-bold text-[#0B8ED0]">{entry.candidateName}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'preview') {
    return (
      <div className="max-w-2xl mx-auto space-y-5 px-4 sm:px-0">
        <div className="bg-white rounded-xl border border-[#DDE7EF] shadow-sm p-6">
          <h2 className="text-base font-extrabold text-slate-800">Live Standings</h2>
          <p className="text-xs text-slate-500 mt-1">{Object.values(election.vote_counts || {}).reduce((s, c) => s + c, 0) || (election.votes || []).length} votes counted · {groupedPositions.length} positions</p>
        </div>

        {groupedPositions.map((entry) => {
          const getVoteCount = (candidateId) => election.vote_counts
            ? (election.vote_counts[candidateId] || 0)
            : (election.votes || []).filter((v) => v.candidate_id === candidateId).length;
          const totalVotes = entry.candidates.reduce((sum, c) => sum + getVoteCount(c.id), 0);

          return (
            <div key={entry.position.id} className="bg-white rounded-xl border border-[#DDE7EF] shadow-sm p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3">{entry.position.title}</h3>
              <div className="space-y-3">
                {entry.candidates
                  .map((candidate) => {
                    const votesCount = getVoteCount(candidate.id);
                    const pct = totalVotes > 0 ? Math.round((votesCount / totalVotes) * 100) : 0;
                    const candidateName = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim();
                    return { candidate, candidateName, votesCount, pct };
                  })
                  .sort((a, b) => b.votesCount - a.votesCount)
                  .map(({ candidate, candidateName, votesCount, pct }) => (
                    <div key={candidate.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          {candidate.image_url
                            ? <img src={candidate.image_url} alt={candidateName} className="h-7 w-7 shrink-0 rounded-full object-cover border border-[#DDE7EF]" />
                            : <Avatar name={candidateName || 'Candidate'} size="sm" />
                          }
                          <div>
                            <p className="text-xs font-bold text-slate-800">{candidateName}</p>
                            <p className="text-[10px] text-slate-500">{candidate.partylist?.name || 'Independent'}</p>
                          </div>
                        </div>
                        <p className="text-xs font-bold text-[#0B8ED0]">{votesCount} · {pct}%</p>
                      </div>
                      <div className="w-full bg-blue-100 rounded-full h-2.5">
                        <div className="h-2.5 rounded-full bg-[#0B8ED0]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setPositionIndex(0);
            setPhase('voting');
          }}
          className="w-full bg-[#0B8ED0] text-white font-bold py-3 rounded-xl hover:bg-[#0878B7] transition text-sm flex items-center justify-center gap-2"
        >
          <Vote size={15} />
          Proceed To Vote
        </button>
      </div>
    );
  }

  if (phase === 'review') {
    const missing = groupedPositions.filter((entry) => !votes[entry.position.id]);

    return (
      <div className="max-w-lg mx-auto space-y-4 px-4 sm:px-0">
        <div className="bg-white rounded-xl border border-[#DDE7EF] shadow-sm p-5">
          <h2 className="text-base font-extrabold text-slate-800 mb-1">Review Your Ballot</h2>
          <p className="text-xs text-slate-500 mb-4">You cannot edit your vote after submission.</p>

          {missing.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 font-medium">Please complete all positions before final submission.</p>
            </div>
          )}

          <div className="space-y-3">
            {groupedPositions.map((entry) => {
              const candidate = entry.candidates.find((item) => item.id === votes[entry.position.id]);
              const candidateName = candidate ? `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() : 'Not selected';

              return (
                <div key={entry.position.id} className={`p-3 rounded-xl border ${candidate ? 'border-blue-100 bg-blue-50/30' : 'border-red-200 bg-red-50/30'}`}>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{entry.position.title}</p>
                  <p className="text-sm font-semibold text-slate-800">{candidateName}</p>
                </div>
              );
            })}
          </div>
        </div>

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{submitError}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setPositionIndex(0);
              setPhase('voting');
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-[#DDE7EF] text-slate-700 font-semibold text-sm rounded-lg hover:bg-[#F8FBFD] transition"
          >
            <ChevronLeft size={15} />
            Edit
          </button>
          <button
            type="button"
            disabled={!allSelected || submitting}
            onClick={async () => {
              setSubmitError('');
              setSubmitting(true);

              try {
                const ballot = groupedPositions.map((entry) => ({
                  position_id: entry.position.id,
                  candidate_id: votes[entry.position.id],
                }));

                const response = await castVotes(election.id, ballot);
                setReceipt(response.receipt || 'CAST-SUCCESSFUL');
                setPhase('submitted');
                refreshElection().catch(() => {});
              } catch (error) {
                const backendMessage = String(error?.response?.data?.message || '');
                if (/already voted/i.test(backendMessage)) {
                  setSubmitError("You've already voted for this position.");
                } else {
                  setSubmitError(backendMessage || 'Unable to submit ballot.');
                }
              } finally {
                setSubmitting(false);
              }
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white font-bold py-2.5 rounded-lg hover:bg-emerald-700 transition text-sm disabled:opacity-50"
          >
            <ShieldCheck size={15} />
            Submit Final Ballot
          </button>
        </div>
      </div>
    );
  }

  if (!currentPosition) {
    return <div className="text-center py-20 text-sm text-slate-500">No candidates are available for this election yet.</div>;
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-0">
      <div className="bg-white rounded-xl border border-[#DDE7EF] shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-slate-500">{election.title}</p>
          <p className="text-xs text-slate-400">Position {positionIndex + 1} of {groupedPositions.length}</p>
        </div>

        <div className="flex gap-1.5 mb-4">
          {groupedPositions.map((entry, index) => (
            <button
              key={entry.position.id}
              type="button"
              onClick={() => setPositionIndex(index)}
              className={`h-2 rounded-full flex-1 transition-all ${index === positionIndex ? 'bg-[#0B8ED0]' : votes[entry.position.id] ? 'bg-emerald-400' : 'bg-blue-100'}`}
            />
          ))}
        </div>

        <h2 className="text-lg font-extrabold text-slate-800 mb-0.5">Vote for {currentPosition.position.title}</h2>
        <p className="text-xs text-slate-500 mb-5">Select one candidate for this position.</p>

        {errors[currentPosition.position.id] && (
          <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-600 font-medium">Please select a candidate before continuing.</p>
          </div>
        )}

        <div className="space-y-3">
          {currentPosition.candidates.map((candidate) => {
            const selected = votes[currentPosition.position.id] === candidate.id;
            const candidateName = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim();

            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => {
                  setVotes((current) => ({ ...current, [currentPosition.position.id]: candidate.id }));
                  setErrors((current) => ({ ...current, [currentPosition.position.id]: false }));
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${selected ? 'border-[#0B8ED0] bg-blue-50 shadow-md' : 'border-[#DDE7EF] bg-white hover:border-[#0B8ED0]/40'}`}
              >
                {candidate.image_url
                  ? <img src={candidate.image_url} alt={candidateName} className="h-11 w-11 shrink-0 rounded-full object-cover border border-[#DDE7EF]" />
                  : <Avatar name={candidateName || 'Candidate'} size="md" />
                }
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800">{candidateName}</p>
                  <p className="text-xs text-slate-500">{candidate.partylist?.name || 'Independent'}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-[#0B8ED0] bg-[#0B8ED0]' : 'border-slate-300'}`}>
                  {selected && <Check size={11} className="text-white" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        {positionIndex > 0 ? (
          <button
            type="button"
            onClick={() => setPositionIndex((index) => index - 1)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-[#DDE7EF] text-slate-700 font-semibold text-sm rounded-lg hover:bg-[#F8FBFD] transition"
          >
            <ChevronLeft size={15} />
            Previous
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPhase('preview')}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-[#DDE7EF] text-slate-700 font-semibold text-sm rounded-lg hover:bg-[#F8FBFD] transition"
          >
            <ChevronLeft size={15} />
            Live Standings
          </button>
        )}

        {positionIndex < groupedPositions.length - 1 ? (
          <button
            type="button"
            onClick={() => {
              if (!votes[currentPosition.position.id]) {
                setErrors((current) => ({ ...current, [currentPosition.position.id]: true }));
                return;
              }

              setPositionIndex((index) => index + 1);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#0B8ED0] text-white font-bold py-2.5 rounded-lg hover:bg-[#0878B7] transition text-sm"
          >
            Next Position
            <ChevronRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!votes[currentPosition.position.id]) {
                setErrors((current) => ({ ...current, [currentPosition.position.id]: true }));
                return;
              }
              setPhase('review');
            }}
            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 text-white font-bold py-2.5 rounded-lg hover:bg-emerald-700 transition text-sm"
          >
            <Eye size={15} />
            Review Ballot
          </button>
        )}
      </div>
    </div>
  );
}
