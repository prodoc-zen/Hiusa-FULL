import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StackedBar from './StackedBar';

const SEGMENTS = [
  { label: 'Paid', value: 75 },
  { label: 'Pending', value: 25 },
];

describe('StackedBar', () => {
  it('renders an accessible table fallback with the right values and percents', () => {
    render(<StackedBar title="Order status" segments={SEGMENTS} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('25%').length).toBeGreaterThan(0);
  });

  it('renders a quiet empty state when every segment is zero', () => {
    render(<StackedBar title="Order status" segments={[{ label: 'Paid', value: 0 }]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });

  it('renders a quiet empty state with no segments at all', () => {
    render(<StackedBar title="Order status" segments={[]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });
});
