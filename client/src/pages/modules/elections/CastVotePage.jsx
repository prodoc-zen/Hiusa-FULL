import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
  Vote,
} from 'lucide-react';
import Modal from '../../../components/Modal';
import { castVotes } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { getApiErrorMessage } from '../../../utils/apiError';

function CandidatePortrait({ candidate, name, className = 'h-16 w-16' }) {
  if (candidate.image_url) {
    return <img src={resolveAssetUrl(candidate.image_url)} alt={name} className={`${className} shrink-0 rounded-lg border border-[#DDE7EF] object-cover`} />;
  }
  const initials = name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return <div className={`${className} grid shrink-0 place-items-center rounded-lg bg-[#0F2F62] font-black text-white`}>{initials}</div>;
}

function formatVotingDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function getVotingPeriodRestriction(election) {
  const start = new Date(election.start_time).getTime();
  const end = new Date(election.end_time).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { title: 'Voting Period Needs Attention', message: 'The configured voting period is invalid. Please contact an election administrator.' };
  if (now < start) return { title: 'Voting Opens Soon', message: `Voting starts ${formatVotingDateTime(election.start_time)}.` };
  if (now > end) return { title: 'Voting Period Ended', message: `Voting ended ${formatVotingDateTime(election.end_time)}.` };
  return null;
}

export default function CastVotePage({ election: electionOverride = null, refreshElection: refreshElectionOverride = null, onReturnToDashboard = null, onDirtyChange = null }) {
  const outletContext = useOutletContext() || {};
  const election = electionOverride || outletContext.election;
  const refreshElection = refreshElectionOverride || outletContext.refreshElection || (() => Promise.resolve());
  const navigate = useNavigate();
  const [phase, setPhase] = useState('preview');
  const [votes, setVotes] = useState({});
  const [positionIndex, setPositionIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [alreadyVotedDetected, setAlreadyVotedDetected] = useState(false);
  const [confirmingSubmission, setConfirmingSubmission] = useState(false);
  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  }, []);

  useEffect(() => {
    onDirtyChange?.(Object.keys(votes).length > 0 && phase !== 'submitted');
  }, [onDirtyChange, phase, votes]);

  if (!election) return <div className="py-20 text-center text-sm text-[#64748B]">Election not found.</div>;

  const groupedPositions = (election.positions || []).map((position) => ({ position, candidates: (election.candidates || []).filter((candidate) => candidate.position_id === position.id) })).filter((entry) => entry.candidates.length > 0);
  const currentPosition = groupedPositions[positionIndex];
  const currentUserVotes = election.my_votes || (election.votes || []).filter((voteItem) => voteItem.voter_id === currentUser?.id);
  const hasVoted = currentUserVotes.length > 0;
  const allSelected = groupedPositions.length > 0 && groupedPositions.every((entry) => votes[entry.position.id]);
  const votingPeriodRestriction = getVotingPeriodRestriction(election);
  const candidateCount = groupedPositions.reduce((sum, entry) => sum + entry.candidates.length, 0);

  const returnToPreviousPage = () => {
    setAlreadyVotedDetected(false);
    if (onReturnToDashboard) {
      onReturnToDashboard();
      return;
    }
    if (Number(window.history.state?.idx) > 0) navigate(-1);
    else navigate('/dashboard/elections', { replace: true });
  };

  const submitBallot = async () => {
    setConfirmingSubmission(false);
    setSubmitError('');
    setSubmitting(true);
    try {
      const ballot = groupedPositions.map((entry) => ({ position_id: entry.position.id, candidate_id: votes[entry.position.id] }));
      const response = await castVotes(election.id, ballot);
      setReceipt(response.receipt || 'CAST-SUCCESSFUL');
      setPhase('submitted');
      refreshElection().catch(() => {});
    } catch (error) {
      const message = String(getApiErrorMessage(error, 'Unable to submit ballot.'));
      if (/already voted/i.test(message)) setAlreadyVotedDetected(true);
      else setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (election.status !== 'active') {
    return <div className="mx-auto max-w-2xl rounded-xl border border-[#DDE7EF] bg-white p-8 text-center shadow-sm"><LockKeyhole size={34} className="mx-auto text-[#94A3B8]" /><h2 className="mt-4 text-xl font-black text-[#0F172A]">Voting is closed</h2><p className="mt-2 text-sm text-[#64748B]">This election is not currently accepting ballots.</p></div>;
  }

  if (!hasVoted && votingPeriodRestriction) {
    return <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"><CalendarDays size={34} className="mx-auto text-amber-600" /><h2 className="mt-4 text-xl font-black text-amber-900">{votingPeriodRestriction.title}</h2><p className="mt-2 text-sm font-medium text-amber-800">{votingPeriodRestriction.message}</p></div>;
  }

  if ((hasVoted && phase !== 'submitted') || alreadyVotedDetected) {
    return (
      <Modal open title="Vote Already Recorded" description="Each voter can submit only one ballot for this election." onClose={returnToPreviousPage} closeOnBackdrop closeOnEscape maxWidth="max-w-md" footer={<button type="button" data-autofocus onClick={returnToPreviousPage} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7]">Go back</button>}>
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={22} /><p className="text-sm font-medium leading-6 text-emerald-900">Your previous ballot remains securely recorded. No additional vote was submitted.</p></div>
      </Modal>
    );
  }

  if (phase === 'submitted') {
    const selections = groupedPositions.map((entry) => {
      const voteItem = currentUserVotes.find((item) => item.position_id === entry.position.id);
      const candidate = entry.candidates.find((item) => item.id === (voteItem?.candidate_id ?? votes[entry.position.id]));
      return { position: entry.position.title, candidate, name: candidate ? `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() : 'Not selected' };
    });
    return (
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
        <div className="bg-[#0B1831] p-7 text-center text-white sm:p-9"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-emerald-300/30 bg-emerald-500/15 text-emerald-300"><CheckCircle2 size={32} /></div><h2 className="mt-4 text-2xl font-black">Ballot submitted</h2><p className="mt-2 text-sm text-slate-300">Your choices were securely recorded and cannot be changed.</p></div>
        <div className="p-5 sm:p-7">
          <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-center"><p className="text-[11px] font-bold uppercase tracking-widest text-[#64748B]">Ballot receipt hash</p><p className="mt-1 break-all font-mono text-sm font-black text-[#0B8ED0] sm:text-lg">{receipt || currentUserVotes[0]?.vote_hash || 'CAST-SUCCESSFUL'}</p></div>
          <h3 className="mt-6 text-sm font-black text-[#0F172A]">Your selections</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{selections.map((selection) => <div key={selection.position} className="flex items-center gap-3 rounded-lg border border-[#DDE7EF] p-3">{selection.candidate && <CandidatePortrait candidate={selection.candidate} name={selection.name} className="h-12 w-12" />}<div><p className="text-[10px] font-bold uppercase text-[#64748B]">{selection.position}</p><p className="mt-0.5 text-sm font-bold text-[#0F172A]">{selection.name}</p></div></div>)}</div>
          <button type="button" onClick={() => onReturnToDashboard ? onReturnToDashboard() : navigate('/dashboard/student')} className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] sm:w-auto">Return to dashboard <ArrowRight size={16} /></button>
        </div>
      </div>
    );
  }

  if (phase === 'preview') {
    return (
      <div className="space-y-5">
        <section className="grid overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm lg:grid-cols-[minmax(320px,.8fr)_minmax(0,1.2fr)]">
          <div className="relative min-h-64 bg-[#0F2F62]">
            {election.image_url ? <img src={resolveAssetUrl(election.image_url)} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-white/70"><Vote size={70} strokeWidth={1.4} /></div>}
            <div className="absolute inset-0 bg-[#0B1831]/30" />
            <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-[#0B1831]/80 px-3 py-1.5 text-xs font-bold text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Voting is live</span>
          </div>
          <div className="p-5 sm:p-7 lg:p-8">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Official ballot</p>
            <h1 className="mt-2 text-2xl font-black leading-tight text-[#0F172A] sm:text-3xl">{election.title}</h1>
            <p className="mt-3 text-sm leading-6 text-[#64748B]">Review the ballot, select one candidate for every position, and confirm all choices before final submission.</p>
            <div className="mt-5 grid grid-cols-3 divide-x divide-[#DDE7EF] rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] py-3 text-center"><div><p className="text-xl font-black text-[#0F172A]">{groupedPositions.length}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Positions</p></div><div><p className="text-xl font-black text-[#0F172A]">{candidateCount}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Candidates</p></div><div><p className="text-xl font-black text-[#0F172A]">{Number(election.voters_count || 0)}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Ballots</p></div></div>
            <button type="button" onClick={() => { setPositionIndex(0); setPhase('voting'); }} className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] sm:w-auto">Start my ballot <ArrowRight size={16} /></button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[{ icon: UsersRound, number: '01', title: 'Review candidates', text: 'Read each candidate’s party and platform.' }, { icon: Check, number: '02', title: 'Make selections', text: 'Complete every position on the ballot.' }, { icon: ShieldCheck, number: '03', title: 'Confirm once', text: 'Review carefully before secure submission.' }].map((step) => <article key={step.number} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><step.icon size={19} /></span><span className="text-xs font-black text-[#94A3B8]">{step.number}</span></div><h2 className="mt-4 text-base font-black text-[#0F172A]">{step.title}</h2><p className="mt-1 text-sm leading-6 text-[#64748B]">{step.text}</p></article>)}
        </section>
      </div>
    );
  }

  if (phase === 'review') {
    const missing = groupedPositions.filter((entry) => !votes[entry.position.id]);
    return (
      <>
      <div className="mx-auto max-w-4xl space-y-4">
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-7"><p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Final check</p><h2 className="mt-1 text-2xl font-black text-[#0F172A]">Review your ballot</h2><p className="mt-2 text-sm text-[#64748B]">Submitted ballots cannot be edited.</p>
          {missing.length > 0 && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3"><AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" /><p className="text-sm font-medium text-red-700">Complete all positions before final submission.</p></div>}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">{groupedPositions.map((entry) => { const candidate = entry.candidates.find((item) => item.id === votes[entry.position.id]); const name = candidate ? `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() : 'Not selected'; return <article key={entry.position.id} className={`flex items-center gap-3 rounded-lg border p-3 ${candidate ? 'border-[#DDE7EF]' : 'border-red-200 bg-red-50'}`}>{candidate && <CandidatePortrait candidate={candidate} name={name} className="h-14 w-14" />}<div><p className="text-[10px] font-bold uppercase text-[#64748B]">{entry.position.title}</p><p className="mt-0.5 text-sm font-black text-[#0F172A]">{name}</p><p className="mt-0.5 text-xs text-[#64748B]">{candidate?.partylist?.name || (candidate ? 'Independent' : '')}</p></div></article>; })}</div>
        </section>
        {submitError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{submitError}</div>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => { setPositionIndex(0); setPhase('voting'); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-5 text-sm font-bold text-[#0F172A] hover:bg-[#F8FBFD]"><ChevronLeft size={16} /> Edit ballot</button><button type="button" disabled={!allSelected || submitting} onClick={() => setConfirmingSubmission(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><ShieldCheck size={16} /> {submitting ? 'Submitting...' : 'Submit final ballot'}</button></div>
      </div>
      <Modal open={confirmingSubmission} title="Submit your final ballot?" description="This is your final confirmation. After submission, your choices are securely recorded and cannot be changed." onClose={() => setConfirmingSubmission(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-md" footer={<><button type="button" disabled={submitting} onClick={() => setConfirmingSubmission(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-[#0F172A] hover:bg-[#F8FBFD]">Keep reviewing</button><button type="button" disabled={submitting} onClick={submitBallot} className="h-11 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{submitting ? 'Submitting...' : 'Confirm and submit'}</button></>}><div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-amber-700" /><p className="text-sm font-medium leading-6 text-amber-900">Verify each selection one last time before confirming.</p></div></Modal>
      </>
    );
  }

  if (!currentPosition) return <div className="rounded-xl border border-dashed border-[#DDE7EF] bg-white p-10 text-center text-sm text-[#64748B]">No candidates are available for this election yet.</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="h-fit rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm lg:sticky lg:top-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Ballot progress</p>
        <p className="mt-1 text-sm font-black text-[#0F172A]">{Object.keys(votes).length} of {groupedPositions.length} selected</p>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible">{groupedPositions.map((entry, index) => { const selected = Boolean(votes[entry.position.id]); const active = index === positionIndex; return <button key={entry.position.id} type="button" onClick={() => setPositionIndex(index)} className={`flex h-11 min-w-40 items-center gap-2 rounded-lg border px-3 text-left text-xs font-bold lg:w-full lg:min-w-0 ${active ? 'border-[#0B8ED0] bg-[#EEF6FB] text-[#0B8ED0]' : 'border-[#DDE7EF] text-[#64748B] hover:bg-[#F8FBFD]'}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] ${selected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-[#64748B]'}`}>{selected ? <Check size={12} /> : index + 1}</span><span className="truncate">{entry.position.title}</span></button>; })}</div>
      </aside>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 border-b border-[#DDE7EF] pb-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Position {positionIndex + 1} of {groupedPositions.length}</p><h2 className="mt-1 text-2xl font-black text-[#0F172A]">{currentPosition.position.title}</h2><p className="mt-1 text-sm text-[#64748B]">Select one candidate to continue.</p></div><span className="text-xs font-bold text-[#64748B]">{currentPosition.candidates.length} candidate{currentPosition.candidates.length === 1 ? '' : 's'}</span></div>
        {errors[currentPosition.position.id] && <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3"><AlertCircle size={15} className="text-red-600" /><p className="text-sm font-medium text-red-700">Select a candidate before continuing.</p></div>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{currentPosition.candidates.map((candidate) => { const selected = votes[currentPosition.position.id] === candidate.id; const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim(); return <button key={candidate.id} type="button" aria-pressed={selected} onClick={() => { setVotes((current) => ({ ...current, [currentPosition.position.id]: candidate.id })); setErrors((current) => ({ ...current, [currentPosition.position.id]: false })); }} className={`relative flex min-h-44 flex-col items-start rounded-xl border-2 p-4 text-left transition ${selected ? 'border-[#0B8ED0] bg-[#EEF6FB]' : 'border-[#DDE7EF] bg-white hover:border-[#0B8ED0]/40'}`}><div className="flex w-full items-start gap-3"><CandidatePortrait candidate={candidate} name={name} /><div className="min-w-0 flex-1"><p className="text-base font-black leading-tight text-[#0F172A]">{name}</p><p className="mt-1 text-xs font-bold text-[#0B8ED0]">{candidate.partylist?.name || 'Independent'}</p></div><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-[#0B8ED0] bg-[#0B8ED0] text-white' : 'border-slate-300'}`}>{selected && <Check size={13} />}</span></div><p className="mt-4 line-clamp-3 text-xs leading-5 text-[#64748B]">{candidate.platform || 'No campaign platform has been added.'}</p></button>; })}</div>
        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-[#DDE7EF] pt-4 sm:flex-row sm:justify-between"><button type="button" onClick={() => positionIndex > 0 ? setPositionIndex((index) => index - 1) : setPhase('preview')} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0F172A] hover:bg-[#F8FBFD]"><ChevronLeft size={16} /> {positionIndex > 0 ? 'Previous' : 'Ballot overview'}</button><button type="button" onClick={() => { if (!votes[currentPosition.position.id]) { setErrors((current) => ({ ...current, [currentPosition.position.id]: true })); return; } if (positionIndex < groupedPositions.length - 1) setPositionIndex((index) => index + 1); else setPhase('review'); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7]">{positionIndex < groupedPositions.length - 1 ? <>Next position <ChevronRight size={16} /></> : <><Eye size={16} /> Review ballot</>}</button></div>
      </section>
    </div>
  );
}
