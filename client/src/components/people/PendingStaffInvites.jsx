import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, ErrorState, Input, Skeleton } from '../ui';
import notify from '../../lib/notify';
import { getStaffInvitations, relinkStaffInvitation, revokeStaffInvitation } from '../../services/collegeOrganizationService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDateTime } from '../../utils/dateTime';

// Links the dean made that nobody has used yet. The link is never stored, so Copy link makes a new one
// (and the old one stops working), the same as the first time.
export default function PendingStaffInvites({ reloadKey = 0 }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [links, setLinks] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getStaffInvitations()
      .then((response) => { setInvites(Array.isArray(response.data?.data) ? response.data.data : []); setLoading(false); })
      .catch((cause) => { setError(getApiErrorMessage(cause, 'Could not load the pending links.')); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  // The new link is kept on screen as soon as it exists: making it kills the old one, so if the clipboard refuses
  // (Safari on a phone often does after a network wait) the dean can still select it and copy it by hand.
  async function copy(invite) {
    setBusyId(invite.id);
    let link = links[invite.id];
    try {
      if (!link) {
        const response = await relinkStaffInvitation(invite.id);
        link = response.data.magic_link;
        setLinks((existing) => ({ ...existing, [invite.id]: link }));
        load();
      }
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'Could not make a new link. Try again.'));
      setBusyId(null);
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      notify.success(`The link for ${invite.name} is copied. The earlier link no longer works.`);
    } catch {
      notify.error('Could not copy the link. Select it and copy it by hand.');
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(invite) {
    setBusyId(invite.id);
    try {
      await revokeStaffInvitation(invite.id);
      setLinks((existing) => Object.fromEntries(Object.entries(existing).filter(([id]) => Number(id) !== invite.id)));
      notify.success(`The link for ${invite.name} no longer works.`);
      load();
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'Could not revoke the link. Try again.'));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div role="status" aria-label="Loading pending links"><Skeleton className="h-10 w-full" /></div>;
  if (error) return <ErrorState title="Could not load the pending links" description={error} onRetry={load} className="px-0 py-4" />;
  if (invites.length === 0) return null;

  return (
    <section aria-label="Waiting for a reply" className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">Waiting for a reply ({invites.length})</h3>
      <ul className="divide-y divide-line-soft rounded-control border border-line bg-surface">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{invite.name}</p>
              <p className="text-xs text-ink-muted">{[invite.position_title || 'Office staff', `Expires ${formatDateTime(invite.expires_at)}`].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" leftIcon={Copy} loading={busyId === invite.id} onClick={() => copy(invite)} aria-label={`Copy link for ${invite.name}`}>Copy link</Button>
              <Button variant="secondary" size="sm" disabled={busyId === invite.id} onClick={() => revoke(invite)} aria-label={`Revoke link for ${invite.name}`}>Revoke</Button>
            </div>
            {links[invite.id] && (
              <div className="w-full">
                <Input readOnly value={links[invite.id]} aria-label={`New link for ${invite.name}`} onFocus={(event) => event.target.select()} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
