import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Stat from './Stat';

describe('Stat', () => {
  it('defaults the delta to a neutral tone regardless of direction', () => {
    render(<Stat label="Open tasks" value="6" delta="-2" deltaDirection="down" />);
    expect(screen.getByText('-2')).toHaveClass('text-ink-muted');
  });

  it('lets the caller mark a downward delta as good news with deltaTone="positive"', () => {
    render(<Stat label="Open tasks" value="6" delta="-2" deltaDirection="down" deltaTone="positive" />);
    expect(screen.getByText('-2')).toHaveClass('text-success-strong');
  });

  it('still supports an explicit negative tone', () => {
    render(<Stat label="Budget balance" value="₱1,000" delta="-30%" deltaDirection="down" deltaTone="negative" />);
    expect(screen.getByText('-30%')).toHaveClass('text-danger-strong');
  });
});
