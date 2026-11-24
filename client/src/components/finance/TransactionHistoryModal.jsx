import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '../ui/Button';
import { SkeletonText } from '../ui/Skeleton';
import Modal from '../Modal';
import { getTransactionHistory } from '../../services/financeService';
import { getApiErrorMessage } from '../../utils/apiError';
import { manilaDate, manilaTime } from '../../lib/format';

const ACTION_LABELS = { created: 'Recorded', updated: 'Edited', archived: 'Archived' };

function when(value) {
  const date = manilaDate(value);
  if (!date) return '';
  return `${date}, ${manilaTime(value)}`;
}

function shown(value) {
  return value === null || value === undefined || value === '' ? 'Empty' : String(value);
}

// Who changed an entry, when, why, and each field from its old value to its new one. Newest first, as the server sends it.
export default function TransactionHistoryModal({ transaction, onClose }) {
  const [state, setState] = useState({ status: 'loading', entries: [], message: '' });

  const load = useCallback(() => {
    setState({ status: 'loading', entries: [], message: '' });
    getTransactionHistory(transaction.id)
      .then((response) => setState({ status: 'ready', entries: Array.isArray(response.data?.data) ? response.data.data : [], message: '' }))
      .catch((failure) => setState({ status: 'error', entries: [], message: getApiErrorMessage(failure, 'The history could not be loaded.') }));
  }, [transaction.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <Modal
      open
      title="Transaction history"
      description={transaction.description || `Transaction ${transaction.id}`}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {state.status === 'loading' && <SkeletonText lines={4} />}
      {state.status === 'error' && (
        <div className="space-y-3">
          <p role="alert" className="text-sm font-semibold text-danger-strong">{state.message}</p>
          <Button variant="secondary" onClick={load}>Try again</Button>
        </div>
      )}
      {state.status === 'ready' && state.entries.length === 0 && <p className="text-sm text-ink-muted">No history is on record for this entry yet.</p>}
      {state.status === 'ready' && state.entries.length > 0 && (
        <ol className="divide-y divide-line-soft" aria-label="History">
          {state.entries.map((entry, index) => (
            <li key={`${entry.action}-${entry.at}-${index}`} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-semibold text-ink">
                {ACTION_LABELS[entry.action] || entry.action}
                <span className="font-normal text-ink-muted"> by {entry.by?.name || 'Unknown'} on {when(entry.at)}</span>
              </p>
              {entry.reason && <p className="mt-1 text-sm text-ink">Reason: {entry.reason}</p>}
              {Array.isArray(entry.changes) && entry.changes.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {entry.changes.map((change) => (
                    <li key={change.field} className="text-sm text-ink">
                      <span className="font-medium">{change.label}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-ink-muted">
                        <span className="sr-only">changed from</span>
                        <span className="min-w-0 break-words">{shown(change.from)}</span>
                        <ArrowRight size={14} aria-hidden="true" className="shrink-0" />
                        <span className="sr-only">to</span>
                        <span className="min-w-0 break-words font-medium text-ink">{shown(change.to)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
