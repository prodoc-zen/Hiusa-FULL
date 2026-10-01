import { useState } from 'react';
import { Button, Field, StatusBadge, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import { clearanceStatusTone } from './clearanceLabels';

export default function SignAction({ signatureId, status, remarks, roleLabel, onSign, size = 'sm' }) {
  const [mode, setMode] = useState(null);
  const [remarksDraft, setRemarksDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function close() {
    if (submitting) return;
    setMode(null);
    setRemarksDraft('');
    setError('');
  }

  async function confirm() {
    setSubmitting(true);
    setError('');
    try {
      await onSign(mode === 'hold' ? 'held' : 'cleared', mode === 'hold' ? remarksDraft.trim() : undefined);
      close();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this signature. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={status} tone={clearanceStatusTone(status)} />
      {status !== 'cleared' && (
        <div className="flex gap-1.5">
          <Button size={size} variant="primary" onClick={() => setMode('clear')}>{status === 'held' ? 'Clear hold' : 'Clear'}</Button>
          {status === 'pending' && <Button size={size} variant="secondary" onClick={() => setMode('hold')}>Hold</Button>}
        </div>
      )}
      {status === 'held' && remarks && <p className="basis-full text-xs font-medium text-ink-muted">Reason: {remarks}</p>}

      <Modal
        open={Boolean(mode)}
        title={mode === 'hold' ? `Hold ${roleLabel}` : `Clear ${roleLabel}`}
        description={mode === 'hold'
          ? 'The student will see this reason and who to follow up with.'
          : 'The student will be notified that this line is cleared.'}
        onClose={submitting ? undefined : close}
        closeOnBackdrop={!submitting}
        closeOnEscape={!submitting}
        maxWidth="max-w-md"
        footer={(
          <>
            <Button variant="secondary" onClick={close} disabled={submitting}>Cancel</Button>
            <Button
              variant={mode === 'hold' ? 'danger' : 'primary'}
              onClick={confirm}
              loading={submitting}
              disabled={mode === 'hold' && !remarksDraft.trim()}
            >
              {mode === 'hold' ? 'Hold this signature' : 'Confirm clear'}
            </Button>
          </>
        )}
      >
        {mode === 'hold' && (
          <Field label="Reason" required hint="Tell the student what needs to be resolved.">
            <Textarea value={remarksDraft} onChange={(event) => setRemarksDraft(event.target.value)} rows={3} placeholder="e.g. Unpaid organization dues" />
          </Field>
        )}
        {mode === 'clear' && signatureId && (
          <p className="text-sm font-medium text-ink-muted">Signing as the {roleLabel} signatory for this student.</p>
        )}
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error}</p>}
      </Modal>
    </div>
  );
}
