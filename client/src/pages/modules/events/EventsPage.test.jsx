import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from './EventsPage';

const eventMocks = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getEvent: vi.fn(),
}));

vi.mock('../../../services/eventService', () => ({
  ...eventMocks,
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  updateEventStatus: vi.fn(),
  generateEventPlan: vi.fn(),
  getEventWorkflowHistory: vi.fn(),
  confirmEventWorkflow: vi.fn(),
  discardEventWorkflow: vi.fn(),
  getAttendance: vi.fn(),
  recordAttendance: vi.fn(),
}));

vi.mock('../../../services/taskService', () => ({
  getTasks: vi.fn(() => Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } })),
}));

vi.mock('../../../services/userService', () => ({ getUsers: vi.fn() }));

describe('EventsPage approval-request launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    eventMocks.getEvents.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } });
  });

  it('opens a blank event form from the request selector route', async () => {
    render(<MemoryRouter initialEntries={['/dashboard/approval-requests/new/event']}><EventsPage initialTab="events" startEventRequest /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Create Event' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event Name *')).toHaveValue('');
  });

  it('does not reopen event details when a pending details request resolves after close', async () => {
    const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym' };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    let resolveDetails;
    eventMocks.getEvent.mockReturnValue(new Promise((resolve) => { resolveDetails = resolve; }));

    render(<MemoryRouter initialEntries={['/dashboard/events/manage-events']}><EventsPage initialTab="events" /></MemoryRouter>);

    fireEvent.click(await screen.findByLabelText('View Sports Fest 2024'));
    fireEvent.click(screen.getByRole('button', { name: 'Close event details' }));
    await act(async () => resolveDetails({ data: { ...event, description: 'Late response' } }));

    expect(screen.queryByRole('button', { name: 'Close event details' })).not.toBeInTheDocument();
  });
});
