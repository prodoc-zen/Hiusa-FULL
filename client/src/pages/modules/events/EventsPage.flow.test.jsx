import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import EventsPage from './EventsPage';

const eventMocks = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getEvent: vi.fn(),
  getEventSubmission: vi.fn(),
  getMyEventRegistrations: vi.fn(),
  getEventRegistrations: vi.fn(),
  updateEventStatus: vi.fn(),
  getAttendance: vi.fn(),
}));

vi.mock('../../../services/eventService', () => ({
  ...eventMocks,
  recordAttendance: vi.fn(),
  generateEventPlan: vi.fn(),
  getEventWorkflowHistory: vi.fn(() => Promise.resolve({ data: [] })),
  confirmEventWorkflow: vi.fn(),
  discardEventWorkflow: vi.fn(),
  deleteEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  submitEventRequirements: vi.fn(),
  downloadEventRequirementFile: vi.fn(),
  registerForEvent: vi.fn(),
  cancelEventRegistration: vi.fn(),
  getPersonalAttendance: vi.fn(() => Promise.resolve({ data: { summary: {}, records: [], pagination: {} } })),
}));
vi.mock('../../../services/taskService', () => ({
  getTasks: vi.fn(() => Promise.resolve({ data: { data: [], current_page: 1, last_page: 1, total: 0, per_page: 10 } })),
  previewTaskRecommendation: vi.fn(),
}));
vi.mock('../../../services/userService', () => ({
  getUsers: vi.fn(() => Promise.resolve({ data: [], current_page: 1, last_page: 1, total: 0, per_page: 100 })),
  getAcademicStructure: vi.fn(() => Promise.resolve({ programs: [] })),
}));
vi.mock('../../../hooks/useFingerprintReader', () => ({
  useFingerprintReader: () => ({ connected: false, error: null, retry: vi.fn() }),
}));
vi.mock('../../../lib/notify', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const page = (rows) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 10 } });
const base = {
  id: 50,
  title: 'Founders Day',
  status: 'planning',
  start_time: '2030-10-01T08:00:00Z',
  end_time: '2030-10-01T10:00:00Z',
  location: 'Gym',
  requires_budget: false,
  budgets: [],
  tasks_count: 0,
  completed_tasks_count: 0,
  present_count: 0,
  approval_id: 9,
  approval_status: null,
  approval_remarks: null,
  approval_required_role: null,
  requirements_required: false,
  requirements_submitted: false,
  approval_stage: 'not_submitted',
};

const FIXTURES = {
  not_submitted: { ...base },
  awaiting_department_head: { ...base, approval_stage: 'awaiting_department_head', approval_status: 'pending', approval_required_role: 'DEPARTMENT_HEAD' },
  awaiting_requirements: { ...base, approval_stage: 'awaiting_requirements', approval_status: 'approved', requirements_required: true },
  awaiting_sao: { ...base, approval_stage: 'awaiting_sao', approval_status: 'pending', approval_required_role: 'SUPER_ADMIN', requirements_required: true, requirements_submitted: true },
  requirements_returned: { ...base, approval_stage: 'requirements_returned', approval_status: 'rejected', approval_remarks: 'The venue permit is expired.', requirements_required: true },
  approved: { ...base, status: 'approved', approval_stage: 'approved', approval_status: 'approved' },
  rejected: { ...base, approval_stage: 'rejected', approval_status: 'rejected', approval_remarks: 'Pick another date.' },
};

// What the drawer's NextStep says for each stage, per viewer. null means the NextStep shows no owner action.
const EXPECTED = {
  not_submitted: { ADMIN: 'Finish the proposal and submit it', DEPARTMENT_HEAD: 'Waiting for the Admin to submit the proposal', SBO_OFFICER: 'Waiting for the Admin to submit the proposal' },
  awaiting_department_head: { ADMIN: 'Waiting for Department Head approval', DEPARTMENT_HEAD: 'Review this event', SBO_OFFICER: 'Waiting for Department Head approval' },
  awaiting_requirements: { ADMIN: 'Submit the SAO event files', DEPARTMENT_HEAD: 'Waiting for the Admin to submit the SAO event files', SBO_OFFICER: 'Waiting for the Admin to submit the SAO event files' },
  awaiting_sao: { ADMIN: 'Waiting for SAO approval', DEPARTMENT_HEAD: 'Waiting for SAO approval', SBO_OFFICER: 'Waiting for SAO approval' },
  requirements_returned: { ADMIN: 'Returned: read the remarks, replace the files', DEPARTMENT_HEAD: 'Returned to the Admin for new files', SBO_OFFICER: 'Returned to the Admin for new files' },
  approved: { ADMIN: 'Plan the tasks', DEPARTMENT_HEAD: 'The organization is preparing this event', SBO_OFFICER: 'Plan the tasks' },
  rejected: { ADMIN: 'Returned: read the remarks, edit, resubmit', DEPARTMENT_HEAD: 'Returned to the Admin for changes', SBO_OFFICER: 'Returned to the Admin for changes' },
};

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <p data-testid="location">{location.pathname}{location.search}</p>
      <button type="button" onClick={() => navigate(-1)}>Go back</button>
    </div>
  );
}

function renderPage(path = '/dashboard/events/manage-events', props = {}, entries = [path]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <EventsPage initialTab="events" {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function openDrawer(title = 'Founders Day') {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${title}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'View event' }));
  const drawer = await screen.findByRole('dialog', { name: 'Event details' });
  await waitFor(() => expect(within(drawer).queryByRole('progressbar')).not.toBeInTheDocument());
  return drawer;
}

function useViewer(role, event) {
  localStorage.setItem('user', JSON.stringify({ role }));
  eventMocks.getEvents.mockResolvedValue(page([event]));
  eventMocks.getEvent.mockResolvedValue({ data: event });
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  eventMocks.getEvents.mockResolvedValue(page([]));
  eventMocks.getAttendance.mockResolvedValue({ data: { count: 0, summary: {}, records: [], pagination: { current_page: 1, last_page: 1, per_page: 10, total: 0 } } });
  eventMocks.getEventSubmission.mockResolvedValue({
    data: {
      requirements: [{ id: 1, name: 'Proposal', is_optional: false }, { id: 2, name: 'Permit', is_optional: false }, { id: 3, name: 'Waiver', is_optional: false }],
      files: [{ id: 11, requirement_id: 1, original_name: 'proposal.pdf', requirement: { name: 'Proposal' } }, { id: 12, requirement_id: 2, original_name: 'permit.pdf', requirement: { name: 'Permit' } }],
      approval_status: null,
    },
  });
  eventMocks.getMyEventRegistrations.mockResolvedValue({ data: { upcoming: [], past: [] } });
  eventMocks.getEventRegistrations.mockResolvedValue({ data: { summary: { capacity: null, registered: 0, attended: 0, cancelled: 0, no_show: 0, remaining: null }, registrations: [], pagination: { current_page: 1, last_page: 1, per_page: 10, total: 0 } } });
});

describe('event drawer stage and next action', () => {
  const cases = Object.keys(EXPECTED).flatMap((stage) => Object.keys(EXPECTED[stage]).map((role) => [stage, role, EXPECTED[stage][role]]));

  it.each(cases)('%s for %s says "%s"', async (stage, role, text) => {
    useViewer(role, FIXTURES[stage]);
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('list', { name: 'Event progress' })).toBeInTheDocument();
    expect(within(drawer).getByText(text)).toBeInTheDocument();
  });

  it('keeps Waiting for Department Head approval as a waiting callout with no button for the Admin', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    renderPage();
    const drawer = await openDrawer();

    const callout = within(drawer).getByText('Waiting for Department Head approval').closest('[role="status"]');
    expect(callout).not.toBeNull();
    expect(within(callout).queryByRole('button')).not.toBeInTheDocument();
    expect(within(callout).getByText('Owner: Department Head')).toBeInTheDocument();
    expect(within(drawer).queryByRole('link', { name: 'Open approval' })).not.toBeInTheDocument();
  });

  it('keeps Waiting for SAO approval as a waiting callout and names the SAO as owner', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_sao);
    renderPage();
    const drawer = await openDrawer();

    const callout = within(drawer).getByText('Waiting for SAO approval').closest('[role="status"]');
    expect(within(callout).getByText('Owner: SAO')).toBeInTheDocument();
    expect(within(callout).queryByRole('button')).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('link')).not.toBeInTheDocument();
  });

  it('gives the Department Head one action that opens the approval', async () => {
    useViewer('DEPARTMENT_HEAD', FIXTURES.awaiting_department_head);
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('link', { name: 'Open approval' })).toHaveAttribute('href', '/dashboard/department-head/approvals?record=9');
  });

  it('puts the Department Head step before the SAO files step in the stepper', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_requirements);
    renderPage();
    const drawer = await openDrawer();

    const labels = within(drawer).getByRole('list', { name: 'Event progress' }).querySelectorAll('li');
    const text = [...labels].map((item) => item.textContent);
    expect(text[1]).toContain('Department Head approval');
    expect(text[1]).toContain('Done');
    expect(text[2]).toContain('SAO files');
    expect(text[2]).toContain('Current step');
  });

  it('shows the SAO files checklist at its stage, right under the next step, with progress', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_requirements);
    renderPage();
    const drawer = await openDrawer();

    const panelTitle = await within(drawer).findByText('SAO event requirements');
    const nextStep = within(drawer).getByText('Submit the SAO event files');
    expect(nextStep.compareDocumentPosition(panelTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(drawer).findByText(/2 of 3 files uploaded\./)).toBeInTheDocument();
    expect(within(drawer).getAllByText('SAO event requirements')).toHaveLength(1);
  });

  it('puts the SAO files checklist after the details once the files stage is over', async () => {
    useViewer('ADMIN', { ...FIXTURES.approved, requirements_required: true, requirements_submitted: true });
    renderPage();
    const drawer = await openDrawer();

    const panelTitle = await within(drawer).findByText('SAO event requirements');
    const details = within(drawer).getByText('Preparation progress');
    expect(details.compareDocumentPosition(panelTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not mount the SAO files checklist when no requirements apply', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).queryByText('SAO event requirements')).not.toBeInTheDocument();
    expect(eventMocks.getEventSubmission).not.toHaveBeenCalled();
  });

  it('shows the SAO remarks when the SAO returned the files', async () => {
    useViewer('ADMIN', FIXTURES.requirements_returned);
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByText(/The venue permit is expired\./)).toBeInTheDocument();
    expect(within(drawer).getByText('Approval stage').nextSibling).toHaveTextContent('Returned by SAO');
  });

  it('offers the Admin one Edit proposal action before the proposal is submitted', async () => {
    useViewer('ADMIN', FIXTURES.not_submitted);
    renderPage();
    const drawer = await openDrawer();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit proposal' }));
    expect(await screen.findByRole('heading', { name: 'Edit event' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Event details' })).not.toBeInTheDocument();
  });

  it('shows the stepper but no Admin action to an officer', async () => {
    useViewer('SBO_OFFICER', FIXTURES.awaiting_department_head);
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('list', { name: 'Event progress' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('link')).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Edit proposal' })).not.toBeInTheDocument();
  });
});

describe('event step links', () => {
  it('sends Propose budget to the budget page with the event', async () => {
    useViewer('ADMIN', { ...FIXTURES.approved, requires_budget: true });
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('link', { name: 'Propose budget' })).toHaveAttribute('href', '/dashboard/finance/budget-allocation?event=50');
  });

  it('sends Book venue to venue booking with the event while the event is being prepared', async () => {
    useViewer('ADMIN', FIXTURES.approved);
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('link', { name: 'Book venue' })).toHaveAttribute('href', '/dashboard/venues?event=50');
    expect(within(drawer).getByRole('link', { name: 'Plan tasks' })).toHaveAttribute('href', '/dashboard/events/event-planner?event=50');
  });

  it('sends Prepare event report to financial reports with the event', async () => {
    useViewer('ADMIN', { ...FIXTURES.approved, status: 'completed' });
    renderPage();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('link', { name: 'Prepare event report' })).toHaveAttribute('href', '/dashboard/finance/transaction-history?event=50');
  });

  it('lets the Admin start the event from the drawer when every task is done', async () => {
    useViewer('ADMIN', { ...FIXTURES.approved, tasks_count: 2, completed_tasks_count: 2 });
    eventMocks.updateEventStatus.mockResolvedValue({ data: {} });
    renderPage();
    const drawer = await openDrawer();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Mark ongoing' }));
    await waitFor(() => expect(eventMocks.updateEventStatus).toHaveBeenCalledWith(50, 'ongoing'));
  });
});

describe('deep links', () => {
  it('opens the drawer for ?record= on a fresh load', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    renderPage('/dashboard/events/manage-events?record=50');

    const drawer = await screen.findByRole('dialog', { name: 'Event details' });
    expect(await within(drawer).findByText('Waiting for Department Head approval')).toBeInTheDocument();
    expect(eventMocks.getEvent).toHaveBeenCalledWith(50);
  });

  it('closes the drawer on Back and puts the record in the address when a row is opened', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    renderPage();
    await openDrawer();
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/events/manage-events?record=50');

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Event details' })).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/dashboard\/events\/manage-events$/);
  });

  it('removes ?record= when the drawer is closed from its button', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    renderPage('/dashboard/events/manage-events?record=50');
    await screen.findByRole('dialog', { name: 'Event details' });

    fireEvent.click(screen.getByRole('button', { name: 'Close event details' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Event details' })).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).not.toHaveTextContent('record=');
  });

  it('drops a ?record= that cannot be opened instead of leaving an empty drawer', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    eventMocks.getEvent.mockRejectedValue({ response: { status: 404, data: { message: 'Not found.' } } });
    renderPage('/dashboard/events/manage-events?record=999');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Event details' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('record='));
  });

  it('selects the calendar for ?view=calendar and writes the query when the view changes', async () => {
    useViewer('ADMIN', FIXTURES.approved);
    renderPage('/dashboard/events/manage-events?view=calendar');

    expect(await screen.findByRole('button', { name: 'Calendar view' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('view=list');

    fireEvent.click(screen.getByRole('button', { name: 'Calendar view' }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=calendar');
  });

  it('still selects the calendar on the activity-calendar path', async () => {
    useViewer('ADMIN', FIXTURES.approved);
    renderPage('/dashboard/events/activity-calendar');

    expect(await screen.findByRole('button', { name: 'Calendar view' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the new event form for ?new=1 and clears the flag', async () => {
    useViewer('ADMIN', FIXTURES.approved);
    renderPage('/dashboard/events/manage-events?new=1');

    expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('new=1'));
  });

  it('ignores ?new=1 for roles that cannot propose events', async () => {
    useViewer('SBO_OFFICER', FIXTURES.approved);
    renderPage('/dashboard/events/manage-events?new=1');

    await screen.findByRole('button', { name: 'Actions for Founders Day' });
    expect(screen.queryByRole('heading', { name: 'New event' })).not.toBeInTheDocument();
  });

  it('preselects the event on Planning for ?event=', async () => {
    useViewer('ADMIN', FIXTURES.approved);
    renderPage('/dashboard/events/event-planner?event=50', { initialTab: 'tasks' });

    await waitFor(() => expect(screen.getByLabelText('Event', { exact: true })).toHaveValue('50'));
  });

  it('preselects the event on Check-in for ?event=', async () => {
    useViewer('ADMIN', { ...FIXTURES.approved, status: 'ongoing' });
    renderPage('/dashboard/events/check-in?event=50', { initialTab: 'attendance' });

    await waitFor(() => expect(eventMocks.getAttendance).toHaveBeenCalledWith(50, expect.objectContaining({ page: 1 })));
  });
});

describe('page header and lists', () => {
  it('shows one h1 and a New event primary action for the Admin, and no stat strip on Planning', async () => {
    useViewer('ADMIN', FIXTURES.approved);
    const { unmount } = renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'New event' })).toBeInTheDocument();
    expect(screen.getByText('Total Events')).toBeInTheDocument();
    unmount();

    renderPage('/dashboard/events/event-planner', { initialTab: 'tasks' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Planning' })).toBeInTheDocument();
    expect(screen.queryByText('Total Events')).not.toBeInTheDocument();
  });

  it('gives an officer no New event button', async () => {
    useViewer('SBO_OFFICER', FIXTURES.approved);
    renderPage();

    await screen.findByRole('button', { name: 'Actions for Founders Day' });
    expect(screen.queryByRole('button', { name: 'New event' })).not.toBeInTheDocument();
  });

  it('shows a compact stepper on each row for managers', async () => {
    useViewer('ADMIN', FIXTURES.awaiting_department_head);
    renderPage();

    await screen.findByRole('button', { name: 'Actions for Founders Day' });
    expect(screen.getAllByText(/Step 2 of \d: Department Head approval/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('progressbar', { name: 'Progress of Founders Day' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Waiting for Department Head').length).toBeGreaterThan(0);
  });

  it('shows no approval stepper on a student row', async () => {
    useViewer('STUDENT', { ...FIXTURES.approved });
    renderPage();

    await screen.findByRole('button', { name: 'Actions for Founders Day' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('empty states', () => {
  it('invites the Admin to propose a first event and opens the form', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    renderPage();

    expect(await screen.findByText('No events proposed yet')).toBeInTheDocument();
    expect(screen.queryByText('No events found.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Propose your first event' }));
    expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
  });

  it('offers Clear filters when a search finds nothing', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    renderPage();
    await screen.findByText('No events proposed yet');

    fireEvent.change(screen.getByPlaceholderText('Search events'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument();
    const clear = screen.getAllByRole('button', { name: /Clear filters/ }).at(-1);
    fireEvent.click(clear);
    expect(await screen.findByText('No events proposed yet')).toBeInTheDocument();
  });

  it('tells an officer who proposes events', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER' }));
    renderPage();

    expect(await screen.findByText(/Only your organization's Admin can propose events/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose your first event' })).not.toBeInTheDocument();
  });

  it('tells a student what to do next', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT' }));
    renderPage();

    expect(await screen.findByText('No events to join yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read announcements' })).toHaveAttribute('href', '/dashboard/announcements/view-announcements');
  });

  it('sends the Department Head to Approvals when there are no events', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD' }));
    renderPage();

    expect(await screen.findByText('No events from your college yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', '/dashboard/department-head/approvals');
  });

  it('sends Planning to the new event form when there is no event to plan', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN' }));
    renderPage('/dashboard/events/event-planner', { initialTab: 'tasks' });

    expect(await screen.findByText('No event to plan yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Propose your first event' })).toHaveAttribute('href', '/dashboard/events/manage-events?new=1');
  });
});

describe('student registration path', () => {
  it('shows "You are registered" and the registration stepper in the event drawer', async () => {
    const event = { ...FIXTURES.approved, start_time: '2099-10-01T08:00:00Z', end_time: '2099-10-01T10:00:00Z' };
    useViewer('STUDENT', event);
    eventMocks.getMyEventRegistrations.mockResolvedValue({ data: { upcoming: [{ id: 1, event_id: 50, status: 'registered', registered_at: '2030-09-01T08:00:00Z' }], past: [] } });
    renderPage('/dashboard/events/activity-calendar?view=list');

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Founders Day' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View event' }));
    const drawer = await screen.findByRole('dialog', { name: 'Event details' });

    expect(await within(drawer).findByText('You are registered')).toBeInTheDocument();
    const steps = within(drawer).getByRole('list', { name: 'Your registration progress' });
    expect(within(steps).getByText('Register').closest('li')).toHaveTextContent('Done');
    expect(within(steps).getByText('Check in at the event').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(drawer).queryByRole('list', { name: 'Event progress' })).not.toBeInTheDocument();
  });
});
