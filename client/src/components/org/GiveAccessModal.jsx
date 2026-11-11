import { useEffect, useId, useState } from 'react';
import PersonPicker from '../people/PersonPicker';
import { Button, Drawer, Field, Select } from '../ui';
import { getProfilePositions, inviteAccountProfile, updateAccountProfile } from '../../services/authService';
import { unwrapList } from '../../services/pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import { ACCESS_LEVELS, ORG_MODULES, grantableLevels } from './orgAccess';

const ALL_MODULES = ORG_MODULES.map((module) => module.key);

export default function GiveAccessModal({ organizationId, actorRole, profile = null, onClose, onSaved }) {
  const formId = useId();
  const levels = grantableLevels(actorRole);
  const editing = Boolean(profile);
  const [person, setPerson] = useState(null);
  const [role, setRole] = useState(profile?.role || levels[levels.length - 2] || levels[0] || 'STUDENT');
  const [position, setPosition] = useState(profile?.position_title || '');
  const [modules, setModules] = useState(profile?.modules || ALL_MODULES);
  const [positions, setPositions] = useState([]);
  const [positionsFailed, setPositionsFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let current = true;
    getProfilePositions(organizationId)
      .then((response) => { if (current) setPositions(unwrapList(response.data)); })
      .catch(() => { if (current) setPositionsFailed(true); });
    return () => { current = false; };
  }, [organizationId]);

  const rolePositions = positions.filter((item) => item.role === role);
  const needsModules = role === 'SBO_OFFICER';
  const canSave = (editing || person) && (!needsModules || modules.length > 0);

  function changeRole(event) {
    setRole(event.target.value);
    setPosition('');
  }

  function toggleModule(key) {
    setModules((current) => ALL_MODULES.filter((item) => (item === key ? !current.includes(key) : current.includes(item))));
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    setError('');
    setErrors({});
    const details = {
      role,
      position_title: role === 'STUDENT' ? null : position || null,
      ...(needsModules ? { modules } : {}),
    };
    try {
      if (editing) {
        await updateAccountProfile(profile.id, details);
      } else {
        await inviteAccountProfile({ school_id: person.school_id, organization_id: organizationId, ...details });
      }
      onSaved?.(editing ? `${profile.first_name} ${profile.last_name}` : person.name, editing);
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'We could not save this. Try again.'));
      setErrors(cause.response?.data?.errors || {});
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? 'Change access' : 'Give access';

  return (
    <Drawer
      open
      title={title}
      description={editing ? 'Update what this person can do in the organization.' : 'Pick a student from the college and choose what they can do in this organization.'}
      width="max-w-lg"
      onClose={busy ? undefined : onClose}
      closeOnEscape={!busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form={formId} loading={busy} disabled={!canSave}>{editing ? 'Save changes' : 'Give access'}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={save} className="space-y-4">
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
        {editing ? (
          <div>
            <p className="text-sm font-semibold text-ink">{profile.first_name} {profile.last_name}</p>
            <p className="text-xs text-ink-muted">{profile.email}</p>
          </div>
        ) : (
          <PersonPicker
            label="Student"
            scope="college"
            role="STUDENT"
            excludeOrganizationId={organizationId}
            onSelect={setPerson}
            error={errors.school_id?.[0]}
            disabled={busy}
          />
        )}
        <Field label="Access level" error={errors.role?.[0]}>
          <Select value={role} onChange={changeRole} disabled={busy}>
            {levels.map((level) => <option key={level} value={level}>{ACCESS_LEVELS[level].label}</option>)}
          </Select>
        </Field>
        {role !== 'STUDENT' && (
          <Field
            label="Position"
            optional
            hint={positionsFailed ? 'The position list did not load. You can leave this blank.' : rolePositions.length === 0 ? 'No positions are set up for this level yet.' : undefined}
            error={errors.position_title?.[0]}
          >
            <Select value={position} onChange={(event) => setPosition(event.target.value)} disabled={busy}>
              <option value="">No position</option>
              {rolePositions.map((item) => <option key={item.id} value={item.title}>{item.title}</option>)}
            </Select>
          </Field>
        )}
        {needsModules && (
          <fieldset>
            <legend className="text-[13px] font-medium text-ink">What can they open?</legend>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {ORG_MODULES.map((module) => (
                <label key={module.key} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-normal text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line accent-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    checked={modules.includes(module.key)}
                    onChange={() => toggleModule(module.key)}
                    disabled={busy}
                  />
                  {module.label}
                </label>
              ))}
            </div>
            {modules.length === 0 && <p role="alert" className="mt-1 text-xs font-semibold text-danger-strong">Pick at least one.</p>}
            {errors.modules?.[0] && <p role="alert" className="mt-1 text-xs font-semibold text-danger-strong">{errors.modules[0]}</p>}
          </fieldset>
        )}
      </form>
    </Drawer>
  );
}
