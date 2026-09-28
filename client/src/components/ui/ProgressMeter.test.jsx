import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProgressMeter from './ProgressMeter';

describe('ProgressMeter', () => {
  it('renders a visible track and animates the fill with a scaleX transform, not width', () => {
    render(<ProgressMeter label="Operating budget" value={30} max={60} valueLabel="30 of 60" />);
    const track = screen.getByRole('progressbar', { name: 'Operating budget' });
    expect(track).toHaveClass('bg-line-soft');

    const fill = track.firstChild;
    expect(fill.style.transform).toBe('scaleX(0.5)');
    expect(fill.style.width).toBe('');
    expect(fill).toHaveClass('w-full');
  });

  it('exposes the raw value range for assistive tech', () => {
    render(<ProgressMeter label="Warning threshold" value={51} max={60} />);
    const track = screen.getByRole('progressbar', { name: 'Warning threshold' });
    expect(track).toHaveAttribute('aria-valuenow', '51');
    expect(track).toHaveAttribute('aria-valuemax', '60');
  });
});
