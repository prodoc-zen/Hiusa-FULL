import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import Modal from '../../../components/Modal';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import { SkeletonText } from '../../../components/ui/Skeleton';
import logo from '../../../assets/Hiusa Logo.png';
import { getElectionDetails } from '../../../services/electionService';
import { getApiErrorMessage } from '../../../utils/apiError';
import CastVotePage from './CastVotePage';

export default function ImmersiveVotePage() {
  const { electionId } = useParams();
  const navigate = useNavigate();
  const [election, setElection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  const loadElection = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setElection(await getElectionDetails(electionId));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'This election is unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  const refreshElection = useCallback(async () => {
    try {
      setElection(await getElectionDetails(electionId));
    } catch {
      // The submitted receipt remains visible even if this background refresh fails.
    }
  }, [electionId]);

  useEffect(() => { loadElection(); }, [loadElection]);
  useEffect(() => {
    const warnBeforeUnload = (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  // Leaving an unsubmitted ballot drops it from history. A cast ballot stays, so Back from Vote reaches its receipt.
  const leaveVoting = (afterVote = false) => navigate('/dashboard/elections/cast-vote', afterVote === true ? undefined : { replace: true });
  const requestExit = () => dirty ? setConfirmExit(true) : leaveVoting();

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3"><img src={logo} alt="HIUSA" className="h-8 w-8 object-contain" /><p className="truncate text-sm font-semibold text-ink">Voting</p></div>
          <Button variant="secondary" leftIcon={ArrowLeft} onClick={requestExit}>Exit ballot</Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
        {loading && <div role="status" aria-label="Loading ballot" className="mx-auto max-w-2xl"><h1 className="sr-only">Ballot</h1><SkeletonText lines={4} /></div>}
        {!loading && error && <div className="mx-auto max-w-xl"><h1 className="sr-only">Ballot</h1><ErrorState title="This ballot did not open" description={error} onRetry={loadElection} /></div>}
        {!loading && election && <CastVotePage election={election} refreshElection={refreshElection} onDirtyChange={setDirty} onReturnToDashboard={leaveVoting} />}
      </main>

      <Modal open={confirmExit} title="Leave the ballot?" description="Your current selections have not been submitted and will be lost if you leave." onClose={() => setConfirmExit(false)} closeOnBackdrop closeOnEscape maxWidth="max-w-md" footer={<><Button variant="secondary" onClick={() => setConfirmExit(false)}>Continue voting</Button><Button variant="danger" onClick={leaveVoting}>Leave voting</Button></>}>
        <p className="text-sm text-ink-muted-strong">You return to Vote, where you can start a new ballot while voting is open.</p>
      </Modal>
    </div>
  );
}
