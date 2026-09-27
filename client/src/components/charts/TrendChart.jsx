import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { seriesColor } from './palette';

const VIEW_WIDTH = 760;
const PAD = { top: 16, right: 84, bottom: 32, left: 56 };
const MIN_LABEL_PX = 56;
const DRAW_DURATION_MS = 400;
const DRAW_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';

function truncateLabel(text, maxChars = 12) {
  const value = String(text ?? '');
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function connectForecastSeries(allSeries) {
  let lastActualPoint = null;
  return allSeries.map((entry) => {
    if (entry.variant !== 'forecast') {
      if (entry.variant === 'actual' && entry.points.length > 0) {
        lastActualPoint = entry.points[entry.points.length - 1];
      }
      return entry;
    }
    if (!lastActualPoint) return entry;
    const firstForecastPoint = entry.points[0];
    if (firstForecastPoint && String(firstForecastPoint.x) === String(lastActualPoint.x)) return entry;
    return { ...entry, points: [lastActualPoint, ...entry.points] };
  });
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event) => setReduced(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

export default function TrendChart({ series = [], yFormat, xFormat, height = 240, title, description }) {
  const containerRef = useRef(null);
  const pathRefs = useRef(new Map());
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [activePoint, setActivePoint] = useState(null);
  const reducedMotion = usePrefersReducedMotion();

  const formatX = xFormat || ((value) => String(value));
  const formatY = yFormat || ((value) => String(value));

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setMeasuredWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const hasData = series.some((entry) => Array.isArray(entry.points) && entry.points.length > 0);
  const connectedSeries = connectForecastSeries(series.map((entry) => ({ ...entry, points: entry.points || [] })));

  const xKeys = [];
  const xKeySet = new Set();
  const xRawByKey = new Map();
  for (const entry of connectedSeries) {
    for (const point of entry.points) {
      const key = String(point.x);
      if (!xKeySet.has(key)) {
        xKeySet.add(key);
        xKeys.push(key);
        xRawByKey.set(key, point.x);
      }
    }
  }
  const xIndexByKey = new Map(xKeys.map((key, index) => [key, index]));

  const allY = [0];
  for (const entry of connectedSeries) {
    for (const point of entry.points) {
      allY.push(Number(point.y) || 0);
      if (point.band) {
        allY.push(Number(point.band.lower) || 0, Number(point.band.upper) || 0);
      }
    }
  }
  const minY = Math.min(...allY);
  const maxY = Math.max(1, ...allY);
  const yRange = maxY - minY || 1;

  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;

  const scaleX = (x) => {
    const index = xIndexByKey.get(String(x)) ?? 0;
    return xKeys.length <= 1 ? PAD.left + plotWidth / 2 : PAD.left + (index * plotWidth) / (xKeys.length - 1);
  };
  const scaleY = (y) => PAD.top + ((maxY - y) / yRange) * plotHeight;

  const buildLinePath = (points) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.x).toFixed(2)} ${scaleY(point.y).toFixed(2)}`)
    .join(' ');

  const buildBandPath = (points) => {
    const withBand = points.filter((point) => (
      point.band && Number.isFinite(Number(point.band.lower)) && Number.isFinite(Number(point.band.upper))
    ));
    if (withBand.length < 2) return null;
    const upper = withBand
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.x).toFixed(2)} ${scaleY(Number(point.band.upper)).toFixed(2)}`)
      .join(' ');
    const lower = [...withBand]
      .reverse()
      .map((point) => `L ${scaleX(point.x).toFixed(2)} ${scaleY(Number(point.band.lower)).toFixed(2)}`)
      .join(' ');
    return `${upper} ${lower} Z`;
  };

  const availableWidth = measuredWidth || VIEW_WIDTH;
  const maxTicks = Math.max(2, Math.floor(availableWidth / MIN_LABEL_PX));
  const tickStep = xKeys.length > maxTicks ? Math.ceil(xKeys.length / maxTicks) : 1;

  const dataSignature = JSON.stringify(connectedSeries.map((entry) => entry.points.map((point) => [point.x, point.y])));

  useLayoutEffect(() => {
    if (reducedMotion) return;
    for (const entry of connectedSeries) {
      if (entry.variant === 'forecast') continue;
      const path = pathRefs.current.get(entry.key);
      if (!path) continue;
      try {
        const length = path.getTotalLength();
        path.style.transition = 'none';
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        // force layout so the browser registers the starting offset before animating to 0
        path.getBoundingClientRect();
        requestAnimationFrame(() => {
          path.style.transition = `stroke-dashoffset ${DRAW_DURATION_MS}ms ${DRAW_EASING}`;
          path.style.strokeDashoffset = '0';
        });
      } catch {
        // getTotalLength is unavailable in some test environments; leave the line fully drawn
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSignature, reducedMotion]);

  if (!hasData) {
    return (
      <section aria-label={title}>
        {title && <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>}
        {description && <p className="mt-0.5 text-xs text-[#64748B]">{description}</p>}
        <p className="py-8 text-center text-sm font-medium text-[#64748B]">No data for this period yet</p>
      </section>
    );
  }

  return (
    <section aria-label={title}>
      {title && <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-[#64748B]">{description}</p>}

      <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-[#64748B]">
        {connectedSeries.map((entry, index) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <i
              className="h-0 w-3.5 border-t-2"
              style={{
                borderColor: entry.color || seriesColor(index),
                borderStyle: entry.variant === 'forecast' ? 'dashed' : 'solid',
              }}
              aria-hidden="true"
            />
            {entry.label}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="relative">
        <svg viewBox={`0 0 ${VIEW_WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label={title || 'Trend chart'}>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => {
            const value = maxY - yRange * step;
            const lineY = scaleY(value);
            return (
              <g key={step}>
                <line x1={PAD.left} x2={VIEW_WIDTH - PAD.right} y1={lineY} y2={lineY} stroke="#E5EDF3" />
                <text x={PAD.left - 8} y={lineY + 4} textAnchor="end" className="fill-[#64748B] text-[10px]">
                  {formatY(value)}
                </text>
              </g>
            );
          })}

          {minY < 0 && (
            <line x1={PAD.left} x2={VIEW_WIDTH - PAD.right} y1={scaleY(0)} y2={scaleY(0)} stroke="#DDE7EF" strokeWidth="1.5" />
          )}

          {xKeys.map((key, index) => {
            if (index % tickStep !== 0 && index !== xKeys.length - 1) return null;
            const raw = xRawByKey.get(key);
            const label = truncateLabel(formatX(raw), 10);
            return (
              <text key={key} x={scaleX(raw)} y={height - PAD.bottom + 18} textAnchor="middle" className="fill-[#64748B] text-[10px]">
                {label}
                <title>{formatX(raw)}</title>
              </text>
            );
          })}

          {connectedSeries.map((entry, index) => {
            const color = entry.color || seriesColor(index);
            const bandPath = buildBandPath(entry.points);
            return bandPath ? <path key={`${entry.key}-band`} d={bandPath} fill={color} opacity="0.12" stroke="none" /> : null;
          })}

          {connectedSeries.map((entry, index) => {
            const color = entry.color || seriesColor(index);
            const isForecast = entry.variant === 'forecast';
            return (
              <path
                key={entry.key}
                ref={(node) => {
                  if (node) pathRefs.current.set(entry.key, node);
                  else pathRefs.current.delete(entry.key);
                }}
                d={buildLinePath(entry.points)}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={isForecast ? '6 4' : undefined}
                data-variant={entry.variant || 'actual'}
              />
            );
          })}

          {connectedSeries.map((entry, index) => {
            const color = entry.color || seriesColor(index);
            return entry.points.map((point, pointIndex) => {
              const isActive = activePoint?.seriesKey === entry.key && activePoint?.pointIndex === pointIndex;
              return (
                <circle
                  key={`${entry.key}-${pointIndex}`}
                  cx={scaleX(point.x)}
                  cy={scaleY(point.y)}
                  r={isActive ? 5 : 3.5}
                  fill={color}
                  tabIndex={0}
                  role="button"
                  aria-label={`${entry.label}, ${formatX(point.x)}, ${formatY(point.y)}`}
                  onMouseEnter={() => setActivePoint({ seriesKey: entry.key, pointIndex })}
                  onMouseLeave={() => setActivePoint(null)}
                  onFocus={() => setActivePoint({ seriesKey: entry.key, pointIndex })}
                  onBlur={() => setActivePoint(null)}
                />
              );
            });
          })}

          {connectedSeries.map((entry, index) => {
            if (!entry.points.length) return null;
            const color = entry.color || seriesColor(index);
            const lastPoint = entry.points[entry.points.length - 1];
            return (
              <text
                key={`${entry.key}-end-label`}
                x={scaleX(lastPoint.x) + 8}
                y={scaleY(lastPoint.y) + 4}
                className="text-[10px] font-bold"
                fill={color}
              >
                {truncateLabel(entry.label, 12)}
                <title>{entry.label}</title>
              </text>
            );
          })}
        </svg>

        {activePoint && (() => {
          const entry = connectedSeries.find((candidate) => candidate.key === activePoint.seriesKey);
          const point = entry?.points[activePoint.pointIndex];
          if (!entry || !point) return null;
          const leftPct = (scaleX(point.x) / VIEW_WIDTH) * 100;
          const topPct = (scaleY(point.y) / height) * 100;
          return (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-[#DDE7EF] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] shadow-[0_1px_2px_rgb(15_23_42_/_0.04),0_1px_3px_rgb(15_23_42_/_0.06)]"
              style={{ left: `${leftPct}%`, top: `${topPct}%`, marginTop: '-10px' }}
            >
              <p className="font-bold">{entry.label}</p>
              <p className="text-[#64748B]">{formatX(point.x)}</p>
              <p className="tabular-nums">{formatY(point.y)}</p>
            </div>
          );
        })()}
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Period</th>
            {series.map((entry) => <th key={entry.key}>{entry.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {xKeys.map((key) => {
            const raw = xRawByKey.get(key);
            return (
              <tr key={key}>
                <td>{formatX(raw)}</td>
                {series.map((entry) => {
                  const point = (entry.points || []).find((candidate) => String(candidate.x) === key);
                  if (!point) return <td key={entry.key} />;
                  const cell = point.band
                    ? `${formatY(point.y)} (band ${formatY(point.band.lower)} to ${formatY(point.band.upper)})`
                    : formatY(point.y);
                  return <td key={entry.key}>{cell}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
