import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import RulesDisclosure from '../ai/RulesDisclosure';
import { relativeTime } from '../../lib/format';

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatInputValue(value) {
  if (typeof value === 'number') return value.toLocaleString('en-PH');
  return String(value);
}

function whyItems(why) {
  if (!why) return [];
  const items = [];
  const inputEntries = Object.entries(why.inputs || {});
  if (inputEntries.length > 0) {
    items.push(`Based on ${inputEntries.map(([key, value]) => `${humanizeKey(key).toLowerCase()} (${formatInputValue(value)})`).join(', ')}.`);
  }
  if (items.length === 0) items.push('Based on your organization records.');
  return items;
}

/**
 * ELEVATION_SPEC section 6, step 4: one suggestion from a deterministic engine, with the paper's
 * XAI promise made concrete through the existing RulesDisclosure ("Why?"). Wording from the API is
 * always advisory; this component never adds a call to action beyond an optional deep link.
 */
export default function AiInsightCard({ insight }) {
  return (
    <article className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <h3 className="text-sm font-semibold text-ink">{insight.title}</h3>
      <p className="max-w-3xl text-sm leading-6 text-ink-muted">{insight.body}</p>
      <RulesDisclosure label="Why am I seeing this?" items={whyItems(insight.why)} />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {insight.href && (
          <Link to={insight.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Open <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
        {insight.generated_at && (
          <span className="text-xs text-ink-muted">Noticed {relativeTime(insight.generated_at)}</span>
        )}
      </div>
    </article>
  );
}
