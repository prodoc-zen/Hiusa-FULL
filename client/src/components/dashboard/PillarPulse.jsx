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
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${DELTA_TONE[delta.direction] || DELTA_TONE.flat}`}>
      <Icon size={13} aria-hidden="true" />
      {sign}{peso(delta.value)}
      <span className="font-medium text-ink-soft">{delta.period}</span>
    </span>
  );
}

/**
 * ELEVATION_SPEC section 6, step 3: one panel, internally divided, one row
 * per role-relevant area of `docs/api/dashboard-briefing.md`'s `pillars`
 * block. `order` fixes the role's pillar sequence per that doc's
 * "Pillars per role" table.
 */
export default function PillarPulse({ pillars = {}, order = [] }) {
  const keys = order.filter((key) => pillars[key]);

  if (keys.length === 0) {
    return <p className="py-6 text-center text-sm font-medium text-ink-muted">No study-area data yet for this organization.</p>;
  }

  return (
    <div className="divide-y divide-line-soft">
      {keys.map((key) => {
        const pillar = PILLAR_BY_KEY[key];
        const data = pillars[key];
        const Icon = pillar?.icon;

        return (
          <div key={key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {Icon && (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
                  <Icon size={19} aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-muted">{data.label}</p>
                <p className="mt-0.5 text-xl font-extrabold tabular-nums text-ink">{formatValue(data.unit, data.value)}</p>
                <p className="mt-0.5 text-xs font-medium leading-5 text-ink-muted">{data.context}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:w-64 sm:shrink-0 sm:items-end">
              {data.delta && <div className="whitespace-nowrap"><DeltaTag delta={data.delta} /></div>}
              {data.meter && (
                <div className="w-full sm:w-40">
                  <Meter value={data.meter.value} limit={data.meter.limit} label={pillar?.shortLabel || data.label} format={meterFormat(data.unit)} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
