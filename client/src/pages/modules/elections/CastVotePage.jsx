import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useMemo, useState } from 'react';
import { RichTextBody } from '../../../components/RichText';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowRight, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import Modal from '../../../components/Modal';
import NextStep from '../../../components/ui/NextStep';
import ProgressMeter from '../../../components/ui/ProgressMeter';
import { isVotingOpen } from '../../../utils/electionAccess';
import { resultsLink } from '../../../components/elections/electionFlow';
import { castVotes } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { getApiErrorMessage } from '../../../utils/apiError';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

function CandidatePortrait({ candidate, name, className = 'h-16 w-16' }) {
  if (candidate.image_url) {
    return <img src={resolveAssetUrl(candidate.image_url)} alt={formatDisplayText(name)} className={`${className} shrink-0 rounded-lg border border-line object-cover`} />;
  }
  const initials = name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return <div className={`${className} grid shrink-0 place-items-center rounded-lg bg-navy-800 font-semibold text-white`}>{initials}</div>;
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
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { title: 'Voting period needs attention', message: 'The configured voting period is invalid. Contact an election administrator.' };
  if (now < start) return { title: 'Voting opens soon', message: `Voting starts ${formatVotingDateTime(election.start_time)}.` };
  if (now > end) return { title: 'Voting period ended', message: `Voting ended ${formatVotingDateTime(election.end_time)}.` };
  return null;
}

// One h1, one sentence, at most one action: the shape of every ballot screen that has nothing to vote on.
function BallotMessage({ title, children, action }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 py-6">
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
      {children}
      {action}
    </div>
  );
}

function ballotRows(groupedPositions, chooseCandidate) {
  return groupedPositions.map((entry, index) => {
    const candidate = chooseCandidate(entry);
    const name = candidate ? `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() : '';
    return { id: entry.position.id, index, position: entry.position, candidate, name };
  });
}

const ballotColumns = [
  { key: 'position', header: 'Position', render: (row) => formatDisplayText(row.position.title) },
  {
    key: 'candidate',
    header: 'Candidate',
    render: (row) => (row.candidate ? (
      <div className="flex items-center gap-3 text-left">
        <CandidatePortrait candidate={row.candidate} name={row.name} className="h-10 w-10" />
        <span className="font-medium">{formatDisplayText(row.name)}</span>
      </div>
    ) : <span className="text-danger-strong">Not selected</span>),
  },
  { key: 'partylist', header: 'Party list', render: (row) => (row.candidate ? (formatDisplayText(row.candidate.partylist?.name) || 'Independent') : null) },
];

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

  if (!election) return <BallotMessage title="Election not found"><p className="text-sm text-ink-muted">Go back and choose an election.</p></BallotMessage>;

  const groupedPositions = (election.positions || []).map((position) => ({ position, candidates: (election.candidates || []).filter((candidate) => candidate.position_id === position.id) })).filter((entry) => entry.candidates.length > 0);
  const currentPosition = groupedPositions[positionIndex];
  const currentUserVotes = election.my_votes || (election.votes || []).filter((voteItem) => voteItem.voter_id === currentUser?.id);
  const hasVoted = currentUserVotes.length > 0;
  const allSelected = groupedPositions.length > 0 && groupedPositions.every((entry) => votes[entry.position.id]);
  const votingPeriodRestriction = getVotingPeriodRestriction(election);
  const candidateCount = groupedPositions.reduce((sum, entry) => sum + entry.candidates.length, 0);
  const selectedCount = Object.keys(votes).length;

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

  if (!isVotingOpen(election)) {
    return <BallotMessage title="No election is currently open"><p className="text-sm text-ink-muted">This election is not currently accepting ballots.</p></BallotMessage>;
  }

  if (election.ballot_refusal) {
    return <BallotMessage title="You cannot vote in this election"><p className="text-sm text-ink-muted">{election.ballot_refusal}</p></BallotMessage>;
  }

  if (!hasVoted && votingPeriodRestriction) {
    return <BallotMessage title={votingPeriodRestriction.title}><p className="text-sm text-ink-muted">{votingPeriodRestriction.message}</p></BallotMessage>;
  }

  if ((hasVoted && phase !== 'submitted') || alreadyVotedDetected) {
    return (
      <BallotMessage title="Vote already recorded" action={<Button onClick={returnToPreviousPage}>Back to elections</Button>}>
        <p className="text-sm text-ink-muted">Each voter can submit one ballot for this election.</p>
        {currentUserVotes[0]?.vote_hash && (
          <div className="border-t border-line pt-3">
            <p className="text-xs font-semibold text-ink-muted">Your ballot receipt</p>
            <p className="mt-1 break-all font-mono text-sm text-ink">{currentUserVotes[0].vote_hash}</p>
          </div>
        )}
      </BallotMessage>
    );
  }

  if (phase === 'submitted') {
    const rows = ballotRows(groupedPositions, (entry) => {
      const voteItem = currentUserVotes.find((item) => item.position_id === entry.position.id);
      return entry.candidates.find((item) => item.id === (voteItem?.candidate_id ?? votes[entry.position.id]));
    });
    const resultsSentence = resultsLink(election, currentUser?.role).available
      ? 'Turnout is shown during voting, and results appear when the election closes.'
      : `Results appear there once voting closes${election.end_time ? ` on ${formatVotingDateTime(election.end_time)}` : ''} and they are released.`;
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Ballot submitted</h1>
          <p className="mt-1 text-sm text-ink-muted">Your choices were recorded and cannot be changed.</p>
        </div>
        <div className="border-t border-line pt-4">
          <p className="text-xs font-semibold text-ink-muted">Ballot receipt</p>
          <p className="mt-1 break-all font-mono text-sm text-ink">{receipt || currentUserVotes[0]?.vote_hash || 'CAST-SUCCESSFUL'}</p>
        </div>
        <DataTable caption="Your selections" captionVisible columns={ballotColumns} rows={rows} stickyHeader={false} />
        <NextStep
          title="What happens next"
          body={`Your receipt stays on the Vote page. ${resultsSentence}`}
          primary={{ label: 'Back to Vote', onClick: () => onReturnToDashboard ? onReturnToDashboard() : navigate('/dashboard/elections/cast-vote') }}
        />
      </div>
    );
  }

  if (phase === 'preview') {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        {election.image_url && <img src={resolveAssetUrl(election.image_url)} alt="" className="aspect-[16/6] w-full rounded-card border border-line object-cover" />}
        <div>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">{formatDisplayText(election.title)}</h1>
          <p className="mt-1 text-sm text-ink-muted">Choose one candidate for every position, check your choices, then submit. A submitted ballot cannot be changed.</p>
        </div>
        <p className="text-sm text-ink-muted-strong">
          <span className="tabular-nums">{groupedPositions.length}</span> positions, <span className="tabular-nums">{candidateCount}</span> candidates
        </p>
        <Button size="lg" rightIcon={ArrowRight} onClick={() => { setPositionIndex(0); setPhase('voting'); }}>Start my ballot</Button>
      </div>
    );
  }

  if (phase === 'review') {
    const rows = ballotRows(groupedPositions, (entry) => entry.candidates.find((item) => item.id === votes[entry.position.id]));
    const missing = rows.filter((row) => !row.candidate);
    return (
      <>
        <div className="mx-auto max-w-3xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-ink sm:text-2xl">Review your ballot</h1>
            <p className="mt-1 text-sm text-ink-muted">Submitted ballots cannot be edited.</p>
          </div>
          {missing.length > 0 && <p role="alert" className={ALERT}>Complete all positions before final submission.</p>}
          <DataTable
            caption="Your selections"
            captionVisible
            columns={ballotColumns}
            rows={rows}
            stickyHeader={false}
            actions={(row) => <Button variant="secondary" size="sm" onClick={() => { setPositionIndex(row.index); setPhase('voting'); }}>Change<span className="sr-only">, {formatDisplayText(row.position.title)}</span></Button>}
          />
          {submitError && <p role="alert" className={ALERT}>{submitError}</p>}
          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <Button variant="secondary" leftIcon={ChevronLeft} onClick={() => { setPositionIndex(0); setPhase('voting'); }}>Edit ballot</Button>
            <Button disabled={!allSelected || submitting} loading={submitting} onClick={() => setConfirmingSubmission(true)}>Submit final ballot</Button>
          </div>
        </div>
        <Modal
          open={confirmingSubmission}
          title="Submit your final ballot?"
          description="This is your final confirmation. After submission, your choices are recorded and cannot be changed."
          onClose={() => setConfirmingSubmission(false)}
          closeOnBackdrop={!submitting}
          closeOnEscape={!submitting}
          maxWidth="max-w-md"
          footer={<><Button variant="secondary" disabled={submitting} onClick={() => setConfirmingSubmission(false)}>Keep reviewing</Button><Button disabled={submitting} loading={submitting} onClick={submitBallot}>Confirm and submit</Button></>}
        >
          <p className="text-sm text-ink-muted-strong">Check each choice once more before you confirm.</p>
        </Modal>
      </>
    );
  }

  if (!currentPosition) return <BallotMessage title="No candidates yet"><p className="text-sm text-ink-muted">No candidates are available for this election yet.</p></BallotMessage>;

  const lastPosition = positionIndex >= groupedPositions.length - 1;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">{formatDisplayText(currentPosition.position.title)}</h1>
        <p className="mt-1 text-sm text-ink-muted">Position {positionIndex + 1} of {groupedPositions.length}. Select one candidate to continue.</p>
      </div>

      <ProgressMeter kind="progress" label="Ballot completion" value={selectedCount} max={groupedPositions.length} valueLabel={`${selectedCount} of ${groupedPositions.length} selected`} />

      <nav aria-label="Ballot positions" className="flex flex-wrap gap-2">
        {groupedPositions.map((entry, index) => {
          const selected = Boolean(votes[entry.position.id]);
          const active = index === positionIndex;
          return (
            <button
              key={entry.position.id}
              type="button"
              aria-current={active ? 'step' : undefined}
              onClick={() => setPositionIndex(index)}
              className={`inline-flex h-11 items-center gap-2 rounded-control border px-3 text-sm transition-colors duration-150 ${active ? 'border-brand-600 bg-brand-600/10 font-semibold text-ink' : 'border-line text-ink-muted-strong hover:bg-subtle'}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${selected ? 'bg-success text-white' : 'bg-line-soft text-ink-muted-strong'}`}>{selected ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
              <span className="max-w-40 truncate">{formatDisplayText(entry.position.title)}</span>
              {selected && <span className="sr-only">Selected</span>}
            </button>
          );
        })}
      </nav>

      {errors[currentPosition.position.id] && <p role="alert" className={ALERT}>Select a candidate before continuing.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {currentPosition.candidates.map((candidate) => {
          const selected = votes[currentPosition.position.id] === candidate.id;
          const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim();
          return (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={selected}
              onClick={() => { setVotes((current) => ({ ...current, [currentPosition.position.id]: candidate.id })); setErrors((current) => ({ ...current, [currentPosition.position.id]: false })); }}
              className={`flex flex-col items-start rounded-card border-2 p-4 text-left transition-colors duration-150 ${selected ? 'border-brand-600 bg-brand-600/10' : 'border-line bg-surface hover:bg-subtle'}`}
            >
              <div className="flex w-full items-start gap-3">
                <CandidatePortrait candidate={candidate} name={name} />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-tight text-ink">{formatDisplayText(name)}</p>
                  <p className="mt-1 text-sm text-ink-muted-strong">{formatDisplayText(candidate.partylist?.name) || 'Independent'}</p>
                </div>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-brand-700 bg-brand-700 text-white' : 'border-ink-soft'}`}>{selected && <Check size={13} aria-hidden="true" />}</span>
              </div>
              <RichTextBody value={candidate.platform || 'No campaign platform has been added.'} className="mt-3 line-clamp-3 text-sm text-ink-muted" />
            </button>
          );
        })}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-between">
        <Button variant="secondary" leftIcon={ChevronLeft} onClick={() => positionIndex > 0 ? setPositionIndex((index) => index - 1) : setPhase('preview')}>{positionIndex > 0 ? 'Previous' : 'Ballot overview'}</Button>
        <Button
          rightIcon={lastPosition ? undefined : ChevronRight}
          onClick={() => {
            if (!votes[currentPosition.position.id]) { setErrors((current) => ({ ...current, [currentPosition.position.id]: true })); return; }
            if (!lastPosition) setPositionIndex((index) => index + 1);
            else setPhase('review');
          }}
        >
          {lastPosition ? 'Review ballot' : 'Next position'}
        </Button>
      </div>
    </div>
  );
}
