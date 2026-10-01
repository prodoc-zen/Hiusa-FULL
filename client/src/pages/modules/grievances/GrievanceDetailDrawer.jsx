import { useState } from 'react';
import { ShieldCheck, UserRound } from 'lucide-react';
import { Button, Drawer, Field, StatusBadge, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import { manilaDate, relativeTime } from '../../../lib/format';
import {
  ALLOWED_TRANSITIONS,
  TRANSITION_ACTION_LABEL,
  addressedToLabel,
  filerDisplayName,
  grievanceStatusTone,
  urgencyTone,
} from './grievanceLabels';

function IdentitySection({ grievance, viewerRole }) {
  const redacted = !('submitted_by' in grievance);

  if (redacted) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-line bg-subtle p-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-ink">Filed anonymously</p>
          <p className="mt-0.5 text-xs font-medium text-ink-muted">The filer asked to stay anonymous to your organization. This is by design and will not be revealed.</p>
        </div>
      </div>
    );
  }

  const name = filerDisplayName(grievance);

  return (
    <div className="flex items-start gap-3 rounded-card border border-line bg-subtle p-3">
      <UserRound size={18} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <div>
        <p className="text-sm font-bold text-ink">{name}</p>
        {viewerRole === 'SUPER_ADMIN' && grievance.is_anonymous && (
          <p className="mt-0.5 text-xs font-medium text-ink-muted">Filed anonymously toward the organization. Handle with added discretion.</p>
        )}
      </div>
    </div>
  );
}

function TransitionModal({ transition, onCancel, onConfirm, submitting, error }) {
  const [remarks, setRemarks] = useState('');
  if (!transition) return null;

  const label = TRANSITION_ACTION_LABEL[transition] || transition;
  const requiresRemarks = transition === 'resolved' || transition === 'dismissed';

  return (
    <Modal
      open
      title={label}
      description={requiresRemarks
        ? 'These remarks are shared with the student who filed this grievance.'
        : 'The student will be notified that their grievance is now under review.'}
      onClose={submitting ? undefined : onCancel}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button
            variant={transition === 'dismissed' ? 'danger' : 'primary'}
            onClick={() => onConfirm(transition, remarks)}
            loading={submitting}
            disabled={requiresRemarks && !remarks.trim()}
          >
            {label}
          </Button>
        </>
      )}
    >
      {requiresRemarks && (
        <Field label="Remarks" required hint="Explain the outcome in plain language.">
          <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={4} placeholder="What was found, and what happens next..." />
        </Field>
      )}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error}</p>}
    </Modal>
  );
}

export default function GrievanceDetailDrawer({ grievance, viewerRole, onClose, onTransition }) {
  const [pendingTransition, setPendingTransition] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function closeTransition() {
    if (submitting) return;
    setPendingTransition(null);
    setError('');
  }

  async function confirmTransition(status, remarks) {
    setSubmitting(true);
    setError('');
    try {
      await onTransition(grievance.id, { status, remarks: remarks || undefined });
      setPendingTransition(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update this grievance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const allowed = grievance ? (ALLOWED_TRANSITIONS[grievance.status] || []) : [];
  const isTerminal = grievance && allowed.length === 0;

  return (
    <>
      <Drawer open={Boolean(grievance)} title={grievance?.title} description={grievance ? `Filed ${relativeTime(grievance.created_at)}` : undefined} onClose={onClose}>
        {grievance && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={grievance.status} tone={grievanceStatusTone(grievance.status)} />
              <StatusBadge tone={urgencyTone(grievance.urgency)} label={`${grievance.urgency} urgency`} />
              <StatusBadge tone="neutral" label={grievance.category} />
            </div>

            <IdentitySection grievance={grievance} viewerRole={viewerRole} />

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Addressed to</p>
              <p className="mt-1 text-sm font-semibold text-ink">{addressedToLabel(grievance)}</p>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{grievance.description}</p>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Filed</p>
              <p className="mt-1 text-sm font-medium text-ink-muted">{manilaDate(grievance.created_at, 'weekday')}</p>
            </div>

            {grievance.remarks && (
              <div className="rounded-card border border-line bg-subtle p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Remarks</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{grievance.remarks}</p>
              </div>
            )}

            {isTerminal ? (
              <p className="text-xs font-semibold text-ink-muted">This grievance is closed and cannot be reopened.</p>
            ) : (
              <div className="border-t border-line pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Update status</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allowed.map((status) => (
                    <Button
                      key={status}
                      variant={status === 'dismissed' ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() => setPendingTransition(status)}
                    >
                      {TRANSITION_ACTION_LABEL[status]}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <TransitionModal
        transition={pendingTransition}
        onCancel={closeTransition}
        onConfirm={confirmTransition}
        submitting={submitting}
        error={error}
      />
    </>
  );
}
