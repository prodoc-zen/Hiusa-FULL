import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Modal from '../Modal';
import { resolveTie } from '../../services/electionService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText';

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

// The reviewer settles a tie the runoff did not break. The row carries the runoff candidates and the seats the
// runoff competed for; anyone in the winners already (ahead in round 1 or strictly ahead in the runoff) is not
// tied any more and takes a seat off the count.
export function tieChoice(result) {
  const runoffIds = result.runoff?.candidate_ids || [];
  const decided = result.winner_ids || [];
  const tied = (result.candidates || []).filter((candidate) => runoffIds.includes(candidate.id) && !decided.includes(candidate.id));
  const seats = Number(result.runoff?.seats || 0) - runoffIds.filter((id) => decided.includes(id)).length;
  return { tied, seats };
}

export default function TieResolutionForm({ electionId, election, result, onResolved }) {
  const { tied, seats } = tieChoice(result);
  const hasRule = Boolean(election?.tie_break_rule?.trim());
  const [selected, setSelected] = useState([]);
  const [explanation, setExplanation] = useState('');
  const [ruleUsed, setRuleUsed] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const full = selected.length >= seats;
  const ready = selected.length === seats && seats > 0 && explanation.trim() !== '' && (hasRule || ruleUsed.trim() !== '');
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const record = async () => {
    setError('');
    setBusy(true);
    try {
      await resolveTie(electionId, result.position.id, {
        winner_candidate_ids: selected,
        explanation: explanation.trim(),
        ...(hasRule ? {} : { rule_used: ruleUsed.trim() }),
      });
      setConfirming(false);
      onResolved?.();
    } catch (failure) {
      setConfirming(false);
      setError(getApiErrorMessage(failure, 'Could not record the decision.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-ink">Choose {seats} {seats === 1 ? 'candidate' : 'candidates'} from those still tied</legend>
        {tied.map((candidate) => {
          const checked = selected.includes(candidate.id);
          return (
            <label key={candidate.id} className="flex min-h-10 items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4" checked={checked} disabled={!checked && full} onChange={() => toggle(candidate.id)} />
              <span>{formatDisplayText(candidate.name)} ({candidate.votes} {Number(candidate.votes) === 1 ? 'vote' : 'votes'})</span>
            </label>
          );
        })}
      </fieldset>
      {hasRule
        ? <div><p className="text-[13px] font-medium text-ink">Approved tie-break rule</p><p className="mt-1 text-sm text-ink-muted-strong">{election.tie_break_rule}</p></div>
        : (
          <Field label="Rule used" required>
            <Input value={ruleUsed} maxLength={500} onChange={(event) => setRuleUsed(event.target.value)} />
          </Field>
        )}
      <Field label="Written explanation" required>
        <Textarea rows={3} maxLength={2000} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
      </Field>
      <p className="text-sm text-ink-muted">Vote totals cannot be changed.</p>
      {error && <p role="alert" className={ALERT}>{error}</p>}
      <Button disabled={!ready} onClick={() => setConfirming(true)}>Record decision</Button>
      <Modal
        open={confirming}
        title="Record this decision?"
        description="The chosen candidates win the remaining seats. The explanation is kept with the results and cannot be edited."
        onClose={busy ? undefined : () => setConfirming(false)}
        closeOnBackdrop={false}
        closeOnEscape={!busy}
        maxWidth="max-w-md"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
            <Button loading={busy} onClick={record}>Confirm decision</Button>
          </>
        )}
      />
    </form>
  );
}
