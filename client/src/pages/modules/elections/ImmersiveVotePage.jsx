import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import Modal from '../../../components/Modal';
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

  const leaveVoting = () => navigate('/dashboard/student', { replace: true });
  const requestExit = () => dirty ? setConfirmExit(true) : leaveVoting();

  return (
    <div className="min-h-screen bg-[#EEF6FB]">
      <header className="sticky top-0 z-30 border-b border-[#DDE7EF] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3"><img src={logo} alt="HIUSA" className="h-9 w-9 object-contain" /><div className="min-w-0"><p className="truncate text-sm font-black text-[#0F172A]">Secure Voting</p><p className="hidden items-center gap-1 text-[10px] font-semibold text-emerald-700 sm:flex"><LockKeyhole size={10} /> Authenticated official ballot</p></div></div>
          <span className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 md:inline-flex"><ShieldCheck size={13} /> One secure submission</span>
          <button type="button" onClick={requestExit} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0F172A] hover:bg-[#F8FBFD] sm:px-4"><ArrowLeft size={15} /> Exit</button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
        {loading && <div className="space-y-4" role="status"><div className="h-72 animate-pulse rounded-xl border border-[#DDE7EF] bg-white" /><div className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl border border-[#DDE7EF] bg-white" />)}</div><span className="sr-only">Loading ballot</span></div>}
        {!loading && error && <div role="alert" className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-7 text-center"><LockKeyhole size={30} className="mx-auto text-red-500" /><h1 className="mt-3 text-lg font-black text-[#0F172A]">Unable to open this ballot</h1><p className="mt-2 text-sm text-red-700">{error}</p><div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row"><button type="button" onClick={loadElection} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7]">Try again</button><button type="button" onClick={leaveVoting} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-[#0F172A]">Return to dashboard</button></div></div>}
        {!loading && election && <CastVotePage election={election} refreshElection={refreshElection} onDirtyChange={setDirty} onReturnToDashboard={leaveVoting} />}
      </main>

      <Modal open={confirmExit} title="Leave secure voting?" description="Your current selections have not been submitted and will be lost if you leave." onClose={() => setConfirmExit(false)} closeOnBackdrop closeOnEscape maxWidth="max-w-md" footer={<><button type="button" onClick={() => setConfirmExit(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-[#0F172A] hover:bg-white">Continue voting</button><button type="button" onClick={leaveVoting} className="h-11 rounded-lg bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700">Leave voting</button></>}><p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium leading-6 text-amber-900">Only a submitted ballot is recorded. Unsubmitted selections cannot be recovered.</p></Modal>
    </div>
  );
}
