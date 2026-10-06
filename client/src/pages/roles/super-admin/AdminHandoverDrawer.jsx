import { formatDisplayText } from '../../../utils/displayText.js';
import { useEffect, useState } from 'react';
import { getSystemOrganizationMembers, handoverSystemAdmin } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { humanizeIdentifier, ROLE_LABELS } from '../../../utils/displayText';
import notify from '../../../lib/notify';
import { Button, Drawer, Field, Input, SegmentedControl } from '../../../components/ui';

const MODES = [
  { value: 'existing', label: 'Existing member' },
  { value: 'new', label: 'New account' },
];
const EMPTY_ACCOUNT = { school_id: '', first_name: '', last_name: '', email: '', contact_number: '', password: '', password_confirmation: '' };

/**
 * Term turnover for one organization administrator: pick a successor from the
 * organization's members or create their account, and the successor takes the
 * outgoing administrator's position while the outgoing account is deactivated.
 */
export default function AdminHandoverDrawer({ admin, onClose, onDone }) {
  const [mode, setMode] = useState('existing');
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState({ loading: false, error: '', rows: [] });
  const [successorId, setSuccessorId] = useState(null);
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const outgoingName = admin ? `${admin.first_name} ${admin.last_name}` : '';
  const position = admin?.position_title || 'their administrator role';
  const organizationName = admin?.organization?.name || 'the organization';

  useEffect(() => {
    if (!admin || mode !== 'existing') return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setMembers((current) => ({ ...current, loading: true, error: '' }));
      try {
        const rows = await getSystemOrganizationMembers(admin.organization_id, search.trim() ? { search: search.trim() } : {});
        if (!cancelled) setMembers({ loading: false, error: '', rows: rows.filter((member) => member.school_id !== admin.school_id) });
      } catch (cause) {
        if (!cancelled) setMembers({ loading: false, error: getApiErrorMessage(cause, 'Members could not load.'), rows: [] });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [admin, mode, search]);

  function close() {
    if (busy) return;
    setMode('existing');
    setSearch('');
    setSuccessorId(null);
    setAccount(EMPTY_ACCOUNT);
    setError('');
    onClose();
  }

  const ready = mode === 'existing'
    ? Boolean(successorId)
    : Object.entries(account).every(([key, value]) => key === 'contact_number' || String(value).trim() !== '');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const payload = mode === 'existing' ? { mode, successor_school_id: successorId } : { mode, ...account, contact_number: account.contact_number || null };
      const { successor } = await handoverSystemAdmin(admin.school_id, payload);
      notify.success(`${successor.first_name} ${successor.last_name} now holds ${admin.position_title || 'the administrator role'}`, { description: `${outgoingName}'s account is inactive; their records stay in ${organizationName}'s history.` });
      setBusy(false);
      close();
      onDone();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'The handover did not go through. Try again.'));
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={Boolean(admin)}
      onClose={close}
      title="Hand over administrator role"
      description={admin ? `${outgoingName} · ${admin.position_title || 'No position'} · ${organizationName}` : undefined}
      width="max-w-lg"
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!ready} loading={busy}>Hand over</Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <p className="rounded-control border border-line bg-subtle p-4 text-sm font-medium leading-6 text-ink-muted">
          The successor becomes the administrator of {organizationName} as {position}. {outgoingName}'s account is deactivated, not deleted, so everything they did stays in the audit trail under their name.
        </p>

        <SegmentedControl options={MODES} value={mode} onChange={(value) => { setMode(value); setError(''); }} />

        {mode === 'existing' ? (
          <div className="space-y-3">
            <Field label="Find a member" hint="Students and officers whose primary organization is this one.">
              <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, School ID or email" />
            </Field>
            {members.error && <p role="alert" className="text-sm font-semibold text-danger-strong">{members.error}</p>}
            {members.loading && members.rows.length === 0 && <div className="h-24 animate-pulse rounded-control bg-subtle" role="status" aria-label="Loading members" />}
            {!members.loading && !members.error && members.rows.length === 0 && (
              <p className="text-sm font-medium text-ink-muted">No matching members. Check the spelling, or create a new account for the successor.</p>
            )}
            {members.rows.length > 0 && (
              <fieldset>
                <legend className="sr-only">Successor</legend>
                <ul className="divide-y divide-line-soft rounded-control border border-line">
                  {members.rows.map((member) => (
                    <li key={member.school_id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-subtle">
                        <input type="radio" name="successor" checked={successorId === member.school_id} onChange={() => setSuccessorId(member.school_id)} className="h-4 w-4 accent-brand-700" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">{formatDisplayText(member.first_name)} {formatDisplayText(member.last_name)}</span>
                          <span className="block text-xs font-medium text-ink-muted">{ROLE_LABELS[member.role] || humanizeIdentifier(member.role)}{member.position_title ? ` · ${formatDisplayText(member.position_title)}` : ''} · {member.school_id}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School ID" required className="sm:col-span-2">
              <Input inputMode="numeric" value={account.school_id} onChange={(event) => setAccount({ ...account, school_id: event.target.value })} />
            </Field>
            <Field label="First name" required>
              <Input value={account.first_name} onChange={(event) => setAccount({ ...account, first_name: event.target.value })} />
            </Field>
            <Field label="Last name" required>
              <Input value={account.last_name} onChange={(event) => setAccount({ ...account, last_name: event.target.value })} />
            </Field>
            <Field label="Email" required className="sm:col-span-2">
              <Input type="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} />
            </Field>
            <Field label="Contact number" className="sm:col-span-2">
              <Input type="tel" value={account.contact_number} onChange={(event) => setAccount({ ...account, contact_number: event.target.value })} />
            </Field>
            <Field label="Initial password" required hint="At least 8 characters. Share it privately; they can change it from their profile.">
              <Input type="password" autoComplete="new-password" value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} />
            </Field>
            <Field label="Confirm password" required>
              <Input type="password" autoComplete="new-password" value={account.password_confirmation} onChange={(event) => setAccount({ ...account, password_confirmation: event.target.value })} />
            </Field>
          </div>
        )}

        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Drawer>
  );
}
