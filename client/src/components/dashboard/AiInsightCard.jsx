import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import EngineBadge from '../ai/EngineBadge';
import RulesDisclosure from '../ai/RulesDisclosure';
import { relativeTime } from '../../lib/format';

const ENGINE_NAMES = {
  budget_advisory: 'Budget advisory engine',
  financial_forecast: 'OLS forecasting engine',
  task_workload_balance: 'Task workload engine',
  election_turnout_pace: 'Election turnout engine',
};

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInputValue(value) {
  if (typeof value === 'number') return value.toLocaleString('en-PH');
  return String(value);
}

function whyItems(why) {
  if (!why) return [];
  const items = [`Method: ${why.method}`];
  const inputEntries = Object.entries(why.inputs || {});
  if (inputEntries.length > 0) {
    items.push(`Inputs: ${inputEntries.map(([key, value]) => `${humanizeKey(key)}: ${formatInputValue(value)}`).join(', ')}`);
  }
  if (why.formula) items.push(`Formula: ${why.formula}`);
  return items;
}

/**
 * ELEVATION_SPEC section 6, step 4: one "What HIUSA noticed" insight from a
 * deterministic engine, with the paper's XAI promise made concrete through
 * the existing EngineBadge + RulesDisclosure ("Why?") pair. Wording from the
 * API is always advisory; this component never adds a call to action beyond
 * an optional deep link.
 */
export default function AiInsightCard({ insight }) {
  return (
    <article className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{insight.title}</h3>
        <EngineBadge engine={ENGINE_NAMES[insight.engine] || insight.engine} />
      </div>
      <p className="max-w-3xl text-sm font-medium leading-6 text-ink-muted">{insight.body}</p>
      <RulesDisclosure label="Why?" items={whyItems(insight.why)} />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {insight.href && (
          <Link to={insight.href} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline">
            Open <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
        {insight.generated_at && (
          <span className="text-xs font-medium text-ink-muted">Noticed {relativeTime(insight.generated_at)}</span>
        )}
      </div>
    </article>
  );
}
