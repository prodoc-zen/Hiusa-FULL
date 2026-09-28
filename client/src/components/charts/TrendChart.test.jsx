import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TrendChart from './TrendChart';

const peso = (value) => `₱${Number(value).toLocaleString()}`;

const ACTUAL_SERIES = {
  key: 'actual',
  label: 'Actual income',
  variant: 'actual',
  points: [
    { x: '2026-01', y: 10000 },
    { x: '2026-02', y: 12000 },
    { x: '2026-03', y: 9000 },
  ],
};

const FORECAST_SERIES = {
  key: 'forecast',
  label: 'Forecast income',
  variant: 'forecast',
  points: [
    { x: '2026-04', y: 11000 },
    { x: '2026-05', y: 11500 },
  ],
};

describe('TrendChart', () => {
  it('renders an accessible table fallback with the right values', () => {
    render(<TrendChart title="Income trend" series={[ACTUAL_SERIES]} yFormat={peso} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    expect(table).toHaveClass('table-fixed');
    expect(within(table).getByText('2026-01')).toBeInTheDocument();
    expect(within(table).getByText(peso(12000))).toBeInTheDocument();
    expect(within(table).getByText(peso(9000))).toBeInTheDocument();
  });

  it('renders a quiet empty state instead of a broken chart when there is no data', () => {
    render(<TrendChart title="Income trend" series={[]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
  });

  it('also treats a series with an empty points array as no data', () => {
    render(<TrendChart title="Income trend" series={[{ key: 'a', label: 'A', points: [] }]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });

  it('draws a dashed forecast path continuing from the last actual point when a forecast series exists', () => {
    const { container } = render(<TrendChart title="Income trend" series={[ACTUAL_SERIES, FORECAST_SERIES]} />);

    const forecastPath = container.querySelector('path[data-variant="forecast"]');
    const actualPath = container.querySelector('path[data-variant="actual"]');
    expect(forecastPath).toBeTruthy();
    expect(actualPath).toBeTruthy();
    expect(forecastPath.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(actualPath.getAttribute('stroke-dasharray')).toBeNull();

    // the forecast line's path data must start at the actual series' last point (2026-03)
    expect(forecastPath.getAttribute('d')).toContain(actualPath.getAttribute('d').split(' ').slice(-2).join(' '));
  });

  it('renders a single point without crashing', () => {
    render(<TrendChart title="Income trend" series={[{ key: 'a', label: 'A', points: [{ x: '2026-01', y: 5000 }] }]} />);

    expect(screen.getAllByText('2026-01').length).toBeGreaterThan(0);
  });

  it('handles all-zero values without crashing', () => {
    render(<TrendChart title="Income trend" series={[{ key: 'a', label: 'A', points: [{ x: '2026-01', y: 0 }, { x: '2026-02', y: 0 }] }]} />);

    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('draws a zero baseline when a series has negative values', () => {
    const { container } = render(
      <TrendChart title="Income trend" series={[{ key: 'a', label: 'A', points: [{ x: '2026-01', y: -500 }, { x: '2026-02', y: 200 }] }]} />,
    );

    expect(container.querySelectorAll('line').length).toBeGreaterThan(5);
  });

  it('shows a tooltip on hover and on keyboard focus', () => {
    render(<TrendChart title="Income trend" series={[ACTUAL_SERIES]} yFormat={peso} />);

    const point = screen.getByRole('img', { name: `Actual income, 2026-02, ${peso(12000)}` });
    fireEvent.mouseEnter(point);
    expect(screen.getAllByText(peso(12000)).length).toBeGreaterThan(0);
    fireEvent.mouseLeave(point);

    fireEvent.focus(point);
    expect(screen.getAllByText(peso(12000)).length).toBeGreaterThan(0);
    fireEvent.blur(point);
  });

  it('does not mark the svg root as role=img, and instead gives each focusable point its own role=img with a label', () => {
    const { container } = render(<TrendChart title="Income trend" series={[ACTUAL_SERIES]} yFormat={peso} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toHaveAttribute('role', 'img');

    const point = screen.getByRole('img', { name: `Actual income, 2026-02, ${peso(12000)}` });
    expect(point.tagName.toLowerCase()).toBe('circle');
    expect(point).toHaveAttribute('tabindex', '0');
  });

  it('renders the svg viewBox at the measured container width so axis text never scales down on narrow screens', () => {
    class MockResizeObserver {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect: { width: 320 } }]); }
      disconnect() {}
    }
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver;

    const { container } = render(<TrendChart title="Income trend" series={[ACTUAL_SERIES]} height={240} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 320 240');

    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('rounds y-axis ticks to nice numbers instead of raw fractions of the data range', () => {
    const identity = (value) => String(value);
    const { container } = render(
      <TrendChart
        title="Spend"
        series={[{ key: 'a', label: 'A', points: [{ x: '1', y: 0 }, { x: '2', y: 12000 }] }]}
        yFormat={identity}
      />,
    );

    const tickTexts = [...container.querySelectorAll('svg > g > text')].map((node) => node.textContent);
    expect(tickTexts).toEqual(['0', '5000', '10000', '15000']);
  });

  it('keeps an actual series end label clear of a connecting forecast line instead of overlapping it', () => {
    const { container } = render(<TrendChart title="Income trend" series={[ACTUAL_SERIES, FORECAST_SERIES]} />);

    const forecastPath = container.querySelector('path[data-variant="forecast"]');
    const [, , startY] = forecastPath.getAttribute('d').match(/M ([\d.-]+) ([\d.-]+)/);
    const actualLabel = container.querySelector('text[data-end-label="actual"]');
    const labelBaselineY = Number(actualLabel.getAttribute('y')) - 4;

    expect(Math.abs(labelBaselineY - Number(startY))).toBeGreaterThanOrEqual(8);
  });

  it('separates two end labels that would otherwise collide when their series end at nearly the same value', () => {
    const closeA = { key: 'a', label: 'Series A', variant: 'actual', points: [{ x: '2026-01', y: 1000 }, { x: '2026-02', y: 1000 }] };
    const closeB = { key: 'b', label: 'Series B', variant: 'actual', points: [{ x: '2026-01', y: 1000 }, { x: '2026-02', y: 1020 }] };
    const { container } = render(<TrendChart title="Two series" series={[closeA, closeB]} />);

    const labelA = container.querySelector('text[data-end-label="a"]');
    const labelB = container.querySelector('text[data-end-label="b"]');
    const gap = Math.abs(Number(labelA.getAttribute('y')) - Number(labelB.getAttribute('y')));

    expect(gap).toBeGreaterThanOrEqual(12);
  });

  it('truncates a very long series label on the chart but keeps the full text in a title', () => {
    const longLabel = 'This is a very long series label that should be truncated';
    const { container } = render(
      <TrendChart title="Income trend" series={[{ key: 'a', label: longLabel, points: [{ x: '2026-01', y: 1 }] }]} />,
    );

    const endLabel = container.querySelector('svg text.font-bold');
    expect(endLabel.firstChild.textContent).toBe('This is a v…');
    expect(within(endLabel).getByText(longLabel, { selector: 'title' })).toBeInTheDocument();
  });
});
