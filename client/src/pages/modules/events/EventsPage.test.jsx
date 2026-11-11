import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import EventsPage from './EventsPage';
import { searchPeople } from '../../../services/peopleService';

vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));

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
  updateEventStatus: vi.fn(),
  getEventRequirements: vi.fn(() => Promise.resolve({ data: [] })),
}));
const taskMocks = vi.hoisted(() => ({ previewTaskRecommendation: vi.fn() }));
const venueMocks = vi.hoisted(() => ({ getVenues: vi.fn(() => Promise.resolve({ data: { data: [] } })) }));
const periodMocks = vi.hoisted(() => ({ getAcademicPeriods: vi.fn(() => Promise.resolve([])) }));

vi.mock('../../../services/eventService', () => ({
  ...eventMocks,
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  getMyEventRegistrations: vi.fn(() => Promise.resolve({ data: { upcoming: [], past: [] } })),
  getEventRegistrations: vi.fn(() => Promise.resolve({ data: { summary: { capacity: null, registered: 0, attended: 0, cancelled: 0, no_show: 0, remaining: null }, registrations: [], pagination: { current_page: 1, last_page: 1, per_page: 10, total: 0 } } })),
  registerForEvent: vi.fn(),
  cancelEventRegistration: vi.fn(),
  submitEventRequirements: vi.fn(),
}));

const userMocks = vi.hoisted(() => ({ getUsers: vi.fn(), getAcademicStructure: vi.fn() }));
const fingerprintMocks = vi.hoisted(() => ({
  useReader: vi.fn(),
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
  previewTaskRecommendation: taskMocks.previewTaskRecommendation,
}));
vi.mock('../../../services/venueService', () => ({ getVenues: venueMocks.getVenues }));
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: periodMocks.getAcademicPeriods }));

vi.mock('../../../services/userService', () => ({
  getUsers: userMocks.getUsers,
  getAcademicStructure: userMocks.getAcademicStructure,
}));

vi.mock('../../../hooks/useFingerprintReader', () => ({
  useFingerprintReader: () => { fingerprintMocks.useReader(); return fingerprintMocks.reader; },
}));

vi.mock('../../../services/fingerprintService', () => ({
  identifyAttendanceFingerprint: fingerprintMocks.identifyAttendanceFingerprint,
  confirmFingerprintAttendance: fingerprintMocks.confirmFingerprintAttendance,
}));

describe('EventsPage approval-request launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    localStorage.removeItem('hiusa_fingerprint_reader');
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

    expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Event name/)).toHaveValue('');
  });

  it('offers no Back to events button and cancels back to the request selector', async () => {
    function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
    render(<MemoryRouter initialEntries={['/dashboard/approval-requests/new/event']}><EventsPage initialTab="events" startEventRequest /><Where /></MemoryRouter>);

    await screen.findByRole('heading', { level: 1, name: 'New event' });
    expect(screen.queryByRole('button', { name: 'Back to events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Event' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/approval-requests/new');
  });

  it('keeps officer operations counts off the event list', async () => {
    const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym', present_count: 8, attendance_records_count: 9, tasks_count: 2 };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 20 } });
    render(<MemoryRouter initialEntries={['/dashboard/events/manage-events']}><EventsPage initialTab="events" /></MemoryRouter>);

    await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' });
    expect(screen.queryByRole('columnheader', { name: 'Present' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByText(/present \/ late/)).not.toBeInTheDocument();
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

  it('says on the event money panel that cash advances are not counted', async () => {
    const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym' };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getEvent.mockResolvedValue({ data: { ...event, budgets: [], financial_summary: { allocated_budget: 5000, spent: 1200, income: 300, remaining_budget: 4100, risk: 'low', latest_forecast: null } } });

    render(<MemoryRouter initialEntries={['/dashboard/events/manage-events']}><EventsPage initialTab="events" /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View event' }));

    expect(await screen.findByText('Cash advances are not counted here.')).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { level: 1, name: 'Planning' })).toBeInTheDocument();
    expect(screen.queryByText('Build an Event To-do List')).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'Leadership Summit' });
    fireEvent.change(screen.getByLabelText('Event', { exact: true }), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/^Planning context/), { target: { value: 'Plan setup and safety.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft to-do list' }));

    expect(await screen.findByText('1 suggested to-do item')).toBeInTheDocument();
    expect(screen.getByText('Why Alex Santos was suggested')).toBeInTheDocument();
    expect(screen.getByLabelText('Task 1 deadline')).not.toHaveValue(expect.stringContaining('Z'));
    expect(document.body.textContent).not.toContain('000000Z');
    expect(document.body.textContent).not.toContain('Delegation score');

    fireEvent.click(screen.getByRole('button', { name: 'Add to-do' }));
    expect(screen.getByLabelText('Task 2 officer')).toHaveValue('');
    expect(screen.getByText('Review eligible officers, then choose the final assignee.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and assign tasks' })).toBeDisabled();
  });

  it('shows a retryable error above check-in when the member roster fails to load', async () => {
    const event = { id: 21, title: 'Foundation Day', status: 'ongoing', start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T17:00:00Z', location: 'University Gym', planning_details: { expected_participants: 200 } };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getAttendance.mockResolvedValue({ data: { event, count: 0, summary: { present: 0, late: 0, excused: 0, absent: 0 }, records: [] } });
    userMocks.getUsers.mockRejectedValueOnce(new Error('network'));

    render(<MemoryRouter initialEntries={['/dashboard/events/check-in']}><EventsPage initialTab="attendance" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for Foundation Day' }));

    expect(await screen.findByText('The member list did not load')).toBeInTheDocument();
    const callsBeforeRetry = userMocks.getUsers.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByText('The member list did not load')).not.toBeInTheDocument());
    expect(userMocks.getUsers.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
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

    expect(await screen.findByText('Manual check-in')).toBeInTheDocument();
    expect(screen.getByText('Fingerprint check-in / checkout')).toBeInTheDocument();
    expect(screen.getByText(/connect the reader to this computer/i)).toBeInTheDocument();
    expect(fingerprintMocks.useReader).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect reader' }));
    expect(fingerprintMocks.useReader).toHaveBeenCalled();
    expect(screen.getByText(/required scope:/i)).toBeInTheDocument();
    expect(screen.getByText('Manual check-in')).toBeInTheDocument();
    expect(screen.queryByText('Door controls')).not.toBeInTheDocument();
    expect(screen.getByText('Attendance log')).toBeInTheDocument();
    expect(screen.getByText('24% of 200 expected')).toBeInTheDocument();
    expect(screen.queryByText('Check-in rate')).not.toBeInTheDocument();
    expect(eventMocks.getAttendance).toHaveBeenCalledWith(21, { page: 1, per_page: 20 });
  });

  it('checks a member in by finding their name, never by typing a school ID', async () => {
    const event = { id: 22, title: 'Orientation', status: 'ongoing', organization_id: 5, start_time: '2026-10-12T08:00:00Z', end_time: '2026-10-12T17:00:00Z', location: 'Gym', planning_details: {} };
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.getAttendance.mockResolvedValue({ data: { event, count: 0, summary: { present: 0, late: 0, excused: 0, absent: 0 }, records: [] } });
    eventMocks.recordAttendance.mockResolvedValue({ data: {} });
    vi.mocked(searchPeople).mockResolvedValue([{ school_id: 2400055, name: 'Ana Reyes', email: 'ana@example.edu', program: 'BSIT', role: 'STUDENT', organizations: [] }]);

    render(<MemoryRouter initialEntries={['/dashboard/events/check-in']}><EventsPage initialTab="attendance" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for Orientation' }));
    await screen.findByText('Manual check-in');
    expect(screen.queryByPlaceholderText(/school id/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Member' }), { target: { value: 'ana' } });
    fireEvent.click(await screen.findByRole('option', { name: /Ana Reyes/ }));
    expect(searchPeople).toHaveBeenCalledWith({ q: 'ana', organization_id: 5 });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Check-In/i }));

    await waitFor(() => expect(eventMocks.recordAttendance).toHaveBeenCalledWith(22, { user_id: 2400055, method: 'manual', status: 'present' }));
    expect(await screen.findByText('Check-in recorded.')).toBeInTheDocument();
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
    await screen.findByText('Manual check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Connect reader' }));
    await screen.findByRole('option', { name: 'BSIT' });
    fireEvent.click(screen.getByLabelText('4th Year'));
    fireEvent.change(screen.getByLabelText('Fingerprint program filter'), { target: { value: 'BSIT' } });
    await screen.findByRole('option', { name: '4-B' });
    fireEvent.change(screen.getByLabelText('Fingerprint section filter'), { target: { value: '4-B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Scan fingerprint' }));

    expect(await screen.findByText('Is this the correct Student?')).toBeInTheDocument();
    const confirmationModal = screen.getByRole('dialog', { name: 'Confirm fingerprint check-in' });
    expect(screen.getByText('91.2', { exact: false })).toBeInTheDocument();
    expect(fingerprintMocks.identifyAttendanceFingerprint).toHaveBeenCalledWith(31, { samples: ['probe'], sampleFormat: 5 }, {
      year_levels: ['4th Year'],
      programs: ['BSIT'],
      sections: ['4-B'],
    });
    expect(fingerprintMocks.confirmFingerprintAttendance).not.toHaveBeenCalled();

    fireEvent.click(within(confirmationModal).getByRole('button', { name: 'Confirm check-in' }));
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
    expect(screen.queryByText('Manual check-in')).not.toBeInTheDocument();
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

  it('offers Cancel instead of Delete once the server says the event cannot be deleted', async () => {
    const blocked = 'This event cannot be deleted because it has attendance records. Cancel it instead to keep the record.';
    eventMocks.getEvents.mockResolvedValue({ data: { data: [{ ...event, delete_blocked_reason: blocked }], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    eventMocks.updateEventStatus.mockResolvedValue({ data: { id: 7, status: 'cancelled' } });
    renderEvents();
    const loads = () => eventMocks.getEvents.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete event' })).not.toBeInTheDocument();
    const before = loads();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this event?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel event' }));

    await waitFor(() => expect(eventMocks.updateEventStatus).toHaveBeenCalledWith(7, 'cancelled'));
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
    expect(eventMocks.deleteEvent).not.toHaveBeenCalled();
  });

  it('offers neither action for a blocked event that is already cancelled', async () => {
    eventMocks.getEvents.mockResolvedValue({ data: { data: [{ ...event, status: 'cancelled', delete_blocked_reason: 'This event cannot be deleted because it has attendance records.' }], current_page: 1, last_page: 1, total: 1, per_page: 10 } });
    renderEvents();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
    expect(screen.getByRole('menuitem', { name: 'View event' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancel event' })).not.toBeInTheDocument();
  });
});

describe('EventsPage walkthrough fixes', () => {
  const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym' };
  const eventPage = (...rows) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 10 } });
  const renderAt = (path, initialTab) => render(<MemoryRouter initialEntries={[path]}><EventsPage initialTab={initialTab} /></MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    eventMocks.getEvents.mockResolvedValue(eventPage(event));
    eventMocks.getEventWorkflowHistory.mockResolvedValue({ data: [] });
    eventMocks.getEventRequirements.mockResolvedValue({ data: [] });
    eventMocks.getAttendance.mockResolvedValue({ data: { event, count: 0, summary: { present: 0, late: 0, excused: 0, absent: 0 }, records: [] } });
    userMocks.getUsers.mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0, per_page: 100 });
    userMocks.getAcademicStructure.mockResolvedValue({ department: 'College of Computer Studies', programs: [] });
    venueMocks.getVenues.mockResolvedValue({ data: { data: [{ id: 3, name: 'Audio-Visual Room' }] } });
    periodMocks.getAcademicPeriods.mockResolvedValue([]);
  });

  describe('the new event form', () => {
    it('lists the SAO documents set for all venues', async () => {
      eventMocks.getEventRequirements.mockResolvedValue({ data: [{ id: 1, name: 'Letter of intent', venue_type: 'all', is_active: true, is_optional: false }, { id: 2, name: 'Fire permit', venue_type: 'off_campus', is_active: true, is_optional: false }] });
      renderAt('/dashboard/events/manage-events?new=1', 'events');

      expect(await screen.findByText('Letter of intent')).toBeInTheDocument();
      expect(screen.queryByText('Fire permit')).not.toBeInTheDocument();
    });

    it('does not call a venue the server needs optional, and keeps Send proposal off until one is chosen', async () => {
      renderAt('/dashboard/events/manage-events?new=1', 'events');
      await screen.findByRole('heading', { name: 'New event' });
      fireEvent.change(screen.getByLabelText(/^Event name/), { target: { value: 'Orientation' } });
      fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: '2026-10-01' } });
      fireEvent.change(screen.getByLabelText(/^Start time/), { target: { value: '08:00' } });
      fireEvent.change(screen.getByLabelText(/^End date/), { target: { value: '2026-10-01' } });
      fireEvent.change(screen.getByLabelText(/^End time/), { target: { value: '10:00' } });

      expect(screen.getByLabelText('SAO venue')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send proposal' })).toBeDisabled();
      await screen.findByRole('option', { name: 'Audio-Visual Room' });
      fireEvent.change(screen.getByLabelText('SAO venue'), { target: { value: '3' } });
      expect(screen.getByRole('button', { name: 'Send proposal' })).toBeEnabled();

      fireEvent.change(screen.getByLabelText(/^Venue type/), { target: { value: 'off_campus' } });
      expect(screen.getByLabelText('Off-campus location')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send proposal' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Off-campus location'), { target: { value: 'Hotel Veneto' } });
      expect(screen.getByRole('button', { name: 'Send proposal' })).toBeEnabled();
    });
  });

  describe('the events list', () => {
    it.each([['approved', true], ['planning', true], ['completed', false], ['cancelled', false]])('offers Edit event for a %s event: %s', async (status, offered) => {
      eventMocks.getEvents.mockResolvedValue(eventPage({ ...event, status }));
      renderAt('/dashboard/events/manage-events', 'events');

      fireEvent.click(await screen.findByRole('button', { name: 'Actions for Sports Fest 2024' }));
      expect(await screen.findByRole('menuitem', { name: 'View event' })).toBeInTheDocument();
      expect(Boolean(screen.queryByRole('menuitem', { name: 'Edit event' }))).toBe(offered);
    });

    it('says the period is empty rather than that nothing was ever proposed when periods exist', async () => {
      periodMocks.getAcademicPeriods.mockResolvedValue([{ id: 8, status: 'active', number: 1, academic_year: { label: '2026-2027' } }]);
      eventMocks.getEvents.mockResolvedValue(eventPage());
      renderAt('/dashboard/events/manage-events', 'events');

      expect(await screen.findByText('No events in this academic period yet')).toBeInTheDocument();
      expect(screen.getByText(/Events from other periods are under Academic period/)).toBeInTheDocument();
      expect(screen.queryByText('No events proposed yet')).not.toBeInTheDocument();
    });
  });

  describe('planning to-dos', () => {
    const draft = (extra = {}) => ({
      data: {
        plan: 'Plan',
        ai_output: { id: 501 },
        workflow: {
          overview: 'Overview',
          preparation_phases: [],
          timeline: [],
          resources: [],
          logistics: [],
          risks: [],
          scheduling_conflicts: [],
          tasks: [{
            key: 'setup', title: 'Prepare the venue', description: '', phase: 'pre_event', priority: 'high', deadline: '2026-09-30T07:30:00.000000Z', depends_on_key: null, recommended_role: 'Secretary', assigned_to: 900007,
            recommendation: { rankings: [{ officer_id: 900007, rank: 1, name: 'Alex Santos', position_title: 'Treasurer', role_score: 100, workload_score: 80, performance_score: 90, final_score: 90 }] },
            ...extra,
          }],
        },
      },
    });
    const openDraft = async (response) => {
      eventMocks.generateEventPlan.mockResolvedValue(response);
      renderAt('/dashboard/events/event-planner', 'tasks');
      await screen.findByRole('option', { name: 'Sports Fest 2024' });
      fireEvent.change(screen.getByLabelText('Event', { exact: true }), { target: { value: '7' } });
      fireEvent.click(screen.getByRole('button', { name: 'Draft to-do list' }));
      await screen.findByText('1 suggested to-do item');
    };

    it('keeps the chosen officer when the task name is edited', async () => {
      await openDraft(draft());
      fireEvent.change(screen.getByLabelText('Task 1 title'), { target: { value: 'Prepare the venue and stage' } });

      expect(screen.getByLabelText('Task 1 officer')).toHaveValue('900007');
      expect(screen.getByRole('button', { name: 'Save and assign tasks' })).toBeEnabled();
    });

    it('says why when no officer is eligible instead of leaving an empty list', async () => {
      await openDraft(draft({ assigned_to: null, recommendation: { rankings: [] } }));
      taskMocks.previewTaskRecommendation.mockResolvedValue({ data: { delegation: { rankings: [] } } });
      fireEvent.click(screen.getByRole('button', { name: 'Review officers' }));

      expect(await screen.findByText(/No officer is eligible right now/)).toBeInTheDocument();
    });

    it('asks in the app dialog before removing a draft, not in the browser', async () => {
      const browserConfirm = vi.spyOn(window, 'confirm');
      eventMocks.discardEventWorkflow.mockResolvedValue({ data: {} });
      await openDraft(draft());
      fireEvent.click(screen.getByRole('button', { name: 'Remove draft' }));

      const dialog = await screen.findByRole('dialog', { name: 'Remove this draft?' });
      expect(browserConfirm).not.toHaveBeenCalled();
      expect(eventMocks.discardEventWorkflow).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove draft' }));
      await waitFor(() => expect(eventMocks.discardEventWorkflow).toHaveBeenCalledWith('7', 501));
      browserConfirm.mockRestore();
    });
  });

  describe('check-in', () => {
    it('reads 1 event, not 1 events', async () => {
      eventMocks.getEvents.mockResolvedValue(eventPage({ ...event, status: 'ongoing' }));
      renderAt('/dashboard/events/check-in', 'attendance');

      expect(await screen.findByText('1 event open for check-in')).toBeInTheDocument();
    });

    it('keeps the search and status filter when they find nobody, so they can be cleared', async () => {
      const ongoing = { ...event, status: 'ongoing' };
      const record = { id: 1, user_id: 2400019, status: 'present', method: 'manual', check_in_time: '2026-10-01T08:10:00Z', user: { school_id: 2400019, first_name: 'Trisha', last_name: 'Herrera' } };
      eventMocks.getEvents.mockResolvedValue(eventPage(ongoing));
      eventMocks.getAttendance.mockImplementation((id, params = {}) => Promise.resolve({ data: { event: ongoing, count: 1, summary: { present: 1, late: 0, excused: 0, absent: 0 }, records: params.search || params.status ? [] : [record] } }));
      renderAt('/dashboard/events/check-in', 'attendance');
      fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for Sports Fest 2024' }));
      const search = await screen.findByLabelText('Search attendance');

      fireEvent.change(search, { target: { value: 'qqzzx' } });
      expect((await screen.findAllByText('No attendance records match the filters.')).length).toBeGreaterThan(0);
      expect(screen.queryByText('No attendance records yet')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Filter attendance status')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Search attendance'), { target: { value: '' } });
      await waitFor(() => expect(screen.getAllByText('Trisha Herrera').length).toBeGreaterThan(0));
    });

    it('clears the member after a check-in so the next arrival can be searched', async () => {
      const ongoing = { ...event, status: 'ongoing', organization_id: 5 };
      eventMocks.getEvents.mockResolvedValue(eventPage(ongoing));
      eventMocks.getAttendance.mockResolvedValue({ data: { event: ongoing, count: 0, summary: { present: 0, late: 0, excused: 0, absent: 0 }, records: [] } });
      eventMocks.recordAttendance.mockResolvedValue({ data: {} });
      vi.mocked(searchPeople).mockResolvedValue([{ school_id: 2400055, name: 'Ana Reyes', email: 'ana@example.edu', program: 'BSIT', role: 'STUDENT', organizations: [] }]);
      renderAt('/dashboard/events/check-in', 'attendance');
      fireEvent.click(await screen.findByRole('button', { name: 'Open attendance for Sports Fest 2024' }));
      await screen.findByText('Manual check-in');
      fireEvent.change(screen.getByRole('combobox', { name: 'Member' }), { target: { value: 'ana' } });
      fireEvent.click(await screen.findByRole('option', { name: /Ana Reyes/ }));
      fireEvent.click(screen.getByRole('button', { name: /Confirm Check-In/i }));

      expect(await screen.findByText('Check-in recorded.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove Ana Reyes' })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Member' })).toBeInTheDocument();
    });
  });
});
