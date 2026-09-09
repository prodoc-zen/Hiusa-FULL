import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from './EventsPage';

vi.mock('../../../services/eventService', () => ({
  getEvents: vi.fn(() => Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } })),
  getEvent: vi.fn(),
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
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
  });

  it('opens a blank event form from the request selector route', async () => {
    render(<MemoryRouter initialEntries={['/dashboard/approval-requests/new/event']}><EventsPage initialTab="events" startEventRequest /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Create Event' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event Name *')).toHaveValue('');
  });
});
