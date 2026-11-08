import { useState } from 'react';
import { handoverSystemAdmin } from '../../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';
import { Button, Drawer } from '../../../components/ui';
import PersonPicker from '../../../components/people/PersonPicker';

/**
 * Term turnover for one organization administrator: pick a successor from the
 * organization's members, and the successor takes the outgoing administrator's
 * position while the outgoing account is deactivated.
 */
export default function AdminHandoverDrawer({ admin, onClose, onDone }) {
  const [successor, setSuccessor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const outgoingName = admin ? `${admin.first_name} ${admin.last_name}` : '';
  const position = admin?.position_title || 'their administrator role';
  const organizationName = admin?.organization?.name || 'the organization';

  function close() {
    if (busy) return;
    setSuccessor(null);
    setError('');
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const { successor: appointed } = await handoverSystemAdmin(admin.school_id, { mode: 'existing', successor_school_id: successor.school_id });
      notify.success(`${appointed.first_name} ${appointed.last_name} now holds ${admin.position_title || 'the administrator role'}`, { description: `${outgoingName}'s account is inactive; their records stay in ${organizationName}'s history.` });
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
          <Button onClick={submit} disabled={!successor} loading={busy}>Hand over</Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <p className="rounded-control border border-line bg-subtle p-4 text-sm font-medium leading-6 text-ink-muted">
          The successor becomes the administrator of {organizationName} as {position}. {outgoingName}'s account is deactivated, not deleted, so everything they did stays in the audit trail under their name.
        </p>

        {admin && (
          <PersonPicker
            label="Who takes over?"
            scope="organization"
            organizationId={admin.organization_id}
            excludeIds={[admin.school_id]}
            value={successor}
            onSelect={(person) => { setSuccessor(person); setError(''); }}
            disabled={busy}
            hint={`Members of ${organizationName}. A student who has not signed up yet must create their account first.`}
          />
        )}

        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Drawer>
  );
}
