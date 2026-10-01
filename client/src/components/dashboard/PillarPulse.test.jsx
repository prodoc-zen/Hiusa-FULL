import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PillarPulse from './PillarPulse';

const pillars = {
  finance: {
    value: 38200,
    unit: 'currency',
    label: 'Remaining budget',
    context: '₱38,200.00 left of ₱60,000.00 allocated (36.3% used)',
    delta: { value: 1250.5, period: 'vs last 30 days', direction: 'up' },
    meter: { value: 21800, limit: 60000 },
  },
  elections: {
    value: 63.7,
    unit: 'percent',
    label: 'Turnout · General Election',
    context: 'Closes Oct 1',
    meter: { value: 143, limit: 224 },
  },
};

describe('PillarPulse', () => {
  it('renders each pillar in role order with formatted values and context', () => {
    render(<PillarPulse pillars={pillars} order={['finance', 'elections']} />);

    expect(screen.getByText('Remaining budget')).toBeInTheDocument();
    expect(screen.getByText('₱38,200.00')).toBeInTheDocument();
    expect(screen.getByText(/36.3% used/)).toBeInTheDocument();
    expect(screen.getByText('63.7%')).toBeInTheDocument();
  });

  it('skips pillars the role does not have data for', () => {
    render(<PillarPulse pillars={pillars} order={['finance', 'tasks']} />);
    expect(screen.queryByText('Open tasks')).not.toBeInTheDocument();
  });

  it('shows a no-data message when the role has no pillars at all', () => {
    render(<PillarPulse pillars={{}} order={['finance']} />);
    expect(screen.getByText(/No study-area data yet/i)).toBeInTheDocument();
  });
});
