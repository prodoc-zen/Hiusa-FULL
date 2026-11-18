import { render, screen } from '@testing-library/react';
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
vi.mock('../../../services/userService', () => ({ getUsers: vi.fn(), getAcademicStructure: vi.fn() }));
vi.mock('../../../services/fingerprintService', () => ({ identifyAttendanceFingerprint: vi.fn(), confirmFingerprintAttendance: vi.fn() }));
vi.mock('../../../hooks/useFingerprintReader', () => ({ useFingerprintReader: () => ({ connected: false, scanning: false, error: '', retry: vi.fn() }) }));

const row = (creator) => ({ id: 7, title: 'Sports Fest 2024', status: 'approved', start_time: '2026-10-01T08:00:00Z', end_time: '2026-10-01T10:00:00Z', location: 'Gym', creator });
const page = (...rows) => ({ data: { data: rows, current_page: 1, last_page: 1, total: rows.length, per_page: 20 } });
const summary = { data: { summary: { attended: 0, missed: 0, rate: null }, records: [], pagination: { current_page: 1, last_page: 1, per_page: 5, total: 0 } } };

describe('Event row creator label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ school_id: 2100142, role: 'STUDENT' }));
    eventMocks.getPersonalAttendance.mockResolvedValue(summary);
  });

  const renderEvents = () => render(<MemoryRouter initialEntries={['/dashboard/events']}><EventsPage initialTab="events" /></MemoryRouter>);

  it('shows a readable role, not the raw enum, when the creator has no position title', async () => {
    eventMocks.getEvents.mockResolvedValue(page(row({ first_name: 'Juan', last_name: 'Dela Cruz', role: 'STUDENT', position_title: null })));
    renderEvents();
    await screen.findByText('Sports Fest 2024');
    expect(screen.getByText('Juan Dela Cruz · Student')).toBeInTheDocument();
    expect(screen.queryByText(/STUDENT/)).not.toBeInTheDocument();
  });

  it('still prefers the position title when the creator has one', async () => {
    eventMocks.getEvents.mockResolvedValue(page(row({ first_name: 'Ana', last_name: 'Reyes', role: 'SBO_OFFICER', position_title: 'Secretary' })));
    renderEvents();
    await screen.findByText('Sports Fest 2024');
    expect(screen.getByText('Ana Reyes · Secretary')).toBeInTheDocument();
  });
});
