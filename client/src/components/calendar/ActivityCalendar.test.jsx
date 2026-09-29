import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActivityCalendar from './ActivityCalendar';

describe('ActivityCalendar', () => {
  it('marks local event dates and shows details when a day is selected', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const start = new Date(2026, 8, 29, 9, 0);
    const end = new Date(2026, 8, 29, 11, 0);
    render(<ActivityCalendar initialDate={new Date(2026, 8, 1)} events={[{ id: 1, title: 'Campus assembly', status: 'approved', start_time: start.toISOString(), end_time: end.toISOString(), location: 'Main Hall' }]} onSelectEvent={vi.fn()} />);
    const day = screen.getByRole('button', { name: /September 29, 2026, 1 event/ });
    expect(day).toBeInTheDocument();
    expect(day.closest('[role="gridcell"]')).toHaveClass('bg-[#EEF6FB]');
    fireEvent.click(day);
    expect(screen.getByText('Main Hall')).toBeInTheDocument();
  });
});
