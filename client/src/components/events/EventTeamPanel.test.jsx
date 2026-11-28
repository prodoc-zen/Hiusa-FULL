import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventTeamPanel from './EventTeamPanel';

const mocks = vi.hoisted(() => ({
  getEventPersonnel: vi.fn(),
  getAvailableEventPersonnel: vi.fn(),
  addEventPersonnel: vi.fn(),
  removeEventPersonnel: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../services/eventService', () => mocks);
vi.mock('../../lib/notify', () => ({ default: toasts }));

const event = { id: 9, title: 'Foundation Week', status: 'approved', organization_id: 5 };
const head = { id: 1, user_school_id: 2024001, name: 'Ana Reyes', role_label: 'Overall head' };
const logistics = { id: 2, user_school_id: 2024002, name: 'Ben Cruz', role_label: 'Logistics' };
const candidate = { school_id: 2024003, name: 'Carla Diaz', email: 'carla@example.com', position_title: 'Business Manager' };

describe('EventTeamPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventPersonnel.mockResolvedValue({ data: [head, logistics] });
    mocks.getAvailableEventPersonnel.mockResolvedValue({ data: [candidate] });
    mocks.addEventPersonnel.mockResolvedValue({ data: {} });
    mocks.removeEventPersonnel.mockResolvedValue({ data: {} });
  });

  it('lists the team with each role label', async () => {
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);

    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Overall head')).toBeInTheDocument();
    expect(screen.getByText('Ben Cruz')).toBeInTheDocument();
    expect(screen.getByText('Logistics')).toBeInTheDocument();
    expect(mocks.getEventPersonnel).toHaveBeenCalledWith(9);
  });

  it('lets the admin pick an available member, name the role and add them', async () => {
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);
    await screen.findByText('Ana Reyes');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Carl' } });
    const option = await screen.findByRole('option', { name: /Carla Diaz/ });
    expect(mocks.getAvailableEventPersonnel).toHaveBeenCalledWith(9, { q: 'Carl' });
    expect(option).toHaveTextContent('Business Manager');
    fireEvent.click(option);

    expect(screen.getByRole('button', { name: 'Add to team' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Role on the event'), { target: { value: ' Registration desk ' } });
    mocks.getEventPersonnel.mockResolvedValueOnce({ data: [head, logistics, { id: 3, user_school_id: 2024003, name: 'Carla Diaz', role_label: 'Registration desk' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }));

    await waitFor(() => expect(mocks.addEventPersonnel).toHaveBeenCalledWith(9, { user_school_id: 2024003, role_label: 'Registration desk' }));
    expect(await screen.findByText('Registration desk')).toBeInTheDocument();
    expect(screen.getByLabelText('Role on the event')).toHaveValue('');
    expect(toasts.success).toHaveBeenCalledWith('Added to the event team', { description: 'Carla Diaz' });
  });

  it('shows the server reason when adding fails and keeps the choice', async () => {
    mocks.addEventPersonnel.mockRejectedValue({ response: { status: 422, data: { message: 'That person is already on the event team.' } } });
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);
    await screen.findByText('Ana Reyes');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Carl' } });
    fireEvent.click(await screen.findByRole('option', { name: /Carla Diaz/ }));
    fireEvent.change(screen.getByLabelText('Role on the event'), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to team' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That person is already on the event team.');
    expect(screen.getByLabelText('Role on the event')).toHaveValue('Host');
  });

  it('removes a person with a labelled button and reloads the team', async () => {
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);
    await screen.findByText('Ben Cruz');

    mocks.getEventPersonnel.mockResolvedValueOnce({ data: [head] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ben Cruz from the event team' }));

    await waitFor(() => expect(mocks.removeEventPersonnel).toHaveBeenCalledWith(9, 2));
    await waitFor(() => expect(screen.queryByText('Ben Cruz')).not.toBeInTheDocument());
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
  });

  it('is read only for an officer', async () => {
    render(<EventTeamPanel event={event} role="SBO_OFFICER" />);

    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to team' })).not.toBeInTheDocument();
  });

  it('is read only for an admin of another organization, such as the college office opening a club event', async () => {
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={7} />);

    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Add person')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('is read only for an admin when the active organization is not known', async () => {
    render(<EventTeamPanel event={event} role="ADMIN" />);

    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('is read only for the dean', async () => {
    render(<EventTeamPanel event={event} role="DEPARTMENT_HEAD" />);

    expect(await screen.findByText('Ben Cruz')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('is read only for the admin once the event is cancelled or completed', async () => {
    render(<EventTeamPanel event={{ ...event, status: 'cancelled' }} role="ADMIN" organizationId={5} />);

    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('The team is fixed because this event is cancelled.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('renders nothing for a student', () => {
    const { container } = render(<EventTeamPanel event={event} role="STUDENT" />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.getEventPersonnel).not.toHaveBeenCalled();
  });

  it('says so when the team is empty', async () => {
    mocks.getEventPersonnel.mockResolvedValue({ data: [] });
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);

    expect(await screen.findByText('No one is on the event team yet')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows a loading state, then an error with a retry that works', async () => {
    mocks.getEventPersonnel
      .mockRejectedValueOnce({ response: { status: 500, data: { message: 'SQLSTATE broke' } } })
      .mockResolvedValueOnce({ data: [head] });
    render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);

    expect(screen.getByRole('status', { name: 'Loading the event team' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the event team.');
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ana Reyes')).toBeInTheDocument();
  });

  it('loads the new team when the details switch to another event', async () => {
    const { rerender } = render(<EventTeamPanel event={event} role="ADMIN" organizationId={5} />);
    await screen.findByText('Ana Reyes');

    mocks.getEventPersonnel.mockResolvedValue({ data: [{ id: 7, user_school_id: 2024009, name: 'Dina Lim', role_label: 'Host' }] });
    rerender(<EventTeamPanel event={{ ...event, id: 10 }} role="ADMIN" organizationId={5} />);

    expect(await screen.findByText('Dina Lim')).toBeInTheDocument();
    expect(screen.queryByText('Ana Reyes')).not.toBeInTheDocument();
    expect(mocks.getEventPersonnel).toHaveBeenLastCalledWith(10);
  });
});
