import { useState } from 'react';
import { CircleCheck, PauseCircle } from 'lucide-react';
import { Button, Field, StatusBadge, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import TableRowActions from '../../../components/TableRowActions';
import { clearanceStatusTone } from './clearanceLabels';

export default function SignAction({ signatureId, status, remarks, roleLabel, onSign, showStatus = true }) {
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
      setMode(null);
      setRemarksDraft('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this signature. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {showStatus && <StatusBadge status={status} tone={clearanceStatusTone(status)} />}
      {status !== 'cleared' && <TableRowActions subject={roleLabel} actions={[
        { label: status === 'held' ? 'Clear hold' : 'Clear', icon: CircleCheck, onClick: () => setMode('clear') },
        status === 'pending' && { label: 'Hold', icon: PauseCircle, danger: true, onClick: () => setMode('hold') },
      ]} />}
      {showStatus && status === 'held' && remarks && <p className="text-xs font-medium text-ink-muted">Reason: {remarks}</p>}

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
