import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VenueAvailabilityTimeline from './VenueAvailabilityTimeline';

describe('VenueAvailabilityTimeline', () => {
  it('shows the chosen Manila day and reservation details', () => {
    render(<VenueAvailabilityTimeline from="2026-10-05" to="2026-10-06" slots={[
      { id: 1, start_time: '2026-10-05T01:00:00Z', end_time: '2026-10-05T03:00:00Z', reserved_by: 'Your organization' },
      { id: 2, start_time: '2026-10-06T05:00:00Z', end_time: '2026-10-06T06:00:00Z', reserved_by: 'Another organization' },
    ]} />);

    expect(screen.getByText(/Reserved by Your organization/)).toBeInTheDocument();
    expect(screen.queryByText(/Reserved by Another organization/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tue, Oct 6/i }));
    expect(screen.getByText(/Reserved by Another organization/)).toBeInTheDocument();
    expect(screen.queryByText(/Reserved by Your organization/)).not.toBeInTheDocument();
  });
});
