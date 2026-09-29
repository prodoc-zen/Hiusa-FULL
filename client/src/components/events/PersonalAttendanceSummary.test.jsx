import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PersonalAttendanceSummary from './PersonalAttendanceSummary';

const getPersonalAttendance = vi.hoisted(() => vi.fn());
vi.mock('../../services/eventService', () => ({ getPersonalAttendance }));

describe('PersonalAttendanceSummary', () => {
  it('shows recorded metrics and event details without treating an absent timestamp as check-in', async () => {
    getPersonalAttendance.mockResolvedValue({ data: {
      summary: { attended: 1, missed: 1, rate: 50 },
      records: [
        { id: 1, status: 'present', method: 'manual', check_in_time: '2026-09-01T08:00:00Z', check_out_time: '2026-09-01T10:00:00Z', event: { title: 'Orientation', start_time: '2026-09-01T08:00:00Z' } },
        { id: 2, status: 'absent', method: 'manual', check_in_time: '2026-09-02T08:00:00Z', event: { title: 'Workshop', start_time: '2026-09-02T08:00:00Z' } },
      ],
      pagination: { current_page: 1, per_page: 10, total: 2 },
    } });

    render(<PersonalAttendanceSummary />);
    expect(await screen.findByText('Orientation')).toBeInTheDocument();
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('In: Not recorded')).toBeInTheDocument();
  });
});
