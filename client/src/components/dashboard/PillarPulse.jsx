import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Meter } from '../charts';
import { PILLAR_BY_KEY } from '../../lib/pillars';
import { number, peso } from '../../lib/format';

const DELTA_TONE = {
  up: 'text-success-strong',
  down: 'text-danger-strong',
  flat: 'text-ink-muted',
};

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus };

function formatValue(unit, value) {
  if (unit === 'currency') return peso(value);
  if (unit === 'percent') return `${Number(value).toFixed(1).replace(/\.0$/, '')}%`;
  return number(value);
}

function meterFormat(unit) {
  return unit === 'currency' ? peso : number;
}

function DeltaTag({ delta }) {
  const Icon = DELTA_ICON[delta.direction] || Minus;
  const sign = delta.direction === 'up' && delta.value > 0 ? '+' : '';

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${DELTA_TONE[delta.direction] || DELTA_TONE.flat}`}>
      <Icon size={13} aria-hidden="true" />
      {sign}{peso(delta.value)}
      <span className="font-normal text-ink-muted">{delta.period}</span>
    </span>
  );
}

/**
 * ELEVATION_SPEC section 6, step 3: one list, one row per role-relevant area of
 * `docs/api/dashboard-briefing.md`'s `pillars` block, the figure right-aligned.
 * `order` fixes the role's pillar sequence per that doc's "Pillars per role" table.
 */
export default function PillarPulse({ pillars = {}, order = [] }) {
  const keys = order.filter((key) => pillars[key]);

  if (keys.length === 0) {
    return <p className="px-5 py-6 text-sm text-ink-muted">No figures yet.</p>;
  }

  return (
    <ul className="divide-y divide-line-soft">
      {keys.map((key) => {
        const pillar = PILLAR_BY_KEY[key];
        const data = pillars[key];

        return (
          <li key={key} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:px-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{data.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{data.context}</p>
              {data.meter && (
                <div className="mt-2 w-full max-w-56">
                  <Meter value={data.meter.value} limit={data.meter.limit} label={pillar?.shortLabel || data.label} format={meterFormat(data.unit)} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 sm:items-end sm:text-right">
              <p className="text-xl font-semibold tabular-nums text-ink">{formatValue(data.unit, data.value)}</p>
              {data.delta && <DeltaTag delta={data.delta} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
