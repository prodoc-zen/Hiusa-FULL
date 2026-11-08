import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Plus } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { approveCashAdvance, createCashAdvance, getCashAdvances, releaseCashAdvance, repayCashAdvance } from '../../services/financeService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/dateTime';
import { peso } from '../../lib/format';
import notify from '../../lib/notify';
import TableRowActions from '../TableRowActions';
import { Button, Drawer, EmptyState, ErrorState, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '../ui';

const STATUS_FILTERS = [
  ['', 'All statuses'],
  ['pending', 'Awaiting approval'],
  ['approved', 'Approved, not released'],
  ['released', 'Released'],
  ['partially_repaid', 'Partially repaid'],
  ['fully_repaid', 'Fully repaid'],
];
const EMPTY_REQUEST = { amount: '', purpose: '', notes: '' };
const EMPTY_REPAYMENT = { amount: '', notes: '' };

function currentSchoolId() {
  try { return JSON.parse(localStorage.getItem('user') ?? '{}')?.school_id ?? null; } catch { return null; }
}

function borrowerName(advance) {
  return advance.borrower ? `${advance.borrower.first_name} ${advance.borrower.last_name}` : `School ID ${advance.borrower_id}`;
}

// A short form opens in a drawer; the modal is kept for the destructive confirm only.
function Dialog({ label, onClose, onSubmit, children, submitLabel, busy, error }) {
  const formId = `${label.toLowerCase().replace(/\s+/g, '-')}-form`;
  return (
    <Drawer
      open
      title={label}
      onClose={() => !busy && onClose()}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form={formId} loading={busy}>{submitLabel}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-4">
        {children}
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </form>
    </Drawer>
  );
}

/**
 * Cash advances end to end: an admin requests one, a different admin approves
 * it, releasing it moves cash out of the ledger, and each repayment moves it
 * back in until the balance is cleared. None of it is income or expense.
 */
export default function CashAdvancesSection({ onLedgerChange }) {
  const [status, setStatus] = useState('');
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const [requestOpen, setRequestOpen] = useState(false);
  const [request, setRequest] = useState(EMPTY_REQUEST);
  const [repayTarget, setRepayTarget] = useState(null);
  const [repayment, setRepayment] = useState(EMPTY_REPAYMENT);
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [busy, setBusy] = useState('');
  const [formError, setFormError] = useState('');
  const me = currentSchoolId();

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const { data } = await getCashAdvances(status ? { status } : {});
      setState({ loading: false, error: '', rows: data || [] });
    } catch (cause) {
      setState({ loading: false, error: getApiErrorMessage(cause, 'Cash advances could not load.'), rows: [] });
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function run(key, action, successMessage, { inDialog = false, ledger = false } = {}) {
    setBusy(key);
    setFormError('');
    try {
      await action();
      notify.success(successMessage);
      await load();
      if (ledger) onLedgerChange?.();
      return true;
    } catch (cause) {
      const message = getApiErrorMessage(cause, 'That did not go through. Try again.');
      if (inDialog) setFormError(message);
      else notify.error(message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    const done = await run('request', () => createCashAdvance({ amount: request.amount, purpose: request.purpose.trim(), notes: request.notes.trim() || null }), 'Cash advance requested', { inDialog: true });
    if (done) {
      setRequestOpen(false);
      setRequest(EMPTY_REQUEST);
    }
  }

  async function submitRepayment(event) {
    event.preventDefault();
    const done = await run('repay', () => repayCashAdvance(repayTarget.id, { amount: repayment.amount, notes: repayment.notes.trim() || null }), 'Repayment recorded in the ledger', { inDialog: true, ledger: true });
    if (done) {
      setRepayTarget(null);
      setRepayment(EMPTY_REPAYMENT);
    }
  }

  async function confirmRelease() {
    const target = releaseTarget;
    const done = await run(`release-${target.id}`, () => releaseCashAdvance(target.id), 'Funds released from the ledger. Not counted as income or expense.', { ledger: true });
    if (done) setReleaseTarget(null);
  }

  function rowAction(advance) {
    if (advance.status === 'pending' && advance.borrower_id === me) return <p className="max-w-48 text-xs text-ink-muted sm:text-right">Another admin approves your request.</p>;
    return <TableRowActions subject={advance.purpose} actions={[
      advance.status === 'pending' && { label: 'Approve', disabled: busy === `approve-${advance.id}`, onClick: () => run(`approve-${advance.id}`, () => approveCashAdvance(advance.id), 'Cash advance approved') },
      advance.status === 'approved' && { label: 'Release funds', onClick: () => setReleaseTarget(advance) },
      ['released', 'partially_repaid'].includes(advance.status) && { label: 'Record repayment', onClick: () => { setFormError(''); setRepayment(EMPTY_REPAYMENT); setRepayTarget(advance); } },
    ]} />;
  }

  return (
    <section aria-labelledby="cash-advances-title" className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4 sm:p-5">
        <div>
          <h2 id="cash-advances-title" className="text-base font-semibold text-ink">Cash advances</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-muted">Advances move cash in the ledger but are not counted as income or expense in reports and forecasts. A different admin approves every request.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[13px] font-medium text-ink">
            <span className="block">Status</span>
            <Select filter value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 w-56 max-w-full">
              {STATUS_FILTERS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </Select>
          </label>
          <Button variant="secondary" leftIcon={Plus} onClick={() => { setFormError(''); setRequestOpen(true); }}>Request cash advance</Button>
        </div>
      </div>

      {state.loading && state.rows.length === 0 && (
        <div className="divide-y divide-line-soft" role="status" aria-label="Loading cash advances">
          {[0, 1, 2].map((key) => <div key={key} className="flex items-center gap-4 p-4 sm:px-5"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/4" /></div>)}
        </div>
      )}
      {state.error && <div className="px-4 sm:px-5"><ErrorState title="Cash advances did not load" description={state.error} onRetry={load} /></div>}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <div className="px-4 sm:px-5">
          {status ? (
            <EmptyState kind="filtered" title="No cash advances with this status" description="Show every status to see the rest." onClearFilters={() => setStatus('')} />
          ) : (
            <EmptyState
              icon={HandCoins}
              title="No cash advances yet"
              description="A cash advance lends the organization's money to an officer before an event. Choose Request cash advance above; a different admin approves it, and repayments return the money to the ledger."
            />
          )}
        </div>
      )}
      {state.rows.length > 0 && (
        <ul className="divide-y divide-line" aria-label="Cash advances">
          {state.rows.map((advance) => (
            <li key={advance.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="line-clamp-2 break-words text-sm font-semibold text-ink">{advance.purpose}</h3>
                  <StatusBadge status={advance.status} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{advance.reference} · requested by {borrowerName(advance)} · {formatDateTime(advance.created_at)}</p>
                <p className="mt-1 text-xs tabular-nums text-ink-muted">
                  {peso(advance.amount)} advanced · {peso(advance.amount_repaid)} repaid · <span className="font-semibold text-ink">{peso(advance.remaining_balance)} outstanding</span>
                </p>
              </div>
              <div className="shrink-0">{rowAction(advance)}</div>
            </li>
          ))}
        </ul>
      )}

      {requestOpen && (
        <Dialog label="Request cash advance" onClose={() => setRequestOpen(false)} onSubmit={submitRequest} submitLabel="Send request" busy={busy === 'request'} error={formError}>
          <Field label="Amount (PHP)" required>
            <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={request.amount} onChange={(event) => setRequest({ ...request, amount: event.target.value })} />
          </Field>
          <Field label="Purpose" required hint="What the money is for, so the approver can judge it.">
            <Textarea rows={3} maxLength={2000} value={request.purpose} onChange={(event) => setRequest({ ...request, purpose: event.target.value })} />
          </Field>
          <Field label="Notes" optional>
            <Textarea rows={2} maxLength={2000} value={request.notes} onChange={(event) => setRequest({ ...request, notes: event.target.value })} />
          </Field>
        </Dialog>
      )}

      {repayTarget && (
        <Dialog label="Record repayment" onClose={() => setRepayTarget(null)} onSubmit={submitRepayment} submitLabel="Record repayment" busy={busy === 'repay'} error={formError}>
          <p className="text-sm text-ink-muted">{repayTarget.reference} · {borrowerName(repayTarget)} · <span className="font-semibold text-ink">{peso(repayTarget.remaining_balance)} outstanding</span></p>
          <Field label="Amount repaid (PHP)" required>
            <Input type="number" min="0.01" step="0.01" max={repayTarget.remaining_balance} inputMode="decimal" value={repayment.amount} onChange={(event) => setRepayment({ ...repayment, amount: event.target.value })} />
          </Field>
          <Field label="Notes" optional>
            <Textarea rows={2} maxLength={2000} value={repayment.notes} onChange={(event) => setRepayment({ ...repayment, notes: event.target.value })} />
          </Field>
        </Dialog>
      )}

      <ConfirmModal
        open={Boolean(releaseTarget)}
        title="Release funds"
        message={releaseTarget ? `${peso(releaseTarget.amount)} leaves the ledger as a cash advance for ${borrowerName(releaseTarget)}. Repayments come back in, and neither is counted as income or expense.` : ''}
        recordName={releaseTarget?.reference}
        confirmText="Release funds"
        variant="primary"
        busy={Boolean(releaseTarget) && busy === `release-${releaseTarget.id}`}
        onCancel={() => !busy && setReleaseTarget(null)}
        onConfirm={confirmRelease}
      />
    </section>
  );
}
