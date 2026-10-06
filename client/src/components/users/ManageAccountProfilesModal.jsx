import { useEffect, useState } from 'react';
import Modal from '../Modal';
import ConfirmModal from '../ConfirmModal';
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
    <Modal open={!target} title="Manage user profiles" description="Remove access to an organization. Deleting the final profile also deletes the user's login. Linked records can prevent final deletion." onClose={() => !busy && onClose()}>
      {organization && <p className="mb-3 text-sm font-bold text-[#0F2F62]">{formatDisplayText(organization.name)}</p>}
      {user && <p className="mb-3 text-sm font-bold text-[#0F2F62]">{formatDisplayText(`${user.first_name} ${user.last_name}`)} · {user.school_id}</p>}
      <label className="block text-sm font-semibold text-[#0F172A]">Search profiles<input value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} placeholder="Name, school ID, or email" className="mt-1 min-h-11 w-full rounded-lg border border-[#DDE7EF] px-3 outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20" /></label>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)} className="min-h-11 font-bold underline">Retry</button></p>}
      {(loading || pendingSearch) ? <p role="status" className="mt-3 text-sm text-[#64748B]">Loading profiles...</p> : <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
        {!rows.length && !error && <p className="text-sm text-[#64748B]">No profiles found in the organizations you manage.</p>}
        {rows.map((profile) => <article key={profile.id} className="rounded-lg border border-[#DDE7EF] p-3 text-sm">
          <p className="break-words font-bold text-[#0F172A]">{formatDisplayText(`${profile.first_name} ${profile.last_name}`)} · {profile.school_id}</p>
          <p className="mt-1 break-words text-[#64748B]">{formatDisplayText(profile.organization.name)} · {profile.role.replaceAll('_', ' ')} · {profile.account_status}</p>
          <p className="mt-1 text-xs text-[#64748B]">{profile.is_primary ? 'Primary profile' : 'Additional profile'} · {profile.profiles_count} total {profile.profiles_count === 1 ? 'profile' : 'profiles'}</p>
          {profile.deletion_block_reason && <p className="mt-2 text-xs text-[#64748B]">{profile.deletion_block_reason}</p>}
          <button type="button" aria-label={`Delete profile for ${profile.school_id} in ${profile.organization.name}`} disabled={busy || Boolean(profile.deletion_block_reason)} onClick={() => setTarget(profile)} className="mt-2 min-h-11 rounded-lg border border-red-200 px-3 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Delete profile</button>
        </article>)}
      </div>}
      {meta.lastPage > 1 && <nav aria-label="Profile pages" className="mt-4 flex items-center justify-between gap-2 text-sm"><button type="button" disabled={busy || loading || pendingSearch || page <= 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-50">Previous</button><span>Page {page} of {meta.lastPage}</span><button type="button" disabled={busy || loading || pendingSearch || page >= meta.lastPage} onClick={() => setPage(page + 1)} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-50">Next</button></nav>}
    </Modal>
    <ConfirmModal open={Boolean(target)} title="Delete organization profile" message={target?.profiles_count === 1 ? 'This is the final profile. Deleting it also permanently deletes the user account. Linked records will block deletion.' : 'Remove this organization profile and revoke its sessions. The user retains their other profiles and login.'} recordName={target ? `${target.first_name} ${target.last_name} — ${target.organization.name}` : ''} confirmationText={target ? String(target.school_id) : ''} confirmText="Delete profile" busy={busy} onCancel={() => !busy && setTarget(null)} onConfirm={remove} />
  </>;
}
