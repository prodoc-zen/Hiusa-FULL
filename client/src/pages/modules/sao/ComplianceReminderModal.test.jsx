import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ComplianceReminderModal from './ComplianceReminderModal';

const mocks = vi.hoisted(() => ({ sendComplianceReminder: vi.fn() }));
vi.mock('../../../services/complianceService', () => mocks);
const organization = { organization_id: 7, organization_name: 'Computing Society', requirements: [
  { requirement_type_id: 4, requirement_name: 'Constitution', status: 'approved' },
  { requirement_type_id: 5, requirement_name: 'Officer Roster', status: 'not_submitted' },
] };

describe('Compliance reminder', () => {
  beforeEach(() => vi.clearAllMocks());
  it('only offers unmet requirements and sends the selected requirement and message', async () => {
    mocks.sendComplianceReminder.mockResolvedValue({ data: { recipient_count: 12 } });
    const close = vi.fn();
    render(<ComplianceReminderModal organization={organization} onClose={close} />);
    expect(screen.queryByRole('option', { name: 'Constitution' })).not.toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send reminder' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Please submit a signed roster.' } });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.sendComplianceReminder).toHaveBeenCalledWith(7, { requirement_type_id: 5, message: 'Please submit a signed roster.' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
  it('keeps the message available after a failed send', async () => {
    mocks.sendComplianceReminder.mockRejectedValue({ response: { data: { message: 'This requirement has already been approved.' } } });
    render(<ComplianceReminderModal organization={organization} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: 'Please submit a signed roster.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been approved');
    expect(screen.getByLabelText(/^Message/)).toHaveValue('Please submit a signed roster.');
  });
});
