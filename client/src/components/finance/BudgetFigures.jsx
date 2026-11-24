import { peso } from '../../lib/format';

const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;
const plain = (value) => peso(value).replace('₱', '');

// The four numbers of a budget, read from the server row. Spent and income count the entries linked to it whatever its
// status, so a budget sent back for approval keeps what it already spent. Only an approved budget is released, which says
// whether more can be spent from it. Income posted to a budget raises Remaining. A row that carries no spent figure has
// no breakdown to show, and an unapproved one then reads as untouched.
export function budgetFigures(budget) {
  const allocated = cents(budget.allocated_amount);
  const released = budget.is_released ?? budget.submission_status === 'approved';
  const hasSpent = budget.spent_amount != null;
  if (!released && !hasSpent) return { released: false, hasBreakdown: false, hasEntries: false, allocated, spent: 0, income: 0, remaining: allocated };

  const remaining = cents(budget.remaining_amount);
  const spent = cents(budget.spent_amount);
  const income = budget.income_amount != null ? cents(budget.income_amount) : cents(remaining - allocated + spent);
  const hasEntries = spent !== 0 || income !== 0;
  return { released, hasBreakdown: hasSpent && (released || hasEntries), hasEntries, allocated, spent, income, remaining };
}

export default function BudgetFigures({ budget, size = 'sm', className = '' }) {
  const figures = budgetFigures(budget);
  const items = figures.hasBreakdown
    ? [['Allocated', figures.allocated], ['Spent', figures.spent], ['Income', figures.income], ['Remaining', figures.remaining]]
    : [['Allocated', figures.allocated], ['Remaining', figures.remaining]];
  const large = size === 'md';

  return (
    <div className={className}>
      <dl className={`grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-8 ${large ? 'text-sm' : 'text-xs'}`}>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className={large ? 'text-xs font-semibold text-ink-muted-strong' : 'text-ink-muted'}>{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">{peso(value)}</dd>
          </div>
        ))}
      </dl>
      {!figures.released && (
        <p className="mt-2 text-xs text-ink-muted">
          {figures.hasEntries ? 'Sent back for approval. Nothing more can be spent until it is approved again.' : 'Not released until approved. Nothing can be spent from it yet.'}
        </p>
      )}
      {figures.hasBreakdown && (
        <p className="mt-2 text-xs tabular-nums text-ink-muted">
          {`${plain(figures.allocated)} allocated - ${plain(figures.spent)} spent + ${plain(figures.income)} income = ${plain(figures.remaining)} remaining`}
        </p>
      )}
    </div>
  );
}
