import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CirclePlus, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import { createElectionPosition, deleteElectionPosition } from '../../../services/electionService';

export default function ElectionDetailPage() {
  const { election, refreshElection } = useOutletContext();
  const [newPositionTitle, setNewPositionTitle] = useState('');
  const [newPositionMaxWinners, setNewPositionMaxWinners] = useState(1);
  const [localPositions, setLocalPositions] = useState(() => election?.positions || []);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  useEffect(() => {
    setLocalPositions(election?.positions || []);
  }, [election]);

  if (!election) {
    return <div className="py-20 text-center text-sm text-slate-500">Election not found.</div>;
  }

  const positions = localPositions;
  const candidates = election.candidates || [];
  const votes = election.votes || [];
  const ballotLocked = votes.length > 0;

  const groupedCandidates = positions.map((position) => ({
    position,
    candidates: candidates.filter((candidate) => candidate.position_id === position.id),
  }));

  const openAddPosition = () => {
    setNewPositionTitle('');
    setNewPositionMaxWinners(1);
    setModalError('');
    setShowAddPosition(true);
  };

  const closeAddPosition = () => {
    if (busy) return;
    setShowAddPosition(false);
    setModalError('');
  };

  const handleAddPosition = async (event) => {
    event.preventDefault();
    setModalError('');
    setBusy(true);

    try {
      const created = await createElectionPosition(election.id, {
        title: newPositionTitle,
        max_winners: newPositionMaxWinners,
      });
      setLocalPositions((current) => [...current, created]);
      setShowAddPosition(false);
      setNewPositionTitle('');
      setNewPositionMaxWinners(1);
      await refreshElection();
      setFeedback({ open: true, type: 'success', message: 'Election position added.' });
    } catch (createError) {
      setModalError(createError?.response?.data?.message || 'Unable to create election position.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePosition = async () => {
    if (!deleteTarget) return;

    setError('');
    setBusy(true);

    try {
      await deleteElectionPosition(election.id, deleteTarget.id);
      setLocalPositions((current) => current.filter((position) => position.id !== deleteTarget.id));
      setFeedback({ open: true, type: 'success', message: `${deleteTarget.title} removed.` });
      setDeleteTarget(null);
      await refreshElection();
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || 'Unable to remove election position.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Election Workspace</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">{election.title}</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">{positions.length} positions, {candidates.length} candidates, {votes.length} votes</p>
          </div>
          {!ballotLocked && (
            <button
              type="button"
              onClick={openAddPosition}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white transition hover:bg-[#0878B7]"
            >
              <CirclePlus size={15} />
              Add Position
            </button>
          )}
        </div>
      </section>

      {ballotLocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Position setup is locked because votes have already been cast.
        </div>
      )}

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
                {!ballotLocked && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(position)}
                    className="inline-flex items-center gap-1 rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                )}
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

      <Modal
        open={showAddPosition}
        title="Add Election Position"
        description="Create a new position for this election ballot."
        onClose={closeAddPosition}
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        maxWidth="max-w-lg"
        footer={(
          <>
            <button type="button" onClick={closeAddPosition} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">Cancel</button>
            <button type="submit" form="add-position-form" disabled={busy || !newPositionTitle.trim()} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">{busy ? 'Adding...' : 'Add Position'}</button>
          </>
        )}
      >
        <form id="add-position-form" onSubmit={handleAddPosition} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Position Title</span>
            <input data-autofocus value={newPositionTitle} onChange={(event) => setNewPositionTitle(event.target.value)} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" placeholder="e.g. Treasurer" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Max Winners</span>
            <input type="number" min="1" value={newPositionMaxWinners} onChange={(event) => setNewPositionMaxWinners(Number(event.target.value))} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
          </label>
          {modalError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{modalError}</div>
          )}
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove Election Position"
        message="This removes the position from the ballot configuration."
        recordName={deleteTarget?.title}
        confirmText="Remove"
        busy={busy}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={handleRemovePosition}
      />
    </div>
  );
}
