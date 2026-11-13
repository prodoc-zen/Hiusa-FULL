import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RunoffScheduleForm from './RunoffScheduleForm';
import { isoToLocalDateTimeInput } from '../../utils/dateTime';

const { scheduleRunoff } = vi.hoisted(() => ({ scheduleRunoff: vi.fn() }));
vi.mock('../../services/electionService', () => ({ scheduleRunoff }));

const setValue = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const iso = (local) => new Date(local).toISOString();

describe('RunoffScheduleForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleRunoff.mockResolvedValue({ success: true });
  });

  it('asks for the three dates and keeps the button off until they are filled', () => {
    render(<RunoffScheduleForm electionId={5} />);
    expect(screen.getByLabelText('Runoff voting starts')).toBeInTheDocument();
    expect(screen.getByLabelText('Runoff voting ends')).toBeInTheDocument();
    expect(screen.getByLabelText('Results published')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule runoff' })).toBeDisabled();
  });

  it('sends the three instants and tells the page it is scheduled', async () => {
    const onScheduled = vi.fn();
    render(<RunoffScheduleForm electionId={5} onScheduled={onScheduled} />);
    setValue('Runoff voting starts', '2026-11-20T08:00');
    setValue('Runoff voting ends', '2026-11-20T17:00');
    setValue('Results published', '2026-11-21T09:00');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule runoff' }));
    await waitFor(() => expect(scheduleRunoff).toHaveBeenCalledWith(5, {
      runoff_starts_at: iso('2026-11-20T08:00'),
      runoff_ends_at: iso('2026-11-20T17:00'),
      runoff_publish_at: iso('2026-11-21T09:00'),
    }));
    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
  });

  it('checks the order inline and does not send a wrong one', () => {
    render(<RunoffScheduleForm electionId={5} />);
    setValue('Runoff voting starts', '2026-11-20T08:00');
    setValue('Runoff voting ends', '2026-11-20T07:00');
    setValue('Results published', '2026-11-20T06:00');
    expect(screen.getByText('Runoff voting must end after it starts.')).toBeInTheDocument();
    expect(screen.getByText('Results cannot be published before voting ends.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Schedule runoff' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(scheduleRunoff).not.toHaveBeenCalled();
  });

  it('offers Update schedule when a schedule is already set and shows it', () => {
    const initial = { starts_at: '2026-11-20T00:00:00.000Z', ends_at: '2026-11-20T09:00:00.000Z', publish_at: '2026-11-21T01:00:00.000Z' };
    render(<RunoffScheduleForm electionId={5} initial={initial} />);
    expect(screen.getByRole('button', { name: 'Update schedule' })).toBeEnabled();
    expect(screen.getByLabelText('Runoff voting starts')).toHaveValue(isoToLocalDateTimeInput(initial.starts_at));
  });

  it('shows the message the server returns', async () => {
    scheduleRunoff.mockRejectedValue({ response: { data: { message: 'The runoff must stay inside the semester.' } } });
    render(<RunoffScheduleForm electionId={5} />);
    setValue('Runoff voting starts', '2026-11-20T08:00');
    setValue('Runoff voting ends', '2026-11-20T17:00');
    setValue('Results published', '2026-11-21T09:00');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule runoff' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The runoff must stay inside the semester.');
  });
});
