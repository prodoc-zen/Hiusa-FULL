import { formatDisplayText } from '../../../utils/displayText.js';
import { useState } from 'react';
import { deleteGrievance } from '../../../services/grievanceService';
import { ShieldCheck, UserRound } from 'lucide-react';
import { Button, Drawer, Field, FlowStepper, NextStep, Select, StatusBadge, Textarea } from '../../../components/ui';
import RulesDisclosure from '../../../components/ai/RulesDisclosure';
import { toNextStepProps } from '../../../lib/lifecycle';
import Modal from '../../../components/Modal';
import { RichTextBody } from '../../../components/RichText';
import { manilaDate, relativeTime } from '../../../lib/format';
import {
  ALLOWED_TRANSITIONS,
  CATEGORIES,
  URGENCY_ORDER,
  TRANSITION_ACTION_LABEL,
  addressedToKey,
  addressedToLabel,
  filerDisplayName,
  grievanceStage,
  grievanceStatusTone,
  urgencyTone,
} from './grievanceLabels';

// The SAO can decide any grievance, so it is shown the turn of whoever the grievance went to.
function actingRoleFor(grievance, viewerRole) {
  if (viewerRole !== 'SUPER_ADMIN') return viewerRole;
  return addressedToKey(grievance) === 'organization' ? 'ADMIN' : 'SUPER_ADMIN';
}

// The buttons that do the work sit below, so the callout carries no button of its own.
function GrievanceStage({ grievance, viewerRole }) {
  const stage = grievanceStage(grievance, actingRoleFor(grievance, viewerRole));
  const next = toNextStepProps(stage);
  const body = stage.nextAction.tone === 'done' ? undefined : next.body;

  return (
    <div className="flex flex-col gap-3">
      <FlowStepper steps={stage.steps} ariaLabel="Grievance progress" />
      <NextStep {...next} body={body} primary={undefined} />
    </div>
  );
}

function IdentitySection({ grievance, viewerRole }) {
  const redacted = !('submitted_by' in grievance);

  if (redacted) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-line bg-subtle p-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ink">Filed anonymously</p>
          <p className="mt-0.5 text-xs text-ink-muted">The filer asked to stay anonymous to your organization. This is by design and will not be revealed.</p>
        </div>
      </div>
    );
  }

  const name = filerDisplayName(grievance);

  return (
    <div className="flex items-start gap-3 rounded-card border border-line bg-subtle p-3">
      <UserRound size={18} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-ink">{formatDisplayText(name)}</p>
        {viewerRole === 'SUPER_ADMIN' && grievance.is_anonymous && (
          <p className="mt-0.5 text-xs text-ink-muted">Filed anonymously toward the organization. Handle with added discretion.</p>
        )}
      </div>
    </div>
  );
}

function ClassificationForm({ grievance, onClassify }) {
  const [urgency, setUrgency] = useState(grievance.urgency);
  const [category, setCategory] = useState(grievance.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const unchanged = urgency === grievance.urgency && category === grievance.category;

  async function save() {
    setSaving(true);
    setError('');
    try { await onClassify(grievance.id, { urgency, category }); }
    catch (err) { setError(err.response?.data?.message || 'Could not correct the classification. Try again.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Urgency">
          <Select value={urgency} onChange={(event) => setUrgency(event.target.value)} disabled={saving}>
            {URGENCY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(event) => setCategory(event.target.value)} disabled={saving}>
            {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={save} loading={saving} disabled={unchanged}>Correct classification</Button>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}

function ClassificationSection({ grievance, viewerRole, onClassify }) {
  const corrected = grievance.classification_engine === 'reviewer';

  return (
    <div className="border-t border-line pt-3">
      <p className="text-xs font-medium text-ink-muted">{corrected ? 'Classification corrected by a reviewer' : 'Suggested classification'}</p>
      {corrected && (
        <p className="mt-1 text-sm text-ink-muted">
          Machine rating: {grievance.machine_urgency} urgency, {grievance.machine_category}
          {grievance.classification_corrected_at ? `. Corrected ${relativeTime(grievance.classification_corrected_at)}.` : ''}
        </p>
      )}
      <RulesDisclosure label={corrected ? 'Why the machine rated it this way' : 'Why this classification?'} items={grievance.classification_reasoning ? [grievance.classification_reasoning] : []} />
      {viewerRole === 'SUPER_ADMIN' && onClassify && (
        <ClassificationForm key={`${grievance.id}-${grievance.urgency}-${grievance.category}`} grievance={grievance} onClassify={onClassify} />
      )}
    </div>
  );
}

function TransitionModal({ transition, onCancel, onConfirm, submitting, error }) {
  const [remarks, setRemarks] = useState('');
  if (!transition) return null;

  const label = TRANSITION_ACTION_LABEL[transition] || transition;
  const reopening = transition === 'reopen';

  return (
    <Modal
      open
      title={label}
      description={reopening ? 'The student is told this grievance is under review again, and sees your reason.' : 'These remarks are shared with the student who filed this grievance.'}
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
            disabled={!remarks.trim()}
          >
            {label}
          </Button>
        </>
      )}
    >
      <Field label="Remarks" required hint={reopening ? 'Say why it is being reopened.' : 'Explain the outcome in plain language.'}>
        <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={4} placeholder={reopening ? 'What changed, and what will be looked at again...' : 'What was found, and what happens next...'} />
      </Field>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error}</p>}
    </Modal>
  );
}

export default function GrievanceDetailDrawer({ grievance, viewerRole, onClose, onTransition, onClassify, onDeleted }) {
  const [pendingTransition, setPendingTransition] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeGrievanceId, setActiveGrievanceId] = useState(grievance?.id ?? null);
  if ((grievance?.id ?? null) !== activeGrievanceId) {
    setActiveGrievanceId(grievance?.id ?? null);
    setPendingTransition(null);
    setError('');
    setDeleteOpen(false);
  }

  async function confirmDelete() {
    setSubmitting(true); setError('');
    try { await deleteGrievance(grievance.id); setDeleteOpen(false); onDeleted?.(); onClose(); }
    catch (err) { setError(err.response?.data?.message || 'Could not delete this closed grievance.'); }
    finally { setSubmitting(false); }
  }

  function closeTransition() {
    if (submitting) return;
    setPendingTransition(null);
    setError('');
  }

  function chooseTransition(status) {
    if (status === 'under_review') {
      confirmTransition(status);
      return;
    }
    setPendingTransition(status);
  }

  async function confirmTransition(status, remarks) {
    setSubmitting(true);
    setError('');
    try {
      await onTransition(grievance.id, { status: status === 'reopen' ? 'under_review' : status, remarks: remarks || undefined });
      setPendingTransition(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update this grievance. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const allowed = grievance ? (ALLOWED_TRANSITIONS[grievance.status] || []) : [];
  const isTerminal = grievance && allowed.length === 0;
  const canReopen = isTerminal && viewerRole === 'SUPER_ADMIN';

  return (
    <>
      <Drawer open={Boolean(grievance)} title={formatDisplayText(grievance?.title)} description={grievance ? `Filed ${relativeTime(grievance.created_at)}` : undefined} onClose={onClose}>
        {grievance && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={grievance.status} tone={grievanceStatusTone(grievance.status)} />
              <StatusBadge tone={urgencyTone(grievance.urgency)} label={grievance.classification_engine === 'reviewer' ? `${grievance.urgency} urgency` : `Suggested urgency: ${grievance.urgency}`} />
              <StatusBadge tone="neutral" label={grievance.classification_engine === 'reviewer' ? grievance.category : `Suggested category: ${grievance.category}`} />
            </div>

            <ClassificationSection grievance={grievance} viewerRole={viewerRole} onClassify={onClassify} />

            <GrievanceStage grievance={grievance} viewerRole={viewerRole} />

            <IdentitySection grievance={grievance} viewerRole={viewerRole} />

            <div>
              <p className="text-xs font-medium text-ink-muted">Addressed to</p>
              <p className="mt-1 text-sm text-ink">{addressedToLabel(grievance)}</p>
            </div>

            <div>
              <p className="text-xs font-medium text-ink-muted">Description</p>
              <RichTextBody value={grievance.description} className="mt-1 text-sm leading-6 text-ink" />
            </div>

            <div>
              <p className="text-xs font-medium text-ink-muted">Filed</p>
              <p className="mt-1 text-sm text-ink-muted">{manilaDate(grievance.created_at, 'weekday')}</p>
            </div>

            {grievance.remarks && (
              <div className="border-t border-line pt-3">
                <p className="text-xs font-medium text-ink-muted">Remarks</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{grievance.remarks}</p>
              </div>
            )}

            {isTerminal ? (
              <div className="space-y-3">
                <p className="text-xs text-ink-muted">{canReopen ? 'This grievance is closed. Reopen it if there are new facts, or delete it from the register.' : 'This grievance is closed and cannot be reopened.'}</p>
                <div className="flex flex-wrap gap-2">
                  {canReopen && <Button variant="secondary" size="sm" onClick={() => chooseTransition('reopen')} disabled={submitting}>{TRANSITION_ACTION_LABEL.reopen}</Button>}
                  <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>Delete closed grievance</Button>
                </div>
              </div>
            ) : (
              <div className="border-t border-line pt-4">
                <p className="text-xs font-medium text-ink-muted">Update status</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allowed.map((status, index) => (
                    <Button
                      key={status}
                      variant={index === 0 && status !== 'dismissed' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => chooseTransition(status)}
                      disabled={submitting}
                    >
                      {TRANSITION_ACTION_LABEL[status]}
                    </Button>
                  ))}
                </div>
                {!pendingTransition && error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error}</p>}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <TransitionModal
        key={`${grievance?.id ?? 'none'}-${pendingTransition ?? 'closed'}`}
        transition={pendingTransition}
        onCancel={closeTransition}
        onConfirm={confirmTransition}
        submitting={submitting}
        error={error}
      />
      <Modal open={deleteOpen} title="Delete closed grievance?" description="Remove this closed case from the review register? Historical evidence and the student's own record are preserved." onClose={submitting ? undefined : () => { setDeleteOpen(false); setError(''); }} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-md" footer={<><Button variant="secondary" disabled={submitting} onClick={() => { setDeleteOpen(false); setError(''); }}>Cancel</Button><Button variant="danger" loading={submitting} onClick={confirmDelete}>Delete closed grievance</Button></>}>
        {error && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
      </Modal>
    </>
  );
}
