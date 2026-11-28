import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { addEventPersonnel, getAvailableEventPersonnel, getEventPersonnel, removeEventPersonnel } from '../../services/eventService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText';
import notify from '../../lib/notify';
import PersonPicker from '../people/PersonPicker';
import { Avatar, Button, Field, IconButton, Input, Skeleton } from '../ui';

const LOCKED_STATUSES = ['cancelled', 'completed'];
const ROLE_LABEL_MAX = 80;

const describeMember = (person) => [person.position_title, person.email].filter(Boolean).join(' · ');

function EventTeam({ event, canEdit }) {
  const [state, setState] = useState({ loading: true, error: '', members: [] });
  const [picked, setPicked] = useState(null);
  const [roleLabel, setRoleLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const { data } = await getEventPersonnel(event.id);
      setState({ loading: false, error: '', members: Array.isArray(data) ? data : [] });
    } catch (cause) {
      setState({ loading: false, error: getApiErrorMessage(cause, 'Could not load the event team.'), members: [] });
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  const searchAvailable = useCallback(
    (params) => getAvailableEventPersonnel(event.id, { q: params.q }).then((response) => response.data),
    [event.id],
  );

  async function add(submitEvent) {
    submitEvent.preventDefault();
    if (!picked || !roleLabel.trim()) return;
    setAdding(true);
    setActionError('');
    try {
      await addEventPersonnel(event.id, { user_school_id: picked.school_id, role_label: roleLabel.trim() });
      notify.success('Added to the event team', { description: picked.name });
      setPicked(null);
      setRoleLabel('');
      await load();
    } catch (cause) {
      setActionError(getApiErrorMessage(cause, 'Could not add this person. Try again.'));
    } finally {
      setAdding(false);
    }
  }

  async function remove(member) {
    setRemovingId(member.id);
    setActionError('');
    try {
      await removeEventPersonnel(event.id, member.id);
      notify.success('Removed from the event team', { description: member.name });
      await load();
    } catch (cause) {
      setActionError(getApiErrorMessage(cause, 'Could not remove this person. Try again.'));
    } finally {
      setRemovingId(null);
    }
  }

  if (state.loading && state.members.length === 0 && !state.error) {
    return <div role="status" aria-label="Loading the event team"><Skeleton className="h-24" /></div>;
  }

  if (state.error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-danger-strong" role="alert">{state.error}</p>
        <Button variant="secondary" size="sm" onClick={load}>Try again</Button>
      </div>
    );
  }

  const { members } = state;
  const locked = LOCKED_STATUSES.includes(event.status);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink">Event team</p>
        <p className="mt-0.5 text-xs font-medium text-ink-muted">
          {canEdit
            ? 'The people running this event, each with the part they play.'
            : locked && members.length > 0
              ? `The team is fixed because this event is ${event.status}.`
              : 'The people running this event.'}
        </p>
      </div>

      {members.length === 0 ? (
        <p className="text-xs font-medium text-ink-muted">No one is on the event team yet</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={member.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{formatDisplayText(member.name)}</p>
                <p className="truncate text-xs font-medium text-ink-muted">{member.role_label}</p>
              </div>
              {canEdit && (
                <IconButton
                  icon={Trash2}
                  variant="danger"
                  size="sm"
                  label={`Remove ${member.name} from the event team`}
                  disabled={removingId === member.id}
                  onClick={() => remove(member)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={add} className="space-y-3 border-t border-line pt-4">
          <PersonPicker
            label="Add person"
            placeholder="Type a member's name or email"
            search={searchAvailable}
            describe={describeMember}
            value={picked}
            onSelect={setPicked}
            excludeIds={members.map((member) => member.user_school_id)}
            disabled={adding}
          />
          <Field label="Role on the event" hint="For example Overall head or Logistics">
            <Input
              type="text"
              maxLength={ROLE_LABEL_MAX}
              value={roleLabel}
              onChange={(inputEvent) => setRoleLabel(inputEvent.target.value)}
              disabled={adding}
            />
          </Field>
          <Button type="submit" loading={adding} disabled={!picked || !roleLabel.trim()} className="w-full sm:w-auto">
            Add to team
          </Button>
        </form>
      )}

      {actionError && <p className="text-xs font-semibold text-danger-strong" role="alert">{actionError}</p>}
    </div>
  );
}

/**
 * The event team inside the event details: who runs the event and in what part. The organization's
 * administrator adds and removes people while the event is still live; officers and the dean read it.
 */
export default function EventTeamPanel({ event, role }) {
  if (!['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(role)) return null;

  return (
    <section aria-label="Event team" className="rounded-card border border-line p-4">
      <EventTeam key={event.id} event={event} canEdit={role === 'ADMIN' && !LOCKED_STATUSES.includes(event.status)} />
    </section>
  );
}
