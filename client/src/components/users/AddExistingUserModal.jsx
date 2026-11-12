import { useEffect, useId, useState } from 'react';
import { Button, Drawer, Field, Select } from '../ui';
import PersonPicker from '../people/PersonPicker';
import { getProfileOrganizations, inviteAccountProfile } from '../../services/authService';
import { unwrapList } from '../../services/pagination';
import { searchPeople } from '../../services/peopleService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText';

const ROLE_OPTIONS = [
  { value: 'STUDENT', label: 'Member' },
  { value: 'SBO_OFFICER', label: 'Officer' },
  { value: 'ADMIN', label: 'Organization head' },
];

function personFromUser(user) {
  if (!user) return null;
  return {
    school_id: user.school_id,
    name: formatDisplayText(`${user.first_name || ''} ${user.last_name || ''}`.trim()),
    email: user.email,
    program: user.program,
  };
}

function mayNameHead(actorRole, target, organizations) {
  if (actorRole === 'DEPARTMENT_HEAD') return true;
  // The SAO names only the Admin of a university-wide organization, which has no dean.
  if (actorRole === 'SUPER_ADMIN') return Boolean(target?.is_university_wide);
  if (actorRole !== 'ADMIN' || !target?.parent_organization_id) return false;
  return organizations.some((item) => String(item.id) === String(target.parent_organization_id));
}

function scopeFor(actorRole, target) {
  if (actorRole === 'SUPER_ADMIN') return 'all';
  if (actorRole === 'DEPARTMENT_HEAD') return undefined;
  return target?.is_university_wide ? 'all' : 'college';
}

export default function AddExistingUserModal({ organization = null, initialUser = null, actorRole = null, initialRole = 'STUDENT', onClose, onAdded }) {
  const formId = useId();
  const [organizations, setOrganizations] = useState(organization ? [organization] : []);
  const [organizationId, setOrganizationId] = useState(organization ? String(organization.id) : '');
  const [selected, setSelected] = useState(() => personFromUser(initialUser));
  const [role, setRole] = useState(initialRole);
  const [optionsLoading, setOptionsLoading] = useState(!organization);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const headMode = initialRole === 'ADMIN';
  const target = organizations.find((item) => String(item.id) === organizationId);
  const headOffered = mayNameHead(actorRole, target, organizations);
  const targetId = target?.id;
  // The server accepts only a student of the chosen organization's college, so the picker asks for exactly those.
  const searchEligible = (params) => searchPeople({ ...params, eligible_for_organization_id: targetId });
  // The chosen role can go stale when the target is picked without the select (a single organization is auto-selected).
  const effectiveRole = role === 'ADMIN' && !headOffered ? 'STUDENT' : role;
  const headRefused = headMode && Boolean(target) && !headOffered;
  // Head wording only while the head role is the one that will be sent (or no organization is chosen yet to refuse it).
  const headWording = effectiveRole === 'ADMIN' || (role === 'ADMIN' && !target);
  // In head mode the select offers Member, so the fallback is worded as a member rather than a student.
  const memberWording = headMode && effectiveRole === 'STUDENT';

  useEffect(() => {
    if (organization) return undefined;
    let current = true;
    getProfileOrganizations().then((response) => {
      if (!current) return;
      const rows = unwrapList(response.data);
      setOrganizations(rows);
      setLoadError('');
      if (rows.length === 1) setOrganizationId(String(rows[0].id));
    }).catch((cause) => { if (current) setLoadError(getApiErrorMessage(cause, 'We could not load the organizations.')); })
      .finally(() => { if (current) setOptionsLoading(false); });
    return () => { current = false; };
  }, [organization, retry]);

  async function add(event) {
    event.preventDefault();
    if (!selected || !target || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await inviteAccountProfile({ school_id: selected.school_id, organization_id: target.id, role: effectiveRole });
      onAdded?.(response.data, selected);
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'We could not add this person.'));
    } finally { setBusy(false); }
  }

  return (
    <Drawer
      open
      title={headWording ? 'Add administrator' : memberWording ? 'Add a member' : 'Add an existing student'}
      description="They keep their own login and any other organizations they already belong to."
      onClose={() => !busy && onClose()}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form={formId} loading={busy} disabled={!selected || !target || optionsLoading}>{headWording ? 'Add administrator' : memberWording ? 'Add member' : 'Add student'}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={add} className="space-y-4">
        {organization ? (
          <p className="text-sm font-semibold text-ink">{formatDisplayText(organization.name)}</p>
        ) : (
          <Field label="Organization" required>
            <Select value={organizationId} disabled={busy || optionsLoading} onChange={(event) => {
              const next = organizations.find((item) => String(item.id) === event.target.value);
              setOrganizationId(event.target.value);
              setSelected((current) => (initialUser && current?.school_id === initialUser.school_id ? current : null));
              if (role === 'ADMIN' && !mayNameHead(actorRole, next, organizations)) setRole('STUDENT');
              setError('');
            }}>
              <option value="">{optionsLoading ? 'Loading organizations...' : 'Choose an organization'}</option>
              {organizations.map((item) => <option key={item.id} value={item.id}>{formatDisplayText(item.name)}{item.parent_organization_id ? ' (Suborganization)' : ''}</option>)}
            </Select>
          </Field>
        )}
        {loadError && (
          <p role="alert" className="text-sm font-semibold text-danger-strong">
            {loadError} <Button variant="secondary" size="sm" onClick={() => { setOptionsLoading(true); setRetry((value) => value + 1); }}>Try again</Button>
          </p>
        )}
        <PersonPicker
          label="Student"
          scope={scopeFor(actorRole, target)}
          excludeOrganizationId={targetId}
          search={targetId ? searchEligible : undefined}
          value={selected}
          onSelect={(person) => { setSelected(person); setError(''); }}
          disabled={busy}
          hint="Students without an account sign up themselves with their school ID."
        />
        <Field label="Role in this organization" hint={headRefused ? `Only the ${target.is_university_wide ? 'SAO' : 'Department Head'} can name another organization head, so this person can be added only as a member here.` : undefined}>
          <Select value={effectiveRole} disabled={busy} onChange={(event) => setRole(event.target.value)}>
            {ROLE_OPTIONS.filter((option) => actorRole === 'SUPER_ADMIN' ? option.value === 'ADMIN' && headOffered : option.value !== 'ADMIN' || headOffered).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </Field>
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </form>
    </Drawer>
  );
}
