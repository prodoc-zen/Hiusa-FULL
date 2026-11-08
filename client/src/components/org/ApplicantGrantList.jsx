import { useState } from 'react';
import { Button, Card, ErrorState, StatusBadge } from '../ui';
import ConfirmModal from '../ConfirmModal';
import notify from '../../lib/notify';
import { revokeApplicantGrant } from '../../services/applicantGrantService';
import { getApiErrorMessage } from '../../utils/apiError';
import { visibleSchoolId } from '../../utils/schoolId';
import { APPLICATION_LABELS } from './applicationStatus';

const STATE = {
  open: { tone: 'info', label: 'Can apply' },
  used: { tone: 'success', label: 'Applied' },
  revoked: { tone: 'neutral', label: 'Taken back' },
};

export default function ApplicantGrantList({ grants, error, onRetry, onChanged }) {
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  if (!error && grants.length === 0) return null;

  async function takeBack() {
    setBusy(true);
    setProblem('');
    try {
      await revokeApplicantGrant(target.id);
      notify.success(`${target.student?.name || 'The student'} can no longer apply.`);
      setTarget(null);
      onChanged();
    } catch (err) {
      setProblem(getApiErrorMessage(err, 'Could not take this back. Try again.'));
      if (err?.response?.status === 409) onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Students allowed to apply" bodyClassName="p-0">
      {error ? <ErrorState description={error} onRetry={onRetry} /> : (
        <ul className="divide-y divide-line-soft">
          {grants.map((grant) => {
            const state = STATE[grant.state] || STATE.open;
            return (
              <li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-ink">{grant.student?.name || 'Former student'}</p>
                  <p className="break-all text-xs font-medium text-ink-muted">
                    {grant.student?.email}
                    {visibleSchoolId(grant.student?.school_id) !== null ? ` · ID ${visibleSchoolId(grant.student?.school_id)}` : ''}
                  </p>
                  {grant.application && <p className="mt-1 text-xs font-medium text-ink-muted">{grant.application.name}: {APPLICATION_LABELS[grant.application.status] || grant.application.status}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={grant.state} label={state.label} tone={state.tone} />
                  {grant.state === 'open' && (
                    <Button variant="secondary" size="sm" aria-label={`Take back permission from ${grant.student?.name}`} onClick={() => { setProblem(''); setTarget(grant); }}>Take back</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmModal
        open={Boolean(target)}
        title="Take back this permission?"
        message="The student stops seeing Apply for an organization. You can allow them again later."
        recordName={target?.student?.name}
        confirmText="Take back"
        cancelText="Keep it"
        variant="danger"
        busy={busy}
        error={problem}
        onCancel={() => setTarget(null)}
        onConfirm={takeBack}
      />
    </Card>
  );
}
