import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, ClipboardCheck, PauseCircle } from 'lucide-react';
import { Card, DrawnCheck, EmptyState, ErrorState, ProgressMeter, Select, SkeletonCard, StatusBadge } from '../../../components/ui';
import { getMyClearances } from '../../../services/clearanceService';
import { manilaDate } from '../../../lib/format';
import { clearanceStatusTone, humanizeRole, whoToSee } from './clearanceLabels';

function SignatureRow({ signature }) {
  const Icon = signature.status === 'cleared' ? CheckCircle2 : signature.status === 'held' ? PauseCircle : CircleDashed;
  const iconTone = signature.status === 'cleared' ? 'text-success-strong' : signature.status === 'held' ? 'text-warning-strong' : 'text-ink-soft';

  return (
    <div className="flex items-start gap-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0">
      <Icon size={20} className={`mt-0.5 shrink-0 ${iconTone}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-ink">{humanizeRole(signature.required_role)}</p>
          <StatusBadge status={signature.status} tone={clearanceStatusTone(signature.status)} />
        </div>
        {signature.status === 'held' && (
          <p className="mt-1 text-xs font-medium leading-5 text-ink-muted">{signature.remarks || 'On hold.'} Please see {whoToSee(signature.required_role)}.</p>
        )}
        {signature.status === 'pending' && (
          <p className="mt-1 text-xs font-medium leading-5 text-ink-muted">Waiting on {whoToSee(signature.required_role)}.</p>
        )}
      </div>
    </div>
  );
}

export default function StudentClearancePage() {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getMyClearances()
      .then((res) => {
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

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return <ErrorState description={error} onRetry={load} />;
  }

  if (periods.length === 0) {
    return (
      <EmptyState
        kind="first-run"
        icon={ClipboardCheck}
        title="No clearance period yet"
        description="Once your organization or the Student Affairs Office opens a clearance period, your checklist will show up here."
      />
    );
  }

  const clearedCount = selected.signatures.filter((signature) => signature.status === 'cleared').length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight text-ink">My clearance</h1>
        <p className="mt-1 text-sm font-medium text-ink-muted-strong">{formatDisplayText(selected.title)} · {selected.academic_year}</p>
      </div>

      {periods.length > 1 && (
        <Select aria-label="Choose clearance period" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {[...periods].sort((a, b) => b.clearance_period_id - a.clearance_period_id).map((entry) => (
            <option key={entry.clearance_period_id} value={entry.clearance_period_id}>{formatDisplayText(entry.title)} ({entry.academic_year})</option>
          ))}
        </Select>
      )}

      {selected.is_complete ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <DrawnCheck label="Clearance complete" size="lg" />
            <p className="text-lg font-bold text-ink">Your clearance is complete!</p>
            <p className="max-w-sm text-sm font-medium text-ink-muted">Every required signature for {formatDisplayText(selected.title)} has been cleared.</p>
          </div>
        </Card>
      ) : (
        <Card>
          <ProgressMeter label="Signatures cleared" value={clearedCount} max={selected.signatures.length} valueLabel={`${clearedCount} of ${selected.signatures.length}`} className="mb-3" />
          {selected.deadline_at && <p className="mb-3 text-xs font-semibold text-ink-muted">Deadline: {manilaDate(selected.deadline_at, 'long')}</p>}
          <div>
            {selected.signatures.map((signature) => <SignatureRow key={signature.id} signature={signature} />)}
          </div>
        </Card>
      )}
    </div>
  );
}
