import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BarList from './BarList';

const ITEMS = [
  { label: 'Merchandise', value: 12400 },
  { label: 'Events', value: 8200 },
  { label: 'Tasks overdue', value: 3 },
];

describe('BarList', () => {
  it('renders an accessible table fallback with the right values', () => {
    render(<BarList title="Top categories" items={ITEMS} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    for (const item of ITEMS) {
      expect(screen.getAllByText(item.label).length).toBeGreaterThan(0);
      expect(screen.getAllByText(String(item.value)).length).toBeGreaterThan(0);
    }
  });

  it('renders a quiet empty state instead of a broken bar', () => {
    render(<BarList title="Top categories" items={[]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
  });

  it('renders an optional secondary value alongside the primary one', () => {
    render(<BarList title="Orders" items={[{ label: 'Pending', value: 5, secondaryValue: 12 }]} />);

    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });

  it('keeps the sr-only fallback table from forcing horizontal overflow on narrow screens', () => {
    render(<BarList title="Orders" items={[{ label: 'A very long category label that keeps going', value: 1000 }]} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('table-fixed');
  });
});
