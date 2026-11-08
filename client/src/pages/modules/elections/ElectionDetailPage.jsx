import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import { createElectionPosition, deleteElectionPosition } from '../../../services/electionService';
import ManageVotersPage from './ManageVotersPage';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

export default function ElectionDetailPage() {
  const { election, refreshElection } = useOutletContext();
  const [searchParams] = useSearchParams();
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
    return <EmptyState title="Election not found" description="Go back and choose an election." />;
  }

  if (searchParams.get('view') === 'voters') return <ManageVotersPage />;

  const positions = localPositions;
  const candidates = election.candidates || [];
  const votes = election.votes || [];
  const ballotLocked = election.status === 'closed' || Boolean(election.finalized_at) || votes.length > 0;

  const groupedCandidates = positions.map((position) => ({
    position,
    candidates: candidates.filter((candidate) => candidate.position_id === position.id),
  }));

  const candidateColumns = [
    { key: 'name', header: 'Candidate', render: (candidate) => <span className="font-medium">{formatDisplayText(`${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim())}</span> },
    { key: 'partylist', header: 'Party list', render: (candidate) => formatDisplayText(candidate.partylist?.name) || 'Independent' },
    { key: 'votes', header: 'Votes', align: 'right', render: (candidate) => votes.filter((vote) => vote.candidate_id === candidate.id).length },
  ];

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
      setDeleteTarget(null);
      setError(deleteError?.response?.data?.message || 'Unable to remove election position.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted-strong">
          <span className="tabular-nums">{positions.length}</span> positions, <span className="tabular-nums">{candidates.length}</span> candidates, <span className="tabular-nums">{votes.length}</span> votes
        </p>
        {!ballotLocked && <Button leftIcon={Plus} onClick={openAddPosition}>Add position</Button>}
      </div>

      {ballotLocked && (
        <p className="rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-800">Position setup is locked for this election.</p>
      )}

      {error && <p role="alert" className={ALERT}>{error}</p>}

      {positions.length === 0 && (
        <EmptyState
          title="No positions yet"
          description={ballotLocked ? 'This ballot has no positions.' : 'Add the positions voters will choose for.'}
        />
      )}

      {groupedCandidates.map(({ position, candidates: positionCandidates }) => (
        <section key={position.id} aria-label={formatDisplayText(position.title)} className="border-t border-line pt-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">{formatDisplayText(position.title)}</h2>
              <p className="text-sm text-ink-muted">Up to {position.max_winners} winner{position.max_winners > 1 ? 's' : ''}, {positionCandidates.length} candidate{positionCandidates.length === 1 ? '' : 's'}</p>
            </div>
            {!ballotLocked && (
              <Button variant="secondary" size="sm" leftIcon={Trash2} onClick={() => setDeleteTarget(position)}>Remove</Button>
            )}
          </div>
          {positionCandidates.length > 0
            ? <DataTable caption={`Candidates for ${formatDisplayText(position.title)}`} columns={candidateColumns} rows={positionCandidates} stickyHeader={false} />
            : <p className="text-sm text-ink-muted">No candidates for this position yet.</p>}
        </section>
      ))}

      <Drawer
        open={showAddPosition}
        title="Add election position"
        onClose={closeAddPosition}
        footer={(
          <>
            <Button variant="secondary" onClick={closeAddPosition} disabled={busy}>Cancel</Button>
            <Button type="submit" form="add-position-form" loading={busy} disabled={!newPositionTitle.trim()}>Add position</Button>
          </>
        )}
      >
        <form id="add-position-form" onSubmit={handleAddPosition} className="space-y-4">
          <Field label="Position title" required>
            <Input data-autofocus value={newPositionTitle} onChange={(event) => setNewPositionTitle(event.target.value)} placeholder="e.g. Treasurer" />
          </Field>
          <Field label="Maximum winners" optional hint="Leave at 1 unless several people can hold this position.">
            <Input type="number" min="1" value={newPositionMaxWinners} onChange={(event) => setNewPositionMaxWinners(Number(event.target.value))} />
          </Field>
          {modalError && <p role="alert" className={ALERT}>{modalError}</p>}
        </form>
      </Drawer>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove election position"
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
