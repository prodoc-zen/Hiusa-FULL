import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from './EventsPage';

const eventMocks = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getEvent: vi.fn(),
  getAttendance: vi.fn(),
  getPersonalAttendance: vi.fn(),
  recordAttendance: vi.fn(),
  generateEventPlan: vi.fn(),
  getEventWorkflowHistory: vi.fn(),
  confirmEventWorkflow: vi.fn(),
  discardEventWorkflow: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('../../../services/eventService', () => ({
  ...eventMocks,
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  updateEventStatus: vi.fn(),
  getMyEventRegistrations: vi.fn(() => Promise.resolve({ data: { upcoming: [], past: [] } })),
  getEventRegistrations: vi.fn(() => Promise.resolve({ data: { summary: { capacity: null, registered: 0, attended: 0, cancelled: 0, no_show: 0, remaining: null }, registrations: [], pagination: { current_page: 1, last_page: 1, per_page: 10, total: 0 } } })),
  registerForEvent: vi.fn(),
  cancelEventRegistration: vi.fn(),
}));

const userMocks = vi.hoisted(() => ({ getUsers: vi.fn(), getAcademicStructure: vi.fn() }));
const fingerprintMocks = vi.hoisted(() => ({
  identifyAttendanceFingerprint: vi.fn(),
  confirmFingerprintAttendance: vi.fn(),
  reader: {
    connected: false,
    scanning: false,
    mock: false,
    error: 'Connect a fingerprint reader to continue.',
    retry: vi.fn(),
    identifyFingerprint: vi.fn(),
    cancelCapture: vi.fn(),
  },
}));

vi.mock('../../../services/taskService', () => ({
  getTasks: vi.fn(() => Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } })),
}));

vi.mock('../../../services/userService', () => ({
  getUsers: userMocks.getUsers,
  getAcademicStructure: userMocks.getAcademicStructure,
}));

vi.mock('../../../hooks/useFingerprintReader', () => ({
  useFingerprintReader: () => fingerprintMocks.reader,
}));

vi.mock('../../../services/fingerprintService', () => ({
  identifyAttendanceFingerprint: fingerprintMocks.identifyAttendanceFingerprint,
  confirmFingerprintAttendance: fingerprintMocks.confirmFingerprintAttendance,
}));

describe('EventsPage approval-request launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    eventMocks.getEvents.mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } });
    eventMocks.getPersonalAttendance.mockResolvedValue({ data: { summary: { attended: 0, missed: 0, rate: null }, records: [], pagination: { current_page: 1, per_page: 10, total: 0 } } });
    eventMocks.getEventWorkflowHistory.mockResolvedValue({ data: [] });
    userMocks.getUsers.mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0, per_page: 100 });
    userMocks.getAcademicStructure.mockResolvedValue({ department: 'College of Computer Studies', programs: [] });
    Object.assign(fingerprintMocks.reader, {
      connected: false,
      scanning: false,
      mock: false,
      error: 'Connect a fingerprint reader to continue.',
    });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View event' }));
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
    fireEvent.change(screen.getByLabelText('Optional planning context'), { target: { value: 'Plan setup and safety.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft Editable To-do List' }));

    expect(await screen.findByText('1 suggested to-do item')).toBeInTheDocument();
    expect(screen.getByText('Why Alex Santos was suggested')).toBeInTheDocument();
    expect(screen.getByLabelText('Task 1 deadline')).not.toHaveValue(expect.stringContaining('Z'));
    expect(document.body.textContent).not.toContain('000000Z');
    expect(document.body.textContent).not.toContain('Delegation score');

    fireEvent.click(screen.getByRole('button', { name: 'Add to-do' }));
    expect(screen.getByLabelText('Task 2 officer')).toHaveValue('');
    expect(screen.getByText('Review eligible officers, then choose the final assignee.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and Assign Tasks' })).toBeDisabled();
  });

  it('presents check-in as a live door-management workspace', async () => {
    const event = { id: 21, title: 'Foundation Day', status: 'ongoing', start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T17:00:00Z', location: 'University Gym', planning_details: { expected_participants: 200 } };
    const attendance = {
      event,
      count: 48,
      summary: { present: 44, late: 4, excused: 0, absent: 0 },
      records: [{ id: 1, user_id: 2400019, status: 'present', method: 'manual', check_in_time: '2026-10-12T08:10:00Z', user: { school_id: 2400019, first_name: 'Trisha', last_name: 'Herrera', program: 'BSIT', year_level: '4' } }],
    };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getAttendance.mockResolvedValue({ data: attendance });

    render(<MemoryRouter initialEntries={['/dashboard/events/check-in']}><EventsPage initialTab="attendance" /></MemoryRouter>);

    expect(await screen.findByRole('region', { name: 'Event check-in' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for Foundation Day' }));

    expect(await screen.findByText('Door controls')).toBeInTheDocument();
    expect(screen.getByText('Fingerprint check-in / checkout')).toBeInTheDocument();
    expect(screen.getByText(/scan, verify the matched student/i)).toBeInTheDocument();
    expect(screen.getByText(/required scope:/i)).toBeInTheDocument();
    expect(screen.getByText('Manual check-in')).toBeInTheDocument();
    expect(screen.getByText('Attendance log')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();
    expect(eventMocks.getAttendance).toHaveBeenCalledWith(21, { page: 1, per_page: 10 });
  });

  it('requires operator confirmation and sends optional academic fingerprint filters', async () => {
    const event = { id: 31, title: 'General Assembly', status: 'ongoing', start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T17:00:00Z', location: 'Gym' };
    const student = { school_id: 2400042, first_name: 'Ana', last_name: 'Reyes', role: 'STUDENT', department: 'College of Computer Studies', program: 'BSIT', year_level: '4th Year', section: 'A' };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getAttendance.mockResolvedValue({ data: { event, count: 0, summary: { present: 0, late: 0, excused: 0, absent: 0 }, records: [], pagination: { current_page: 1, last_page: 1, per_page: 10, total: 0 } } });
    userMocks.getUsers.mockResolvedValue({ data: [student], current_page: 1, last_page: 1, total: 1, per_page: 100 });
    userMocks.getAcademicStructure.mockResolvedValue({
      department: 'College of Computer Studies',
      programs: [{
        id: 7,
        name: 'BSIT',
        sections: [
          { id: 71, year_level: 4, name: '4-A' },
          { id: 72, year_level: 4, name: '4-B' },
        ],
      }],
    });
    Object.assign(fingerprintMocks.reader, { connected: true, error: null });
    fingerprintMocks.reader.identifyFingerprint.mockResolvedValue({ samples: ['probe'], sampleFormat: 5 });
    fingerprintMocks.identifyAttendanceFingerprint.mockResolvedValue({ data: {
      identified: true,
      user: student,
      action: 'check_in',
      match: { score: 91.2, threshold: 60 },
      confirmation_token: 'signed-confirmation',
    } });
    fingerprintMocks.confirmFingerprintAttendance.mockResolvedValue({ data: { user: student, action: 'checked_in', message: 'Ana Reyes was identified and checked in.' } });

    render(<MemoryRouter initialEntries={['/dashboard/events/check-in']}><EventsPage initialTab="attendance" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for General Assembly' }));
    await screen.findByText('Door controls');
    await screen.findByRole('option', { name: 'BSIT' });
    fireEvent.click(screen.getByLabelText('4th Year'));
    fireEvent.change(screen.getByLabelText('Fingerprint program filter'), { target: { value: 'BSIT' } });
    await screen.findByRole('option', { name: '4-B' });
    fireEvent.change(screen.getByLabelText('Fingerprint section filter'), { target: { value: '4-B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Scan Fingerprint' }));

    expect(await screen.findByText('Is this the correct Student?')).toBeInTheDocument();
    const confirmationModal = screen.getByRole('dialog', { name: 'Confirm Fingerprint Check-In' });
    expect(screen.getByText('91.2', { exact: false })).toBeInTheDocument();
    expect(fingerprintMocks.identifyAttendanceFingerprint).toHaveBeenCalledWith(31, { samples: ['probe'], sampleFormat: 5 }, {
      year_levels: ['4th Year'],
      programs: ['BSIT'],
      sections: ['4-B'],
    });
    expect(fingerprintMocks.confirmFingerprintAttendance).not.toHaveBeenCalled();

    fireEvent.click(within(confirmationModal).getByRole('button', { name: 'Confirm Check-In' }));
    await waitFor(() => expect(fingerprintMocks.confirmFingerprintAttendance).toHaveBeenCalledWith(31, 'signed-confirmation'));
    expect(await screen.findByText('Ana Reyes was identified and checked in.')).toBeInTheDocument();
  });

  it('does not render attendance controls for students', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 2400019, role: 'STUDENT' }));
    const event = { id: 22, title: 'Student Assembly', status: 'ongoing', start_time: '2020-01-01T08:00:00Z', end_time: '2099-01-01T17:00:00Z', location: 'Auditorium' };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getAttendance.mockResolvedValue({ data: { event, count: 0, summary: { present: 0, late: 0, excused: 0, absent: 0 }, records: [] } });

    render(<MemoryRouter initialEntries={['/dashboard/events/check-in']}><EventsPage initialTab="attendance" /></MemoryRouter>);

    expect(await screen.findByRole('region', { name: 'Event check-in' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for Student Assembly' }));

    await screen.findByText('No attendance records yet');
    expect(screen.queryByText('Personal attendance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check In to Event' })).not.toBeInTheDocument();
    expect(screen.queryByText('Door controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(eventMocks.recordAttendance).not.toHaveBeenCalled();
  });
});

describe('EventsPage delete', () => {
  const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym' };
  const renderEvents = () => render(<MemoryRouter initialEntries={['/dashboard/events/manage-events']}><EventsPage initialTab="events" /></MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getEventWorkflowHistory.mockResolvedValue({ data: [] });
    userMocks.getUsers.mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0, per_page: 100 });
    userMocks.getAcademicStructure.mockResolvedValue({ department: 'College of Computer Studies', programs: [] });
  });

  async function confirmDelete() {
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this event?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete event' }));
  }

  it('deletes an event after confirmation and reloads the list', async () => {
    eventMocks.deleteEvent.mockResolvedValue({ data: { message: 'Event deleted successfully.' } });
    renderEvents();
    await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' });
    const loads = eventMocks.getEvents.mock.calls.length;
    await confirmDelete();

    await waitFor(() => expect(eventMocks.deleteEvent).toHaveBeenCalledWith(7));
    await waitFor(() => expect(eventMocks.getEvents.mock.calls.length).toBeGreaterThan(loads));
  });

  it('shows the server message when the event cannot be deleted', async () => {
    eventMocks.deleteEvent.mockRejectedValue({ response: { status: 403, data: { message: 'You are not authorized to delete this event.' } } });
    renderEvents();
    await confirmDelete();

    const dialog = await screen.findByRole('dialog', { name: 'Delete this event?' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You are not authorized to delete this event.');
  });

  it('states everything an event delete removes', async () => {
    renderEvents();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this event?' });
    expect(dialog).toHaveTextContent(/tasks, attendance records, registrations, approval request and requirement files are deleted too/i);
    expect(dialog).toHaveTextContent(/Venue bookings are kept but unlinked/i);
  });

  it('does not offer delete to officers', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    renderEvents();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    expect(screen.getByRole('menuitem', { name: 'View event' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete event' })).not.toBeInTheDocument();
  });
});
