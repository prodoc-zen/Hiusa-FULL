import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, PauseCircle, CircleDashed, Wallet } from 'lucide-react';
import { Card, DrawnCheck, EmptyState, ErrorState, FlowStepper, NextStep, PageHeader, ProgressMeter, Select, SkeletonCard } from '../../../components/ui';
import { getMyClearances } from '../../../services/clearanceService';
import { getStudentDebts } from '../../../services/financeService';
import { debtRowFrom, owedSentence } from '../finance/accountDebt';
import { clearanceLifecycle, toNextStepProps } from '../../../lib/lifecycle';
import { manilaDate, peso } from '../../../lib/format';
import { humanizeRole, whoToSee } from './clearanceLabels';

// The stepper above already shows every signatory and its state, so the list holds only what the student can act on.
function SignatureRow({ signature }) {
  const held = signature.status === 'held';
  const Icon = held ? PauseCircle : CircleDashed;

  return (
    <div className="flex items-start gap-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0 last:pb-0">
      <Icon size={20} className={`mt-0.5 shrink-0 ${held ? 'text-warning-strong' : 'text-ink-soft'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{humanizeRole(signature.required_role)}</p>
        {held ? (
          <p className="mt-1 text-sm text-ink">{signature.remarks || 'On hold.'} See {whoToSee(signature.required_role)}.</p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">Waiting on {whoToSee(signature.required_role)}.</p>
        )}
      </div>
    </div>
  );
}

// Period titles often carry the academic year already, so add it only when the title does not.
function periodLabel(entry, joiner = ' · ') {
  const title = formatDisplayText(entry.title);
  if (!entry.academic_year || String(entry.title).includes(entry.academic_year)) return title;
  return joiner === ' · ' ? `${title} · ${entry.academic_year}` : `${title} (${entry.academic_year})`;
}

export default function StudentClearancePage() {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [owed, setOwed] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // The Statement of account reads the same rule, so a debt that holds the clearance there shows here too.
    return Promise.all([getMyClearances(), getStudentDebts().catch(() => null)])
      .then(([res, debts]) => {
        setOwed(owedSentence(debtRowFrom(debts), peso));
        const list = Array.isArray(res.data) ? res.data : [];
        setPeriods(list);
        // "Current" is the most recent period still incomplete; if every
        // period is complete, fall back to the most recently opened one.
        const sorted = [...list].sort((a, b) => b.clearance_period_id - a.clearance_period_id);
        const current = sorted.find((entry) => !entry.is_complete) || sorted[0];
        setSelectedId(current ? String(current.clearance_period_id) : '');
      })
      .catch(() => setError('Failed to load your clearance.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => periods.find((entry) => String(entry.clearance_period_id) === selectedId),
    [periods, selectedId],
  );

  const showing = !loading && !error ? selected : undefined;
  const stage = useMemo(() => (showing ? clearanceLifecycle(showing, 'STUDENT') : null), [showing]);
  const clearedCount = showing ? showing.signatures.filter((signature) => signature.status === 'cleared').length : 0;
  // The stepper drops the actor line: it repeats the step label ("SAO", "Department Head").
  const steps = stage?.steps.map(({ key, label, state, note }) => ({ key, label, state, note }));
  const openSignatures = showing ? showing.signatures.filter((signature) => signature.status !== 'cleared') : [];
  // The celebration card below already says a complete clearance is done, so the callout stays for open ones.
  const nextStep = stage && !showing.is_complete ? { ...toNextStepProps(stage), primary: undefined } : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        meta={showing && <span className="text-xs font-semibold text-ink-muted-strong">{periodLabel(showing)}</span>}
        stepper={stage && <FlowStepper variant="full" steps={steps} ariaLabel="Clearance signatures" />}
        nextStep={nextStep && <NextStep {...nextStep} />}
      />

      {loading && <SkeletonCard />}

      {!loading && error && <ErrorState description={error} onRetry={load} />}

      {!loading && !error && periods.length === 0 && (
        <EmptyState
          kind="first-run"
          icon={ClipboardCheck}
          title="No clearance period yet"
          description="The Student Affairs Office opens a clearance period each semester. Your checklist appears here when it does."
        />
      )}

      {showing && periods.length > 1 && (
        <div className="sm:w-80">
          <Select aria-label="Choose clearance period" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {[...periods].sort((a, b) => b.clearance_period_id - a.clearance_period_id).map((entry) => (
              <option key={entry.clearance_period_id} value={entry.clearance_period_id}>{periodLabel(entry, 'parens')}</option>
            ))}
          </Select>
        </div>
      )}

      {showing && owed && (
        <Card>
          <div className="flex items-start gap-3">
            <Wallet size={20} className="mt-0.5 shrink-0 text-warning-strong" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Financial clearance is on hold</p>
              <p className="mt-1 text-sm text-ink">{owed}</p>
              <Link to="/dashboard/finance/statement-of-account" className="mt-1 inline-flex min-h-10 items-center rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Open Statement of account</Link>
            </div>
          </div>
        </Card>
      )}

      {showing && (showing.is_complete ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <DrawnCheck label="Clearance complete" size="lg" />
            <p className="text-lg font-semibold text-ink">Your clearance is complete!</p>
            <p className="max-w-sm text-sm text-ink-muted">Every required signature for {formatDisplayText(showing.title)} has been cleared.</p>
          </div>
        </Card>
      ) : (
        <Card>
          <ProgressMeter label="Signatures cleared" value={clearedCount} max={showing.signatures.length} valueLabel={`${clearedCount} of ${showing.signatures.length}`} className="mb-3" />
          {showing.deadline_at && <p className="mb-3 text-xs font-semibold text-ink-muted">Deadline: {manilaDate(showing.deadline_at, 'long')}</p>}
          <div>
            {openSignatures.map((signature) => <SignatureRow key={signature.id} signature={signature} />)}
          </div>
        </Card>
      ))}
    </div>
  );
}
