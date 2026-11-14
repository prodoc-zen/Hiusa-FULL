import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActionCard from './ActionCard';

const service = vi.hoisted(() => ({ confirmAiAction: vi.fn(), cancelAiAction: vi.fn() }));
vi.mock('../../services/askAiService', () => service);

const future = () => new Date(Date.now() + 20 * 60000).toISOString();

const FIELDS = [
  { name: 'title', label: 'Title', type: 'text', required: true, value: 'General Assembly', max: 255, help: null, options: null },
  { name: 'details', label: 'Details', type: 'textarea', required: false, value: 'Bring your ID', max: null, help: 'Shown on the event page.', options: null },
  { name: 'start_time', label: 'Starts', type: 'datetime', required: true, value: '2026-12-05T15:00', max: null, help: null, options: null },
  { name: 'due', label: 'Due date', type: 'date', required: false, value: '2026-12-01', max: null, help: null, options: null },
  { name: 'capacity', label: 'Capacity', type: 'number', required: false, value: 40, max: null, help: null, options: null },
  { name: 'assigned_to', label: 'Assign to', type: 'select', required: false, value: '900004', max: null, help: 'Leave empty to decide later.', options: [{ value: '900004', label: 'Ana Cruz, Treasurer' }] },
  { name: 'public', label: 'Open to everyone', type: 'checkbox', required: false, value: true, max: null, help: null, options: null },
];

const message = (action = {}, extra = {}) => ({
  id: 8,
  role: 'assistant',
  content: 'Here is the event I can create.',
  payload: {
    action: {
      key: 'create_event',
      title: 'Create an event',
      status: 'awaiting_confirmation',
      submit_label: 'Create event',
      fields: FIELDS,
      errors: {},
      result: null,
      expires_at: future(),
      ...action,
    },
  },
  ...extra,
});

function renderCard({ msg = message(), live = true, onChange = vi.fn() } = {}) {
  render(
    <MemoryRouter>
      <ActionCard message={msg} action={msg.payload.action} live={live} onChange={onChange} />
    </MemoryRouter>,
  );
  return onChange;
}

const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

describe('ActionCard', () => {
  beforeEach(() => {
    service.confirmAiAction.mockReset();
    service.cancelAiAction.mockReset();
  });

  it('renders every field type with its label, value, help and required mark', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Create an event' })).toBeInTheDocument();
    const title = screen.getByLabelText(/^Title/);
    expect(title).toHaveValue('General Assembly');
    expect(title).toBeRequired();
    expect(screen.getAllByText('*')).toHaveLength(2);
    expect(screen.getByLabelText('Details')).toHaveValue('Bring your ID');
    expect(screen.getByText('Shown on the event page.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Starts/)).toHaveValue('2026-12-05T15:00');
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-12-01');
    expect(screen.getByLabelText('Capacity')).toHaveValue(40);
    expect(screen.getByLabelText('Assign to')).toHaveValue('900004');
    expect(screen.getByText('Leave empty to decide later.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Open to everyone' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('offers None on an optional select and a disabled Choose on a required one', () => {
    const select = { name: 'who', label: 'Who', type: 'select', required: false, value: null, max: null, help: null, options: [{ value: '1', label: 'Ana' }] };
    const { unmount } = render(
      <MemoryRouter>
        <ActionCard message={message({ fields: [select] })} action={message({ fields: [select] }).payload.action} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(Array.from(document.querySelectorAll('select option')).map((o) => o.value)).toEqual(['', '1']);
    unmount();
    const required = { ...select, required: true };
    render(
      <MemoryRouter>
        <ActionCard message={message({ fields: [required] })} action={message({ fields: [required] }).payload.action} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(Array.from(document.querySelectorAll('select option')).map((o) => o.value)).toEqual(['', '1']);
    expect(document.querySelector('select option').disabled).toBe(true);
  });

  it('sends the edited values once even when the button is pressed twice', async () => {
    let finish;
    service.confirmAiAction.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onChange = renderCard();
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Assembly 2026' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '55' } });
    fireEvent.click(screen.getByLabelText('Open to everyone'));
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '' } });

    const button = screen.getByRole('button', { name: 'Create event' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(button.closest('form'));

    expect(service.confirmAiAction).toHaveBeenCalledTimes(1);
    expect(service.confirmAiAction).toHaveBeenCalledWith(8, {
      title: 'Assembly 2026',
      details: null,
      start_time: '2026-12-05T15:00',
      due: '2026-12-01',
      capacity: 55,
      assigned_to: '900004',
      public: false,
    });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute('readonly');

    const done = message({ status: 'done' }, { content: 'Event created.' });
    await act(async () => finish({ data: { message: done } }));
    expect(onChange).toHaveBeenCalledWith(done);
  });

  it('shows field errors on a 422 and keeps what the person typed', async () => {
    const returned = message({ errors: { title: ['The title is too long.'], _: ['Could not reach the calendar.'] } });
    service.confirmAiAction.mockRejectedValue(refusal(422, {
      message: 'Fix the highlighted fields.',
      errors: { title: ['The title is too long.'], _: ['Could not reach the calendar.'] },
      assistant_message: returned,
    }));
    const onChange = renderCard();
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'My typed title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(await screen.findByText('The title is too long.')).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
    expect(alerts).toContain('Could not reach the calendar.');
    expect(screen.getByLabelText(/^Title/)).toHaveValue('My typed title');
    expect(screen.getByLabelText(/^Title/)).not.toHaveAttribute('readonly');
    expect(onChange).toHaveBeenCalledWith(returned);
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
  });

  it.each([409, 404])('turns read only with the server message on a %s', async (status) => {
    service.confirmAiAction.mockRejectedValue(refusal(status, { message: 'This request was already handled.' }));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('This request was already handled.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute('readonly');
  });

  it('shows one plain line for any other failure and lets the person try again', async () => {
    service.confirmAiAction.mockRejectedValueOnce(refusal(500, { message: 'SQLSTATE secret' }));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText('Could not complete that. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled());
    service.confirmAiAction.mockResolvedValueOnce({ data: { message: message({ status: 'done' }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(service.confirmAiAction).toHaveBeenCalledTimes(2));
  });

  it('cancels and hands back the returned message', async () => {
    const cancelled = message({ status: 'cancelled' });
    service.cancelAiAction.mockResolvedValue({ data: { message: cancelled } });
    const onChange = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(cancelled));
    expect(service.cancelAiAction).toHaveBeenCalledWith(8);
    expect(service.confirmAiAction).not.toHaveBeenCalled();
  });

  it('shows the result and a link once done, with no form', () => {
    renderCard({ msg: message({ status: 'done', result: { message: 'Event created. It is waiting for approval.', href: '/dashboard/events/5', action_label: 'Open event' } }) });
    expect(screen.getByText('Event created. It is waiting for approval.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open event/ })).toHaveAttribute('href', '/dashboard/events/5');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
  });

  it('shows no link when done without an address', () => {
    renderCard({ msg: message({ status: 'done', result: { message: 'Saved.', href: null, action_label: null } }) });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['cancelled', /cancelled/],
    ['failed', /did not go through/],
    ['expired', /expired/],
  ])('shows one muted line for %s and no form', (status, pattern) => {
    renderCard({ msg: message({ status }) });
    expect(screen.getByText(pattern)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
  });

  it('shows a card past its expiry as expired even when it still says awaiting', () => {
    renderCard({ msg: message({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    expect(screen.getByText(/expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
  });

  it('expires on screen when the time passes', () => {
    vi.useFakeTimers();
    try {
      renderCard({ msg: message({ expires_at: new Date(Date.now() + 5000).toISOString() }) });
      expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(6000); });
      expect(screen.getByText(/expired/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an older awaiting card read only with a line saying a newer request replaced it', () => {
    renderCard({ live: false });
    expect(screen.getByText('A newer request replaced this one.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: 'Open to everyone' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
  });

  it('shows a disabled empty first option when a select has no value, required or not, and sends null', async () => {
    const options = [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }];
    const fields = [
      { name: 'pick', label: 'Pick one', type: 'select', required: true, value: null, options },
      { name: 'maybe', label: 'Maybe', type: 'select', required: false, value: '', options },
    ];
    service.confirmAiAction.mockResolvedValue({ data: { message: { id: 8, role: 'assistant', payload: { action: { status: 'done', title: 'x', result: { message: 'ok' } } } } } });
    renderCard({ msg: message({ fields }) });
    const pick = screen.getByLabelText(/Pick one/);
    expect(pick.options[0]).toHaveTextContent('Choose an option');
    expect(pick.options[0].disabled).toBe(true);
    expect(pick.selectedOptions[0]).toBe(pick.options[0]);
    expect(pick).toHaveValue('');
    const maybe = screen.getByLabelText(/Maybe/);
    expect(maybe.selectedOptions[0]).toHaveTextContent('None');
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(service.confirmAiAction).toHaveBeenCalled());
    expect(service.confirmAiAction.mock.calls[0][1]).toEqual({ pick: null, maybe: null });
    fireEvent.change(pick, { target: { value: '2' } });
    expect(pick.selectedOptions[0]).toHaveTextContent('Two');
  });

  it('ties a checkbox help and error to the checkbox', () => {
    const fields = [{ name: 'public', label: 'Open to everyone', type: 'checkbox', required: false, value: false, help: 'Anyone can join.', options: null }];
    const { rerender } = render(
      <MemoryRouter>
        <ActionCard message={message({ fields })} action={message({ fields }).payload.action} live onChange={vi.fn()} />
      </MemoryRouter>,
    );
    const box = screen.getByRole('checkbox');
    const help = screen.getByText('Anyone can join.');
    expect(help.id).toBeTruthy();
    expect(box.getAttribute('aria-describedby')).toBe(help.id);
    const withError = message({ fields, errors: { public: ['Pick yes.'] } });
    rerender(
      <MemoryRouter>
        <ActionCard key="e" message={withError} action={withError.payload.action} live onChange={vi.fn()} />
      </MemoryRouter>,
    );
    const alert = screen.getByText('Pick yes.');
    expect(alert.id).toBeTruthy();
    expect(screen.getByRole('checkbox').getAttribute('aria-describedby')).toBe(alert.id);
  });
});
