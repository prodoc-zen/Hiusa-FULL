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

    const point = screen.getByRole('button', { name: `Actual income, 2026-02, ${peso(12000)}` });
    fireEvent.mouseEnter(point);
    expect(screen.getAllByText(peso(12000)).length).toBeGreaterThan(0);
    fireEvent.mouseLeave(point);

    fireEvent.focus(point);
    expect(screen.getAllByText(peso(12000)).length).toBeGreaterThan(0);
    fireEvent.blur(point);
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
