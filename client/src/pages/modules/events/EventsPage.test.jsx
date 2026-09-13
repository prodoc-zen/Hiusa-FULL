import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from './EventsPage';

const eventMocks = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getEvent: vi.fn(),
  generateEventPlan: vi.fn(),
  getEventWorkflowHistory: vi.fn(),
  confirmEventWorkflow: vi.fn(),
  discardEventWorkflow: vi.fn(),
}));

vi.mock('../../../services/eventService', () => ({
  ...eventMocks,
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  updateEventStatus: vi.fn(),
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
    eventMocks.getEventWorkflowHistory.mockResolvedValue({ data: [] });
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

  it('shows a readable AI-created to-do list without raw API dates or technical labels', async () => {
    const event = { id: 9, title: 'Leadership Summit', status: 'approved', start_time: '2026-10-10T08:00:00.000000Z', end_time: '2026-10-10T12:00:00.000000Z', location: 'Main Hall' };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.generateEventPlan.mockResolvedValue({
      data: {
        plan: 'Finish setup by 2026-10-10T07:30:00.000000Z.',
        ai_output: { id: 501 },
        workflow: {
          overview: 'Prepare the venue before 2026-10-10T08:00:00.000000Z.',
          preparation_phases: ['Confirm the event plan'],
          timeline: ['Finish setup by 2026-10-10T07:30:00.000000Z'],
          resources: ['Sound system'],
          logistics: ['Check the room'],
          risks: ['Late equipment delivery'],
          scheduling_conflicts: [],
          tasks: [{
            key: 'setup',
            title: 'Prepare the venue',
            description: 'Set up the room and equipment.',
            phase: 'pre_event',
            priority: 'high',
            deadline: '2026-10-10T07:30:00.000000Z',
            depends_on_key: null,
            recommended_role: 'Business Manager',
            assigned_to: 900007,
            recommendation: {
              rankings: [{ officer_id: 900007, rank: 1, name: 'Alex Santos', position_title: 'Business Manager', role_score: 100, workload_score: 80, performance_score: 90, final_score: 90, active_tasks: 1, max_active_tasks: 5 }],
            },
          }],
        },
      },
    });

    render(<MemoryRouter initialEntries={['/dashboard/events/event-planner']}><EventsPage initialTab="tasks" /></MemoryRouter>);

    await screen.findByRole('heading', { name: 'Build an Event To-do List' });
    await screen.findByRole('option', { name: 'Leadership Summit' });
    fireEvent.change(screen.getByLabelText('Event', { exact: true }), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('What should the to-do list cover?'), { target: { value: 'Plan setup and safety.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create To-do List' }));

    expect(await screen.findByText('1 suggested to-do item')).toBeInTheDocument();
    expect(screen.getByText('Why Alex Santos was suggested')).toBeInTheDocument();
    expect(screen.getByLabelText('Task 1 deadline')).not.toHaveValue(expect.stringContaining('Z'));
    expect(document.body.textContent).not.toContain('000000Z');
    expect(document.body.textContent).not.toContain('Delegation score');

    fireEvent.click(screen.getByRole('button', { name: 'Add to-do' }));
    expect(screen.getByLabelText('Task 2 officer')).toHaveValue('');
    expect(screen.getByText('The system will check for the best available officer when you save this task.')).toBeInTheDocument();
  });
});
