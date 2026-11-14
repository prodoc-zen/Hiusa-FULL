import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, StatusBadge } from '../ui';

const HIGHLIGHT_TONE_STYLES = {
  danger: 'text-danger-strong',
  warning: 'text-warning-strong',
  success: 'text-success-strong',
  primary: 'text-navy-800',
  info: 'text-brand-700',
  neutral: 'text-ink',
};

const BAR_TONE_STYLES = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  primary: 'bg-brand-600',
  info: 'bg-brand-600',
  neutral: 'bg-ink-soft',
};

// The server names tones the old way; the badge knows info, not primary.
const BADGE_TONES = { primary: 'info' };

const OPEN_ROW_LIMIT = 6;

// The server writes counts as "3 item(s)". Show "3 items" or "1 item" instead.
function plainText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(\d[\d,]*)((?:\s+[A-Za-z-]+){0,3}?)\s+([A-Za-z]+)\(s\)/g, (_match, count, middle, noun) => {
      const singular = Number(count.replace(/,/g, '')) === 1;
      return `${count}${middle} ${noun}${singular ? '' : 's'}`;
    })
    .replace(/\(s\)/g, 's');
}

// Server titles arrive in Title Case. Keep acronyms, lowercase the rest.
function sentenceCase(value) {
  if (typeof value !== 'string') return value;
  return plainText(value)
    .split(' ')
    .map((word, index) => {
      if (index === 0) return word;
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (letters.length > 1 && letters === letters.toUpperCase()) return word;
      if (/[a-z][A-Z]/.test(word)) return word;
      return word.charAt(0).toLowerCase() + word.slice(1);
    })
    .join(' ');
}

const list = (value) => (Array.isArray(value) ? value : []);

function RowActions({ row, onAsk, disabled }) {
  if (row.href) {
    return (
      <Button to={row.href} variant="secondary" size="sm" className="max-sm:h-11" disabled={disabled}>
        {row.action_label || 'Open'}
      </Button>
    );
  }
  if (row.ask_question && onAsk) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="max-sm:h-11"
        disabled={disabled}
        onClick={() => onAsk(row.ask_question, 'how_to_guide')}
      >
        Show steps
      </Button>
    );
  }
  return null;
}

function StepsRows({ section, rows, onAsk, disabled }) {
  return (
    <ol aria-label={sentenceCase(section.title)} className="divide-y divide-line-soft">
      {rows.map((row, idx) => (
        <li
          key={row.id || idx}
          className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white"
            >
              {row.step || idx + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{plainText(row.primary)}</span>
                {row.meta && (
                  <span className="text-xs text-ink-muted-strong tabular-nums">{plainText(row.meta)}</span>
                )}
              </div>
              {row.secondary && (
                <p className="text-xs leading-relaxed text-ink-muted-strong">{plainText(row.secondary)}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
            {row.href && (
              <Button to={row.href} variant="secondary" size="sm" className="max-sm:h-11" disabled={disabled}>
                {row.action_label || 'Go to page'}
              </Button>
            )}
            {row.ask_question && onAsk && (
              <Button
                variant="secondary"
                size="sm"
                className="max-sm:h-11"
                disabled={disabled}
                onClick={() => onAsk(row.ask_question, 'how_to_guide')}
              >
                Show steps
              </Button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TableRows({ section, rows, onAsk, disabled }) {
  return (
    <table className="block w-full text-left text-sm sm:table">
      <caption className="sr-only">{sentenceCase(section.title)}</caption>
      <thead className="hidden bg-subtle sm:table-header-group">
        <tr className="border-b border-line text-ink-muted">
          <th scope="col" className="px-3 py-2 text-xs font-semibold">Record</th>
          <th scope="col" className="px-3 py-2 text-xs font-semibold">Details</th>
          <th scope="col" className="px-3 py-2 text-xs font-semibold">Status</th>
          <th scope="col" className="px-3 py-2 text-xs font-semibold">Count</th>
          <th scope="col" className="px-3 py-2 text-right text-xs font-semibold">Action</th>
        </tr>
      </thead>
      <tbody className="block divide-y divide-line sm:table-row-group">
        {rows.map((row, idx) => {
          const cell = 'px-3 py-0 max-sm:px-0 max-sm:empty:hidden sm:table-cell sm:py-2.5';

          return (
            <tr
              key={row.id || idx}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 hover:bg-subtle sm:table-row sm:py-0"
            >
              <td data-label="Record" className={`${cell} font-medium text-ink max-sm:col-span-2 max-sm:row-start-1`}>
                {plainText(row.primary)}
              </td>
              <td data-label="Details" className={`${cell} text-xs text-ink-muted-strong max-sm:col-span-3 max-sm:row-start-2 sm:text-sm`}>
                {plainText(row.secondary) || ''}
              </td>
              <td data-label="Status" className={`${cell} max-sm:row-start-3 max-sm:self-center`}>
                {row.status ? (
                  <StatusBadge tone={BADGE_TONES[row.status_tone] || row.status_tone || 'neutral'} label={plainText(row.status)} />
                ) : ''}
              </td>
              <td data-label="Count" className={`${cell} tabular-nums text-ink max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-3 max-sm:self-center max-sm:text-xs`}>
                {plainText(row.meta) || ''}
              </td>
              <td className={`${cell} max-sm:col-start-3 max-sm:row-start-1 sm:text-right`}>
                <RowActions row={row} onAsk={onAsk} disabled={disabled} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SectionDisclosure({ section, defaultOpen, onAsk, disabled }) {
  const [open, setOpen] = useState(defaultOpen);
  const rows = list(section.rows);
  const title = sentenceCase(section.title) || 'Records';

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group border-t border-line pt-3 first:border-t-0 first:pt-0"
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-control [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-ink-muted transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs font-medium text-ink-muted-strong">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
        </span>
      </summary>
      {section.description && (
        <p className="mt-1 text-xs text-ink-muted-strong">{plainText(section.description)}</p>
      )}
      <div className="mt-2.5">
        {section.layout === 'steps'
          ? <StepsRows section={section} rows={rows} onAsk={onAsk} disabled={disabled} />
          : <TableRows section={section} rows={rows} onAsk={onAsk} disabled={disabled} />}
      </div>
    </details>
  );
}

function EmptySection({ section }) {
  return (
    <div className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{sentenceCase(section.title)}</h3>
      <p className="mt-0.5 text-sm text-ink-muted-strong">{plainText(section.empty_message)}</p>
    </div>
  );
}

function Chart({ chart }) {
  const items = list(chart.items);
  if (items.length === 0) return null;

  return (
    <div>
      {chart.title && <h3 className="mb-2 text-sm font-semibold text-ink">{sentenceCase(chart.title)}</h3>}
      <ul className="space-y-2">
        {items.map((item, idx) => {
          const percent = Math.max(0, Math.min(100, Number(item.percent) || 0));
          return (
            <li key={`${item.label}-${idx}`}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 text-ink">{plainText(item.label)}</span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">
                  {item.display_value ?? item.value}
                </span>
              </div>
              <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-line-soft">
                <div
                  className={`h-full rounded-full ${BAR_TONE_STYLES[item.tone] || BAR_TONE_STYLES.neutral}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AnswerBlocks({ payload, onAsk, disabled = false }) {
  if (!payload) return null;

  const highlights = list(payload.highlights);
  const sections = list(payload.sections).filter(
    (section) => list(section.rows).length > 0 || section.empty_message,
  );
  const charts = list(payload.charts).filter((chart) => list(chart.items).length > 0);
  const recommended = payload.recommended_action?.title ? payload.recommended_action : null;
  const followUps = list(payload.follow_ups).filter((item) => item?.question);
  const firstWithRows = sections.findIndex((section) => list(section.rows).length > 0);

  if (!highlights.length && !sections.length && !charts.length && !recommended && !followUps.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      {highlights.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {highlights.map((item, idx) => (
            <div key={`${item.label}-${idx}`}>
              <dt className="text-xs text-ink-muted-strong">{plainText(item.label)}</dt>
              <dd className={`mt-0.5 text-base font-semibold tabular-nums ${HIGHLIGHT_TONE_STYLES[item.tone] || HIGHLIGHT_TONE_STYLES.neutral}`}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {sections.length > 0 && (
        <div className="space-y-3">
          {sections.map((section, idx) => (
            list(section.rows).length === 0 ? (
              <EmptySection key={section.id || idx} section={section} />
            ) : (
              <SectionDisclosure
                key={section.id || idx}
                section={section}
                defaultOpen={idx === firstWithRows && list(section.rows).length <= OPEN_ROW_LIMIT}
                onAsk={onAsk}
                disabled={disabled}
              />
            )
          ))}
        </div>
      )}

      {charts.length > 0 && (
        <div className="space-y-4">
          {charts.map((chart, idx) => <Chart key={chart.id || idx} chart={chart} />)}
        </div>
      )}

      {recommended && (
        <div className="flex flex-col justify-between gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
          <p className="min-w-0 text-sm text-ink">
            <span className="font-medium">Recommended next step: </span>
            {plainText(recommended.title)}
            {recommended.detail && (
              <span className="mt-0.5 block text-xs text-ink-muted-strong">{plainText(recommended.detail)}</span>
            )}
          </p>
          {recommended.href && (
            <Button to={recommended.href} variant="secondary" size="sm" className="shrink-0 self-start max-sm:h-11 sm:self-center">
              {recommended.action_label || 'Take action'}
            </Button>
          )}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted-strong">Ask next:</span>
          {followUps.map((item, idx) => (
            <Button
              key={`${item.question}-${idx}`}
              variant="secondary"
              size="sm"
              className="max-sm:h-11"
              disabled={disabled || !onAsk}
              onClick={() => onAsk(item.question, item.topic ?? null)}
            >
              {item.label || item.question}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
