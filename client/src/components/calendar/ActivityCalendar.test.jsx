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
    expect(day.closest('[role="gridcell"]')).toHaveClass('bg-page');
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

describe('ActivityCalendar views and filters', () => {
  const at = (month, day, hour = 9) => new Date(2026, month, day, hour, 0).toISOString();
  const events = [
    { id: 1, title: 'Campus assembly', status: 'approved', start_time: at(8, 29), end_time: at(8, 29, 11), planning_details: { venue_type: 'on_campus' }, organization: { id: 1, name: 'HIUSA Council' } },
    { id: 2, title: 'Outreach drive', status: 'planning', start_time: at(9, 2), end_time: at(9, 2, 12), planning_details: { venue_type: 'off_campus' }, organization: { id: 2, name: 'Science Society' } },
    { id: 3, title: 'Sports fest', status: 'approved', start_time: at(9, 10), end_time: at(9, 10, 17), planning_details: { venue_type: 'on_campus' }, organization: { id: 1, name: 'HIUSA Council' } },
  ];
  const renderCalendar = (props = {}) => {
    Element.prototype.scrollIntoView = vi.fn();
    const onSelectEvent = vi.fn();
    render(<ActivityCalendar initialDate={new Date(2026, 8, 29)} events={events} onSelectEvent={onSelectEvent} {...props} />);
    return onSelectEvent;
  };
  const chooseView = (name) => fireEvent.click(screen.getByRole('radio', { name }));
  const filter = (name, value) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
  const heading = (name) => screen.getByRole('heading', { level: 2, name });

  it('switches to the week view, lists its seven days and moves by week', () => {
    const onSelectEvent = renderCalendar();
    chooseView('Week');
    expect(heading('Sep 27 - Oct 3, 2026')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
    expect(screen.getByText('Campus assembly')).toBeInTheDocument();
    expect(screen.getByText('Outreach drive')).toBeInTheDocument();
    expect(screen.queryByText('Sports fest')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Outreach drive'));
    expect(onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(heading('Oct 4 - 10, 2026')).toBeInTheDocument();
    expect(screen.getByText('Sports fest')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(heading('Sep 27 - Oct 3, 2026')).toBeInTheDocument();
  });

  it('switches to the day view, lists that day only and moves by day', () => {
    const onSelectEvent = renderCalendar();
    chooseView('Day');
    expect(heading('Tuesday, September 29, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Campus assembly'));
    expect(onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(heading('Wednesday, September 30, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Campus assembly')).not.toBeInTheDocument();
    expect(screen.getByText('No events scheduled for Wednesday, September 30, 2026.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByText('Campus assembly')).toBeInTheDocument();
  });

  it('opens the day chosen on the month grid when the view changes to day', () => {
    const twoOnTheSecond = [events[1], { id: 5, title: 'Debate night', status: 'approved', start_time: at(9, 2, 18) }];
    renderCalendar({ events: twoOnTheSecond });
    fireEvent.click(screen.getByRole('button', { name: /October 2, 2026, 2 events/ }));
    chooseView('Day');
    expect(heading('Friday, October 2, 2026')).toBeInTheDocument();
    expect(screen.getByText('Debate night')).toBeInTheDocument();
  });

  it('returns to the current period with Today in every view', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 28, 10, 0));
    try {
      renderCalendar();
      chooseView('Week');
      fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
      expect(heading('Nov 22 - 28, 2026')).toBeInTheDocument();
      chooseView('Day');
      expect(heading('Saturday, November 28, 2026')).toBeInTheDocument();
      chooseView('Month');
      expect(heading('November 2026')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters by status and by venue from the events it already has', () => {
    renderCalendar();
    expect(screen.queryAllByText('Outreach drive').length).toBeGreaterThan(0);
    filter('Status', 'planning');
    expect(screen.queryAllByText('Outreach drive').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Campus assembly')).toHaveLength(0);
    filter('Status', '');
    filter('Venue', 'on_campus');
    expect(screen.queryAllByText('Outreach drive')).toHaveLength(0);
    expect(screen.queryAllByText('Campus assembly').length).toBeGreaterThan(0);
  });

  it('filters by organization when the events come from more than one', () => {
    renderCalendar();
    filter('Organization', '2');
    expect(screen.queryAllByText('Campus assembly')).toHaveLength(0);
    expect(screen.queryAllByText('Outreach drive').length).toBeGreaterThan(0);
  });

  it('offers a filter only when the events differ on it', () => {
    renderCalendar({ events: [events[0], events[2]] });
    expect(screen.queryByRole('combobox', { name: 'Organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Venue' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
  });

  it('jumps to the start of a date range and hides events outside it', () => {
    renderCalendar();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } });
    expect(heading('October 2026')).toBeInTheDocument();
    expect(screen.queryAllByText('Outreach drive').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Sports fest').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Campus assembly')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-05' } });
    expect(screen.queryAllByText('Outreach drive').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Sports fest')).toHaveLength(0);
  });

  it('shows a multi-day event only on the days inside the range', () => {
    renderCalendar({ events: [{ id: 9, title: 'Retreat', status: 'approved', start_time: at(9, 5), end_time: at(9, 8) }] });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-07' } });
    chooseView('Week');
    expect(heading('Oct 4 - 10, 2026')).toBeInTheDocument();
    expect(screen.getAllByText(/Retreat/)).toHaveLength(2);
  });

  it('does not filter on an end date before the start date, and says so', () => {
    renderCalendar();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-01' } });
    expect(screen.getByText('The end date must be on or after the start date.')).toBeInTheDocument();
    expect(screen.queryAllByText('Sports fest').length).toBeGreaterThan(0);
  });

  it('says no events match when a filter hides everything, and clears every filter', () => {
    renderCalendar();
    filter('Status', 'planning');
    filter('Venue', 'on_campus');
    expect(screen.getByText('No events match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('No events match these filters')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
    expect(screen.queryAllByText('Campus assembly').length).toBeGreaterThan(0);
  });

  it('shows the same empty state in the week and day views', () => {
    renderCalendar();
    filter('Status', 'planning');
    filter('Venue', 'on_campus');
    chooseView('Week');
    expect(screen.getByText('No events match these filters')).toBeInTheDocument();
    chooseView('Day');
    expect(screen.getByText('No events match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Campus assembly')).toBeInTheDocument();
  });

  it('offers Clear filters only while a filter is on', () => {
    renderCalendar();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    filter('Status', 'approved');
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});
