import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import AccessibleOverlay from '../AccessibleOverlay';
import ConfirmModal from '../ConfirmModal';
import { approveCashAdvance, createCashAdvance, getCashAdvances, releaseCashAdvance, repayCashAdvance } from '../../services/financeService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/dateTime';
import { peso } from '../../lib/format';
import notify from '../../lib/notify';
import { Button, Field, Input, StatusBadge, Textarea } from '../ui';

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

function Dialog({ label, onClose, onSubmit, children, submitLabel, busy, error }) {
  return (
    <AccessibleOverlay label={label} onClose={() => !busy && onClose()} className="fixed inset-0 z-50 grid place-items-center bg-navy-950/50 p-4">
      <form onSubmit={onSubmit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-bold text-ink">{label}</h2>
        <div className="mt-4 space-y-4">{children}</div>
        {error && <p role="alert" className="mt-4 text-sm font-semibold text-danger-strong">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </AccessibleOverlay>
  );
}

/**
 * Cash advances end to end: an admin requests one, a different admin approves
 * it, releasing it posts an expense to the ledger, and each repayment posts
 * income until the balance is cleared.
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
    const done = await run(`release-${target.id}`, () => releaseCashAdvance(target.id), 'Funds released and recorded as an expense', { ledger: true });
    if (done) setReleaseTarget(null);
  }

  function rowAction(advance) {
    if (advance.status === 'pending') {
      return advance.borrower_id === me
        ? <p className="max-w-48 text-xs font-medium text-ink-muted sm:text-right">Another admin approves your request.</p>
        : <Button size="sm" variant="secondary" loading={busy === `approve-${advance.id}`} onClick={() => run(`approve-${advance.id}`, () => approveCashAdvance(advance.id), 'Cash advance approved')}>Approve</Button>;
    }
    if (advance.status === 'approved') {
      return <Button size="sm" variant="secondary" onClick={() => setReleaseTarget(advance)}>Release funds</Button>;
    }
    if (['released', 'partially_repaid'].includes(advance.status)) {
      return <Button size="sm" variant="secondary" onClick={() => { setFormError(''); setRepayment(EMPTY_REPAYMENT); setRepayTarget(advance); }}>Record repayment</Button>;
    }
    return null;
  }

  return (
    <section aria-labelledby="cash-advances-title" className="rounded-lg border border-[#DDE7EF] bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#DDE7EF] p-4 sm:p-5">
        <div>
          <h2 id="cash-advances-title" className="text-base font-bold text-[#0F172A]">Cash advances</h2>
          <p className="mt-1 text-xs text-slate-600">Releasing an advance posts an expense; each repayment posts income. A different admin approves every request.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-600">
            <span className="block">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm text-[#0F172A]">
              {STATUS_FILTERS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
          </label>
          <Button variant="secondary" onClick={() => { setFormError(''); setRequestOpen(true); }}><Plus size={16} aria-hidden="true" /> Request cash advance</Button>
        </div>
      </div>

      {state.loading && state.rows.length === 0 && (
        <div className="space-y-2 p-4 sm:p-5" role="status" aria-label="Loading cash advances">
          {[0, 1].map((key) => <div key={key} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      )}
      {state.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <p role="alert" className="text-sm font-semibold text-[#B91C1C]">{state.error}</p>
          <Button variant="secondary" size="sm" onClick={load}>Try again</Button>
        </div>
      )}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <p className="p-8 text-center text-sm text-slate-600">
          {status ? 'No cash advances with this status.' : 'No cash advances yet. Request one when an officer needs funds before an event; another admin approves it.'}
        </p>
      )}
      {state.rows.length > 0 && (
        <ul className="divide-y divide-[#DDE7EF]">
          {state.rows.map((advance) => (
            <li key={advance.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="line-clamp-2 break-words text-sm font-bold text-[#0F172A]">{advance.purpose}</h3>
                  <StatusBadge status={advance.status} />
                </div>
                <p className="mt-1 text-xs font-medium text-slate-600">{advance.reference} · requested by {borrowerName(advance)} · {formatDateTime(advance.created_at)}</p>
                <p className="mt-1 text-xs font-medium text-slate-600">
                  {peso(advance.amount)} advanced · {peso(advance.amount_repaid)} repaid · <span className="font-semibold text-[#0F172A]">{peso(advance.remaining_balance)} outstanding</span>
                </p>
              </div>
              <div className="shrink-0">{rowAction(advance)}</div>
            </li>
          ))}
        </ul>
      )}

      {requestOpen && (
        <Dialog label="Request cash advance" onClose={() => setRequestOpen(false)} onSubmit={submitRequest} submitLabel="Submit request" busy={busy === 'request'} error={formError}>
          <Field label="Amount (PHP)" required>
            <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={request.amount} onChange={(event) => setRequest({ ...request, amount: event.target.value })} />
          </Field>
          <Field label="Purpose" required hint="What the money is for, so the approver can judge it.">
            <Textarea rows={3} maxLength={2000} value={request.purpose} onChange={(event) => setRequest({ ...request, purpose: event.target.value })} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} maxLength={2000} value={request.notes} onChange={(event) => setRequest({ ...request, notes: event.target.value })} />
          </Field>
        </Dialog>
      )}

      {repayTarget && (
        <Dialog label="Record repayment" onClose={() => setRepayTarget(null)} onSubmit={submitRepayment} submitLabel="Record repayment" busy={busy === 'repay'} error={formError}>
          <p className="text-sm text-slate-600">{repayTarget.reference} · {borrowerName(repayTarget)} · <span className="font-semibold text-[#0F172A]">{peso(repayTarget.remaining_balance)} outstanding</span></p>
          <Field label="Amount repaid (PHP)" required>
            <Input type="number" min="0.01" step="0.01" max={repayTarget.remaining_balance} inputMode="decimal" value={repayment.amount} onChange={(event) => setRepayment({ ...repayment, amount: event.target.value })} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} maxLength={2000} value={repayment.notes} onChange={(event) => setRepayment({ ...repayment, notes: event.target.value })} />
          </Field>
        </Dialog>
      )}

      <ConfirmModal
        open={Boolean(releaseTarget)}
        title="Release funds"
        message={releaseTarget ? `${peso(releaseTarget.amount)} leaves the ledger as a cash advance expense for ${borrowerName(releaseTarget)}. Repayments come back as income.` : ''}
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
