import { useEffect, useState } from 'react';
import ConfirmModal from '../ConfirmModal';
import { Button, Drawer, Field, Input } from '../ui';
import { deleteAccountProfile, getManagedAccountProfiles } from '../../services/authService';
import { listMeta, unwrapList } from '../../services/pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText';

export default function ManageAccountProfilesModal({ organization = null, user = null, onClose, onDeleted }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ lastPage: 1 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    getManagedAccountProfiles({ organization_id: organization?.id, user_school_id: user?.school_id, search: query, page, per_page: 20 })
      .then((response) => {
        if (!current) return;
        const items = unwrapList(response.data);
        const metadata = listMeta(response.data);
        if (!items.length && page > metadata.lastPage) { setPage(metadata.lastPage); return; }
        setRows(items);
        setMeta(metadata);
        setError('');
      })
      .catch((cause) => { if (current) { setRows([]); setError(getApiErrorMessage(cause, 'Unable to load profiles.')); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization?.id, user?.school_id, query, page, refresh]);

  async function remove() {
    if (!target || busy) return;
    setBusy(true);
    try {
      const response = await deleteAccountProfile(target.id);
      setTarget(null);
      setLoading(true);
      setRefresh((value) => value + 1);
      onDeleted?.(response.data);
    } catch (cause) {
      setTarget(null);
      setError(getApiErrorMessage(cause, 'Could not delete this profile.'));
    } finally { setBusy(false); }
  }

  const pendingSearch = search.trim() !== query;
  return <>
    {/* The list steps aside while the delete confirmation is up, so only one dialog is ever open. */}
    {!target && <Drawer open title="Manage user profiles" description="Remove access to an organization. Deleting the final profile also deletes the user's login. Linked records can prevent final deletion." onClose={() => !busy && onClose()}>
      {organization && <p className="mb-3 text-sm font-semibold text-ink">{formatDisplayText(organization.name)}</p>}
      {user && <p className="mb-3 text-sm font-semibold text-ink">{formatDisplayText(`${user.first_name} ${user.last_name}`)} · {user.school_id}</p>}
      <Field label="Search profiles">
        <Input value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} placeholder="Name, school ID, or email" />
      </Field>
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger-strong">{error} <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)} className="min-h-11 rounded-control font-semibold underline underline-offset-2">Retry</button></p>}
      {(loading || pendingSearch) ? <p role="status" className="mt-3 text-sm text-ink-muted">Loading profiles...</p> : <ul className="mt-4 divide-y divide-line-soft">
        {!rows.length && !error && <li className="py-4 text-sm text-ink-muted">{query ? 'No profiles match your search.' : 'No profiles found in the organizations you manage.'}</li>}
        {rows.map((profile) => <li key={profile.id} className="py-3 text-sm">
          <p className="break-words font-semibold text-ink">{formatDisplayText(`${profile.first_name} ${profile.last_name}`)} · {profile.school_id}</p>
          <p className="mt-1 break-words text-ink-muted">{formatDisplayText(profile.organization.name)} · {profile.role.replaceAll('_', ' ')}{profile.account_status !== 'active' ? ` · ${profile.account_status}` : ''}</p>
          <p className="mt-1 text-xs text-ink-muted">{profile.is_primary ? 'Primary profile' : 'Additional profile'} · {profile.profiles_count} total {profile.profiles_count === 1 ? 'profile' : 'profiles'}</p>
          {profile.deletion_block_reason && <p className="mt-2 text-xs text-ink-muted">{profile.deletion_block_reason}</p>}
          <Button variant="secondary" className="mt-2 text-danger-strong" aria-label={`Delete profile for ${profile.school_id} in ${profile.organization.name}`} disabled={busy || Boolean(profile.deletion_block_reason)} onClick={() => setTarget(profile)}>Delete profile</Button>
        </li>)}
      </ul>}
      {meta.lastPage > 1 && <nav aria-label="Profile pages" className="mt-4 flex items-center justify-between gap-2 text-sm"><Button variant="secondary" disabled={busy || loading || pendingSearch || page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="tabular-nums">Page {page} of {meta.lastPage}</span><Button variant="secondary" disabled={busy || loading || pendingSearch || page >= meta.lastPage} onClick={() => setPage(page + 1)}>Next</Button></nav>}
    </Drawer>}
    <ConfirmModal open={Boolean(target)} title="Delete organization profile" message={target?.profiles_count === 1 ? 'This is the final profile. Deleting it also permanently deletes the user account. Linked records will block deletion.' : 'Remove this organization profile and revoke its sessions. The user retains their other profiles and login.'} recordName={target ? `${target.first_name} ${target.last_name}, ${target.organization.name}` : ''} confirmationText={target ? `${target.first_name} ${target.last_name}`.trim() : ''} confirmText="Delete profile" busy={busy} onCancel={() => !busy && setTarget(null)} onConfirm={remove} />
  </>;
}
