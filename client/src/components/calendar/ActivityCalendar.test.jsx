import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActivityCalendar from './ActivityCalendar';

describe('ActivityCalendar', () => {
  it('opens the event details when a selected date has one event', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const start = new Date(2026, 8, 29, 9, 0);
    const end = new Date(2026, 8, 29, 11, 0);
    const event = { id: 1, title: 'Campus assembly', status: 'approved', start_time: start.toISOString(), end_time: end.toISOString(), location: 'Main Hall', image_url: '/storage/event.jpg' };
    const onSelectEvent = vi.fn();
    render(<ActivityCalendar initialDate={new Date(2026, 8, 1)} events={[event]} onSelectEvent={onSelectEvent} />);
    const day = screen.getByRole('button', { name: /September 29, 2026, 1 event/ });
    expect(day).toBeInTheDocument();
    expect(day.closest('[role="gridcell"]')).toHaveClass('bg-[#EEF6FB]');
    fireEvent.click(day);
    expect(onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 1, image_url: '/storage/event.jpg' }));
  });

  it('shows artwork and descriptions for dates with several events', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const start = new Date(2026, 8, 29, 9, 0);
    const events = [
      { id: 1, title: 'Campus assembly', description: 'Annual gathering', image_url: '/storage/event.jpg', status: 'approved', start_time: start.toISOString() },
      { id: 2, title: 'Workshop', status: 'approved', start_time: start.toISOString() },
    ];
    render(<ActivityCalendar initialDate={new Date(2026, 8, 1)} events={events} onSelectEvent={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /September 29, 2026, 2 events/ }));
    expect(screen.getByText('Annual gathering')).toBeInTheDocument();
    expect(document.querySelector('img[src*="event.jpg"]')).toBeInTheDocument();
  });
});
