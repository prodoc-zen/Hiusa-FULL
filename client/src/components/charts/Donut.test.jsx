import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Donut from './Donut';

const SEGMENTS = [
  { label: 'Paid', value: 60 },
  { label: 'Pending', value: 40 },
];

describe('Donut', () => {
  it('renders an accessible table fallback with values and percents', () => {
    render(<Donut title="Order status" segments={SEGMENTS} centerLabel="Orders" />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
  });

  it('shows the center total by default', () => {
    render(<Donut title="Order status" segments={SEGMENTS} centerLabel="Orders" />);

    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('renders a quiet empty state instead of a broken ring', () => {
    render(<Donut title="Order status" segments={[]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
  });

  it('treats all-zero segments as empty', () => {
    render(<Donut title="Order status" segments={[{ label: 'Paid', value: 0 }]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });
});
