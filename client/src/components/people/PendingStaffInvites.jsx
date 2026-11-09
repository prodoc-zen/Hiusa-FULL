import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, ErrorState, Skeleton } from '../ui';
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

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getStaffInvitations()
      .then((response) => { setInvites(Array.isArray(response.data?.data) ? response.data.data : []); setLoading(false); })
      .catch((cause) => { setError(getApiErrorMessage(cause, 'Could not load the pending links.')); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function copy(invite) {
    setBusyId(invite.id);
    try {
      const response = await relinkStaffInvitation(invite.id);
      await navigator.clipboard.writeText(response.data.magic_link);
      notify.success(`The link for ${invite.name} is copied. The earlier link no longer works.`);
      load();
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'Could not copy the link. Try again.'));
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(invite) {
    setBusyId(invite.id);
    try {
      await revokeStaffInvitation(invite.id);
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
              <p className="text-xs text-ink-muted">{[invite.position_title, `Expires ${formatDateTime(invite.expires_at)}`].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" leftIcon={Copy} loading={busyId === invite.id} onClick={() => copy(invite)} aria-label={`Copy link for ${invite.name}`}>Copy link</Button>
              <Button variant="secondary" size="sm" disabled={busyId === invite.id} onClick={() => revoke(invite)} aria-label={`Revoke link for ${invite.name}`}>Revoke</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
