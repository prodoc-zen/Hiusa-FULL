import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from './EventsPage';

const eventMocks = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getPersonalAttendance: vi.fn(),
}));

vi.mock('../../../services/eventService', () => ({
  ...eventMocks,
  getMyEventRegistrations: vi.fn(() => Promise.resolve({ data: { upcoming: [], past: [] } })),
  getEventRequirements: vi.fn(() => Promise.resolve({ data: [] })),
}));
vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/taskService', () => ({ getTasks: vi.fn(() => Promise.resolve({ data: { data: [] } })), previewTaskRecommendation: vi.fn() }));
vi.mock('../../../services/venueService', () => ({ getVenues: vi.fn(() => Promise.resolve({ data: { data: [] } })) }));
vi.mock('../../../services/systemAdministrationService', () => ({ getAcademicPeriods: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../services/userService', () => ({ getUsers: vi.fn(), getAcademicStructure: vi.fn() }));
vi.mock('../../../services/fingerprintService', () => ({ identifyAttendanceFingerprint: vi.fn(), confirmFingerprintAttendance: vi.fn() }));
vi.mock('../../../hooks/useFingerprintReader', () => ({ useFingerprintReader: () => ({ connected: false, scanning: false, error: '', retry: vi.fn() }) }));

const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym' };
const page = (...rows) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 20 } });
const summary = (data) => ({ data: { summary: { attended: 0, missed: 0, rate: null }, records: [], pagination: { current_page: 1, last_page: 1, per_page: 5, total: 0 }, ...data } });
const renderEvents = () => render(<MemoryRouter initialEntries={['/dashboard/events']}><EventsPage initialTab="events" /></MemoryRouter>);
const lastListParams = () => eventMocks.getEvents.mock.calls.map(([params]) => params).filter((params) => params?.per_page === 20).at(-1);

describe('Student events list sort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 2100142, role: 'STUDENT' }));
    eventMocks.getEvents.mockResolvedValue(page(event));
    eventMocks.getPersonalAttendance.mockResolvedValue(summary());
  });

  it('defaults to Soonest and offers exactly the four orders', async () => {
    renderEvents();
    await screen.findByText('Sports Fest 2024');
    const select = screen.getByLabelText('Sort by');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Soonest', 'Latest date', 'Newest created', 'Title']);
    expect(select.value).toBe('start_asc');
    expect(lastListParams().sort).toBe('start_asc');
  });

  it.each([['start_desc', 'Latest date'], ['newest', 'Newest created'], ['title', 'Title']])('asks the server for %s when %s is chosen, keeping the search', async (sort) => {
    renderEvents();
    await screen.findByText('Sports Fest 2024');
    fireEvent.change(screen.getByPlaceholderText('Search events'), { target: { value: 'sports' } });
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: sort } });
    await waitFor(() => expect(lastListParams()).toMatchObject({ sort, search: 'sports', page: 1 }));
  });

  it('returns to the first page when the order changes', async () => {
    eventMocks.getEvents.mockResolvedValue({ data: { data: [event], current_page: 1, last_page: 2, total: 40, per_page: 20 } });
    renderEvents();
    await screen.findByText('Sports Fest 2024');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(lastListParams().page).toBe(2));
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'title' } });
    await waitFor(() => expect(lastListParams()).toMatchObject({ sort: 'title', page: 1 }));
  });
});

describe('Student My attendance panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 2100142, role: 'STUDENT' }));
    eventMocks.getEvents.mockResolvedValue(page(event));
  });

  it('shows attended, missed and rate on the events page', async () => {
    eventMocks.getPersonalAttendance.mockResolvedValue(summary({
      summary: { attended: 3, missed: 1, rate: 75 },
      records: [{ id: 1, status: 'late', method: 'manual', check_in_time: '2026-10-01T08:30:00Z', event: { title: 'Sports Fest 2024', start_time: '2026-10-01T08:00:00Z' } }],
      pagination: { current_page: 1, last_page: 1, per_page: 5, total: 1 },
    }));
    renderEvents();
    const panel = await screen.findByRole('region', { name: 'Personal attendance summary' });
    await within(panel).findByText('75%');
    expect(within(panel).getByText('Events attended').nextSibling).toHaveTextContent('3');
    expect(within(panel).getByText('Missed events').nextSibling).toHaveTextContent('1');
    expect(within(panel).getByText('Attendance rate').nextSibling).toHaveTextContent('75%');
  });

  it('says nothing is recorded yet instead of showing a rate for zero events', async () => {
    eventMocks.getPersonalAttendance.mockResolvedValue(summary());
    renderEvents();
    const panel = await screen.findByRole('region', { name: 'Personal attendance summary' });
    expect(await within(panel).findByText('No events recorded yet')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('NaN');
    expect(within(panel).queryByText('Attendance rate')).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent('%');
  });

  it('shows Not available, never NaN, when only excused records exist', async () => {
    eventMocks.getPersonalAttendance.mockResolvedValue(summary({
      records: [{ id: 1, status: 'excused', method: 'manual', event: { title: 'Sports Fest 2024', start_time: '2026-10-01T08:00:00Z' } }],
      pagination: { current_page: 1, last_page: 1, per_page: 5, total: 1 },
    }));
    renderEvents();
    const panel = await screen.findByRole('region', { name: 'Personal attendance summary' });
    expect(await within(panel).findByText('Not available')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('NaN');
  });

  it('offers a retry when the summary fails to load', async () => {
    eventMocks.getPersonalAttendance.mockRejectedValueOnce(new Error('offline'));
    eventMocks.getPersonalAttendance.mockResolvedValue(summary({ summary: { attended: 2, missed: 0, rate: 100 } }));
    renderEvents();
    const panel = await screen.findByRole('region', { name: 'Personal attendance summary' });
    expect(await within(panel).findByText('Unable to load your attendance records.')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText('100%')).toBeInTheDocument();
  });

  it('is not shown to other roles and does not call the student endpoint', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 900004, role: 'SBO_OFFICER' }));
    renderEvents();
    await screen.findByText('Sports Fest 2024');
    expect(screen.queryByRole('region', { name: 'Personal attendance summary' })).not.toBeInTheDocument();
    expect(eventMocks.getPersonalAttendance).not.toHaveBeenCalled();
  });
});
