import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EventsPage from './EventsPage';

const mocks = vi.hoisted(() => ({ getEvents: vi.fn(), getTasks: vi.fn(), getVenues: vi.fn() }));

vi.mock('../../../services/eventService', () => ({
  getEvents: mocks.getEvents,
  getPersonalAttendance: vi.fn(),
  getMyEventRegistrations: vi.fn(() => Promise.resolve({ data: { upcoming: [], past: [] } })),
  getEventRequirements: vi.fn(() => Promise.resolve({ data: [] })),
}));
vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));
vi.mock('../../../services/taskService', () => ({ getTasks: mocks.getTasks, previewTaskRecommendation: vi.fn() }));
vi.mock('../../../services/venueService', () => ({ getVenues: mocks.getVenues }));
vi.mock('../../../services/userService', () => ({ getUsers: vi.fn(), getAcademicStructure: vi.fn() }));
vi.mock('../../../services/fingerprintService', () => ({ identifyAttendanceFingerprint: vi.fn(), confirmFingerprintAttendance: vi.fn() }));
vi.mock('../../../hooks/useFingerprintReader', () => ({ useFingerprintReader: () => ({ connected: false, scanning: false, error: '', retry: vi.fn() }) }));

const event = { id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym' };
const page = (...rows) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 20 } });
const renderCalendar = () => render(<MemoryRouter initialEntries={['/dashboard/events/activity-calendar?view=list']}><EventsPage initialTab="events" /></MemoryRouter>);
const college = { id: 9, name: 'College of Computing', college: 'College of Computing', organization_type: 'COLLEGE' };

describe('Events page for the dean office staff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEvents.mockResolvedValue(page(event));
    mocks.getTasks.mockResolvedValue({ data: { data: [] } });
    mocks.getVenues.mockResolvedValue({ data: { data: [] } });
  });

  it('reads as the dean: no tasks or venues requests, no New event button, and the events load', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 950001, role: 'ADMIN', organization: college }));
    renderCalendar();

    await screen.findByText('Sports Fest 2024');
    expect(screen.queryByRole('button', { name: 'New event' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Events did not load/)).not.toBeInTheDocument();
    expect(mocks.getTasks).not.toHaveBeenCalled();
    expect(mocks.getVenues).not.toHaveBeenCalled();
  });

  it('still lets an organization Admin request events and loads their tasks and venues', async () => {
    localStorage.setItem('user', JSON.stringify({ school_id: 950002, role: 'ADMIN', organization: { id: 3, name: 'Debate Society', organization_type: 'STUDENT' } }));
    renderCalendar();

    expect(await screen.findByRole('button', { name: 'New event' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getTasks).toHaveBeenCalled());
    expect(mocks.getVenues).toHaveBeenCalled();
  });
});
