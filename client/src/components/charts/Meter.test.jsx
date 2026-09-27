import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Meter from './Meter';

describe('Meter', () => {
  it('exposes an accessible meter role with the raw value, min and max', () => {
    render(<Meter value={38200} limit={60000} label="Budget used" />);

    const meter = screen.getByRole('meter', { name: 'Budget used' });
    expect(meter).toHaveAttribute('aria-valuenow', '38200');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '60000');
  });

  it('stays in the neutral tone just under 80 percent', () => {
    render(<Meter value={79} limit={100} label="Usage" />);

    expect(screen.getByText('79%')).toHaveStyle({ color: '#0F172A' });
  });

  it('switches to the warning tone at 80 percent', () => {
    render(<Meter value={80} limit={100} label="Usage" />);

    expect(screen.getByText('80%')).toHaveStyle({ color: '#B45309' });
  });

  it('switches to the danger tone at 100 percent', () => {
    render(<Meter value={100} limit={100} label="Usage" />);

    expect(screen.getByText('100%')).toHaveStyle({ color: '#B91C1C' });
  });

  it('formats the value and limit line with a given formatter', () => {
    render(<Meter value={38200} limit={60000} label="Budget used" format={(n) => `₱${n.toLocaleString()}`} />);

    expect(screen.getByText('₱38,200 of ₱60,000')).toBeInTheDocument();
  });

  it('reports no limit set when the limit is zero or missing', () => {
    render(<Meter value={500} limit={0} label="Usage" />);

    expect(screen.getByText('No limit set')).toBeInTheDocument();
  });
});
