import { useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import NextStep from '../ui/NextStep';
import { electionLifecycle, toNextStepProps } from '../../lib/lifecycle';
import { finalizeElection, updateElection } from '../../services/electionService';
import { getApiErrorMessage } from '../../utils/apiError';
import { finalizeChecklist, isReturned, withApprovalState } from './electionFlow';

const BASE = '/dashboard/elections';

function FinalizeChecklist({ checklist }) {
  return (
    <div className="px-1">
      <p className="text-xs font-bold text-ink">Before the ballot can be finalized</p>
      <ul className="mt-2 space-y-1.5">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm font-medium text-ink-muted-strong">
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

// The one next action for the selected election. The Admin's actions run here (finalize, open
// voting, release the results); every other role gets the guidance and, when it is theirs, a link.
export default function ElectionNextStep({ election, role, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const record = withApprovalState(election);
  const lifecycle = electionLifecycle(record, role);
  const props = toNextStepProps(lifecycle);
  const isAdmin = role === 'ADMIN';
  const building = election.status === 'upcoming' && !election.finalized_at;
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

  let { primary, tone } = props;
  if (primary?.to?.startsWith(BASE) && !primary.to.includes('?')) primary = { ...primary, to: `${primary.to}?record=${election.id}` };

  if (isAdmin && building) {
    primary = {
      label: 'Finalize ballot',
      onClick: () => run('finalize', () => finalizeElection(election.id), 'Unable to finalize the ballot.'),
      disabledReason: busy === 'finalize' ? 'Finalizing the ballot...' : checklist.disabledReason,
    };
  } else if (isAdmin && election.status === 'upcoming') {
    primary = {
      label: 'Open voting',
      onClick: () => run('open', () => updateElection(election.id, { status: 'active' }), 'Unable to open voting.'),
      disabledReason: busy === 'open' ? 'Opening voting...' : undefined,
    };
  } else if (isAdmin && election.status === 'closed' && election.results_visible === false) {
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
      <NextStep {...props} tone={tone} primary={primary} />
      {checklist && <FinalizeChecklist checklist={checklist} />}
      {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}
