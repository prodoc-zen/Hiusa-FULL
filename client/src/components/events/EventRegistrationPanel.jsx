import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Users } from 'lucide-react';
import { cancelEventRegistration, getEventRegistrations, getMyEventRegistrations, registerForEvent } from '../../services/eventService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/dateTime';
import notify from '../../lib/notify';
import { Button, ProgressMeter, StatusBadge } from '../ui';

// A cancelled registration is a neutral outcome here, not the danger tone the
// shared status map gives cancelled requests.
const REGISTRATION_STATUS = {
  registered: { tone: 'info', label: 'Registered' },
  attended: { tone: 'success', label: 'Attended' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  no_show: { tone: 'warning', label: 'No-show' },
};

const isUpcoming = (event) => new Date(event.start_time).getTime() > Date.now();

function RegistrationBadge({ status }) {
  const meta = REGISTRATION_STATUS[status] || { tone: 'neutral', label: status };
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}

function ParticipantRegistration({ event }) {
  const [registration, setRegistration] = useState(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await getMyEventRegistrations();
      setRegistration([...(data.upcoming || []), ...(data.past || [])].find((item) => item.event_id === event.id) || null);
      setError('');
    } catch (cause) {
      setRegistration(null);
      setError(getApiErrorMessage(cause, 'Could not load your registration.'));
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  async function run(action, successMessage) {
    setBusy(true);
    setError('');
    try {
      await action(event.id);
      notify.success(successMessage, { description: event.title });
      await load();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Your registration could not be updated. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (registration === undefined) {
    return <div className="h-11 animate-pulse rounded-control bg-subtle" role="status" aria-label="Loading your registration" />;
  }

  const status = registration?.status;
  const open = event.status === 'approved' && isUpcoming(event);

  let message;
  let action = null;
  if (status === 'registered') {
    message = `You registered on ${formatDateTime(registration.registered_at)}. Organizers will expect you at check-in.`;
    if (isUpcoming(event)) {
      action = <Button variant="secondary" size="sm" loading={busy} onClick={() => run(cancelEventRegistration, 'Registration cancelled')}>Cancel registration</Button>;
    }
  } else if (status === 'attended') {
    message = 'Your attendance at this event is on record.';
  } else if (status === 'no_show') {
    message = 'You registered but no check-in was recorded for this event.';
  } else if (open) {
    message = status === 'cancelled'
      ? 'You cancelled earlier. You can register again while spots remain.'
      : 'Reserve your spot so organizers can plan seats, materials, and check-in.';
    action = <Button size="sm" loading={busy} onClick={() => run(registerForEvent, 'You are registered')}>Register for this event</Button>;
  } else {
    message = event.status === 'approved' ? 'Registration closed when this event started.' : 'Registration opens once this event is approved.';
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarCheck size={16} className="text-brand-700" aria-hidden="true" />
            <p className="text-sm font-bold text-ink">Your registration</p>
            {status && <RegistrationBadge status={status} />}
          </div>
          <p className="mt-1 text-xs font-medium leading-5 text-ink-muted">{message}</p>
        </div>
        {action}
      </div>
      {error && <p className="text-xs font-semibold text-danger-strong" role="alert">{error}</p>}
    </div>
  );
}

function OrganizerRoster({ event }) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const { data } = await getEventRegistrations(event.id, { page, per_page: 10 });
      setState({ loading: false, error: '', data });
    } catch (cause) {
      setState({ loading: false, error: getApiErrorMessage(cause, 'Could not load registrations.'), data: null });
    }
  }, [event.id, page]);

  useEffect(() => { load(); }, [load]);

  if (state.loading && !state.data) {
    return <div className="h-24 animate-pulse rounded-control bg-subtle" role="status" aria-label="Loading registrations" />;
  }
  if (state.error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-danger-strong" role="alert">{state.error}</p>
        <Button variant="secondary" size="sm" onClick={load}>Try again</Button>
      </div>
    );
  }

  const { summary, registrations = [], pagination } = state.data;
  const active = (summary.registered ?? 0) + (summary.attended ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-brand-700" aria-hidden="true" />
        <p className="text-sm font-bold text-ink">Registrations</p>
      </div>
      {summary.capacity ? (
        <ProgressMeter
          label="Seats taken"
          value={active}
          max={summary.capacity}
          valueLabel={`${active} of ${summary.capacity} · ${summary.remaining} left`}
        />
      ) : (
        <p className="text-xs font-medium text-ink-muted">{active} registered. Set expected participants on the event to cap registrations.</p>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Registered', summary.registered], ['Attended', summary.attended], ['No-show', summary.no_show], ['Cancelled', summary.cancelled]].map(([label, value]) => (
          <div key={label} className="rounded-control bg-subtle px-3 py-2">
            <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
            <dd className="mt-0.5 text-base font-extrabold tabular-nums text-ink">{value ?? 0}</dd>
          </div>
        ))}
      </dl>
      {registrations.length === 0 ? (
        <p className="text-xs font-medium text-ink-muted">No one has registered yet. Students see a Register button on this event once it is approved.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {registrations.map((registration) => {
            const person = registration.user;
            const name = person ? `${person.first_name} ${person.last_name}` : registration.user_id;
            const detail = [person?.program, person?.year_level, person?.section].filter(Boolean).join(' · ');
            return (
              <li key={registration.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{name}</p>
                  <p className="text-xs font-medium text-ink-muted">{detail || registration.user_id} · {formatDateTime(registration.registered_at)}</p>
                </div>
                <RegistrationBadge status={registration.status} />
              </li>
            );
          })}
        </ul>
      )}
      {pagination?.last_page > 1 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-muted">Page {pagination.current_page} of {pagination.last_page} · {pagination.total} total</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || state.loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= pagination.last_page || state.loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Event registration inside the event details: students reserve or release
 * a spot; organizers see capacity and who is coming.
 */
export default function EventRegistrationPanel({ event, role }) {
  if (role === 'STUDENT') {
    return (
      <section aria-label="Event registration" className="rounded-card border border-line p-4">
        <ParticipantRegistration event={event} />
      </section>
    );
  }

  if (['ADMIN', 'SBO_OFFICER'].includes(role)) {
    return (
      <section aria-label="Event registrations" className="rounded-card border border-line p-4">
        <OrganizerRoster event={event} />
      </section>
    );
  }

  return null;
}
