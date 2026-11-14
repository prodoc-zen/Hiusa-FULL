import { useEffect, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import NextStep from '../ui/NextStep';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Textarea from '../ui/Textarea';
import Modal from '../Modal';
import { electionLifecycle, toNextStepProps } from '../../lib/lifecycle';
import { cancelElection, finalizeElection, resumeElection, suspendElection, updateElection } from '../../services/electionService';
import { getApiErrorMessage } from '../../utils/apiError';
import { manilaDate, manilaTime } from '../../lib/format';
import { finalizeChecklist, isReturned, withApprovalState } from './electionFlow';

const BASE = '/dashboard/elections';

function FinalizeChecklist({ checklist }) {
  return (
    <div className="px-1">
      <p className="text-xs font-semibold text-ink">Before the ballot can be finalized</p>
      <ul className="mt-2 space-y-1.5">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm text-ink-muted-strong">
            {item.ok
              ? <Check size={16} aria-hidden="true" className="shrink-0 text-success-strong" />
              : <CircleAlert size={16} aria-hidden="true" className="shrink-0 text-danger-strong" />}
            <span className="sr-only">{item.ok ? 'Done: ' : 'Not done: '}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

const DIALOGS = {
  suspend: {
    title: 'Suspend election',
    message: 'Phases, filing and voting pause until you resume the election. The reviewer and the other Admins are told.',
    confirm: 'Suspend election',
    variant: 'primary',
    act: (id, reason) => suspendElection(id, reason),
    fallback: 'Unable to suspend the election.',
  },
  cancel: {
    title: 'Cancel election',
    message: 'Cancelling closes the election for good. It cannot be undone, no results are published and no officers are appointed.',
    confirm: 'Cancel election',
    variant: 'danger',
    act: (id, reason) => cancelElection(id, reason),
    fallback: 'Unable to cancel the election.',
  },
};

// Suspending and cancelling both need a written reason, so they share one small dialog.
function ReasonDialog({ kind, busy, error, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const dialog = DIALOGS[kind];

  return (
    <Modal
      open
      title={dialog.title}
      description={dialog.message}
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Back</Button>
          <Button variant={dialog.variant} loading={busy} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>{dialog.confirm}</Button>
        </>
      )}
    >
      <Field label="Reason" required>
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </Field>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error}</p>}
    </Modal>
  );
}

// The one next action for the selected election. The Admin's actions run here (finalize, open
// voting, release the results); every other role gets the guidance and, when it is theirs, a link.
export default function ElectionNextStep({ election, role, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [dialogKind, setDialogKind] = useState(null);
  const [dialogError, setDialogError] = useState('');
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const record = withApprovalState(election);
  const lifecycle = electionLifecycle(record, role);
  const props = toNextStepProps(lifecycle);
  const isAdmin = role === 'ADMIN';
  // An election where students file their own candidacy has no ballot to finalize or voting to open by hand.
  const filing = Boolean(election.filing_starts_at);
  const halted = Boolean(election.cancelled_at) || election.phase === 'cancelled';
  const suspended = Boolean(election.suspended_at) && !halted;
  // An approved election can be halted before the phase engine has given it a phase; one that closed without a phase is finished.
  const canHalt = isAdmin && (Boolean(election.phase) || (Boolean(election.approved_at) && election.status !== 'closed')) && !halted && !election.declined_at && election.phase !== 'completed';
  const building = !filing && election.status === 'upcoming' && !election.finalized_at;
  const checklist = building && (isAdmin || role === 'SBO_OFFICER') ? finalizeChecklist(election) : null;

  const run = async (key, action, fallback) => {
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      const updated = await action();
      await onChanged?.(updated);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, fallback));
    } finally {
      setBusy('');
    }
  };

  const confirmDialog = async (reason) => {
    if (busy) return;
    setBusy(dialogKind);
    setDialogError('');
    try {
      const updated = await DIALOGS[dialogKind].act(election.id, reason);
      setDialogKind(null);
      await onChanged?.(updated);
    } catch (requestError) {
      setDialogError(getApiErrorMessage(requestError, DIALOGS[dialogKind].fallback));
    } finally {
      setBusy('');
    }
  };

  const startsLater = !filing && election.status === 'upcoming' && Boolean(election.finalized_at) && Date.parse(election.start_time) > now;
  let { primary, tone, body } = props;
  if (primary?.to?.startsWith(BASE) && !primary.to.includes('?')) primary = { ...primary, to: `${primary.to}?record=${election.id}` };

  if (isAdmin && suspended && !election.declined_at) {
    primary = {
      label: 'Resume election',
      onClick: () => run('resume', () => resumeElection(election.id), 'Unable to resume the election.'),
      disabledReason: busy === 'resume' ? 'Resuming the election...' : undefined,
    };
  } else if (isAdmin && building) {
    primary = {
      label: 'Finalize ballot',
      onClick: () => run('finalize', () => finalizeElection(election.id), 'Unable to finalize the ballot.'),
      disabledReason: busy === 'finalize' ? 'Finalizing the ballot...' : checklist.disabledReason,
    };
  } else if (isAdmin && startsLater) {
    primary = undefined;
    tone = 'waiting';
    body = `Voting opens by itself on ${manilaDate(election.start_time)} at ${manilaTime(election.start_time)}.`;
  } else if (isAdmin && !filing && election.status === 'upcoming') {
    primary = {
      label: 'Open voting',
      onClick: () => run('open', () => updateElection(election.id, { status: 'active' }), 'Unable to open voting.'),
      disabledReason: busy === 'open' ? 'Opening voting...' : undefined,
    };
  } else if (isAdmin && !filing && !halted && election.status === 'closed' && election.results_visible === false) {
    primary = {
      label: 'Release results',
      onClick: () => run('release', () => updateElection(election.id, { results_visible: true }), 'Unable to release the results.'),
      disabledReason: busy === 'release' ? 'Releasing the results...' : undefined,
    };
  } else if (isAdmin && isReturned(election)) {
    primary = { label: 'Edit and resubmit', to: `${BASE}/manage-elections?edit=${election.id}` };
    tone = 'blocked';
  }

  return (
    <div className="space-y-3">
      <NextStep {...props} tone={tone} body={body} primary={primary} />
      {canHalt && (
        <div className="flex flex-wrap gap-2">
          {!suspended && <Button variant="secondary" onClick={() => { setDialogError(''); setDialogKind('suspend'); }}>Suspend</Button>}
          <Button variant="secondary" onClick={() => { setDialogError(''); setDialogKind('cancel'); }}>Cancel election</Button>
        </div>
      )}
      {checklist && <FinalizeChecklist checklist={checklist} />}
      {dialogKind && <ReasonDialog kind={dialogKind} busy={busy === dialogKind} error={dialogError} onCancel={() => setDialogKind(null)} onConfirm={confirmDialog} />}
      {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong">{error}</p>}
    </div>
  );
}
