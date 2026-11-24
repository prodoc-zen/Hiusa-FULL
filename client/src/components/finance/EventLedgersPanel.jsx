import { ChevronLeft, Plus } from 'lucide-react';
import { Button, StatusBadge } from '../ui';
import { manilaDate, peso } from '../../lib/format';
import { formatDisplayText } from '../../utils/displayText.js';
import BudgetFigures from './BudgetFigures';

const ROW = 'grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_8rem_8rem_8rem_5rem] md:items-center';

function sentence(value) {
  const text = String(value ?? '').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function eventMeta(event) {
  return [event.start_time && manilaDate(event.start_time), event.status && sentence(event.status)].filter(Boolean).join(' · ');
}

function Cell({ label, children, className = '' }) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-muted md:sr-only">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{children}</dd>
    </div>
  );
}

function LedgerFigures({ row }) {
  return (
    <dl className="contents">
      <Cell label="Income"><span className="text-success-strong">{peso(row.income)}</span></Cell>
      <Cell label="Expenses">{peso(row.expense)}</Cell>
      <Cell label="Net">{peso(row.net)}</Cell>
      <Cell label="Transactions">{Number(row.transaction_count) || 0}</Cell>
    </dl>
  );
}

// Every event of the organization with what its own ledger holds, then the transactions that belong to no event, then
// one row that adds them all up and equals the overall ledger.
export default function EventLedgersPanel({ ledgers, onOpenEvent }) {
  const events = ledgers?.data ?? [];
  return (
    <section aria-label="Event ledgers" className="overflow-hidden rounded-card border border-line bg-surface">
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">No events in this semester yet.</p>
      ) : (
        <div aria-hidden="true" className={`hidden bg-subtle text-xs font-semibold text-ink-muted md:grid md:grid-cols-[minmax(0,1fr)_8rem_8rem_8rem_5rem] md:gap-x-4 md:px-5 md:py-2.5`}>
          <span>Event</span><span>Income</span><span>Expenses</span><span>Net</span><span>Transactions</span>
        </div>
      )}
      <ul className="divide-y divide-line" aria-label="Event ledgers">
        {events.map((event) => (
          <li key={event.event_id} className={ROW}>
            <div className="col-span-2 min-w-0 md:col-span-1">
              <button type="button" onClick={() => onOpenEvent(event)} className="min-h-[42px] rounded-control text-left text-sm font-semibold text-ink hover:underline md:min-h-0">{formatDisplayText(event.title)}</button>
              {eventMeta(event) && <p className="text-xs text-ink-muted">{eventMeta(event)}</p>}
            </div>
            <LedgerFigures row={event} />
          </li>
        ))}
        {ledgers?.unassigned && (
          <li className={ROW}>
            <div className="col-span-2 min-w-0 md:col-span-1">
              <p className="text-sm font-semibold text-ink">No event</p>
              <p className="text-xs text-ink-muted">Transactions not linked to an event</p>
            </div>
            <LedgerFigures row={ledgers.unassigned} />
          </li>
        )}
        {ledgers?.totals && (
          <li className={`${ROW} bg-subtle`}>
            <div className="col-span-2 min-w-0 md:col-span-1">
              <p className="text-sm font-semibold text-ink">All events</p>
              <p className="text-xs text-ink-muted">The same totals as All transactions</p>
            </div>
            <LedgerFigures row={ledgers.totals} />
          </li>
        )}
      </ul>
    </section>
  );
}

// One event's own ledger sits under this: who it belongs to, what it holds in total, what its budget stands at.
export function EventLedgerHeader({ ledger, budget, onBack, onRecordTransaction }) {
  const eventBudget = budget ?? ledger.budget;
  const meta = eventMeta(ledger);
  return (
    <section aria-label="Event ledger" className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-[42px] items-center gap-1 rounded-control px-1 text-sm font-semibold text-brand-700 hover:text-brand-800 md:min-h-8">
            <ChevronLeft size={16} aria-hidden="true" /> All events
          </button>
          <h2 className="mt-1 text-lg font-semibold text-ink">{formatDisplayText(ledger.title)}</h2>
          {meta && <p className="text-xs text-ink-muted">{meta}</p>}
        </div>
        {onRecordTransaction && (
          <Button leftIcon={Plus} onClick={() => onRecordTransaction({ eventId: ledger.event_id, lockEvent: true })}>Record transaction</Button>
        )}
      </div>

      <dl aria-label="Event totals" className="grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs font-medium text-ink-muted">Income</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-success-strong">{peso(ledger.income)}</dd></div>
        <div><dt className="text-xs font-medium text-ink-muted">Expenses</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{peso(ledger.expense)}</dd></div>
        <div><dt className="text-xs font-medium text-ink-muted">Net</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{peso(ledger.net)}</dd></div>
        <div><dt className="text-xs font-medium text-ink-muted">Transactions</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{Number(ledger.transaction_count) || 0}</dd></div>
      </dl>

      <section aria-label="Event budget" className="border-t border-line pt-4">
        {eventBudget ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink">{formatDisplayText(eventBudget.title)}</p>
              {eventBudget.submission_status !== 'approved' && <StatusBadge status={eventBudget.submission_status === 'draft' ? 'draft' : eventBudget.approval_status || 'pending'} />}
            </div>
            <BudgetFigures budget={eventBudget} />
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No budget yet</p>
        )}
      </section>
    </section>
  );
}

// The Budgets tab's "Event budgets": every event, with its budget card, or the plain fact that it has none and, for
// someone who can create budgets, the way to start one for that event.
export function EventBudgetsList({ rows, renderBudget, canCreateBudget, onCreateBudget }) {
  return (
    <ul className="divide-y divide-line" aria-label="Event budgets">
      {rows.map((row) => (
        <li key={row.event_id} className="p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{formatDisplayText(row.title)}</p>
            {eventMeta(row) && <p className="text-xs text-ink-muted">{eventMeta(row)}</p>}
          </div>
          {row.budget ? (
            <div className="mt-3">{renderBudget(row.budget)}</div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-muted">No budget yet</p>
              {canCreateBudget && <Button size="sm" variant="secondary" leftIcon={Plus} className="max-sm:h-[42px]" onClick={() => onCreateBudget(row.event_id)}>Create budget</Button>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
