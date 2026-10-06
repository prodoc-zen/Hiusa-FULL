import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import Modal from '../Modal';
import { getProfileCandidates, getProfileOrganizations, inviteAccountProfile } from '../../services/authService';
import { listMeta, unwrapList } from '../../services/pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText';

const control = 'mt-1 min-h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm text-[#0F172A] outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20 disabled:bg-slate-100';

export default function AddExistingUserModal({ organization = null, initialUser = null, actorRole = null, onClose, onAdded }) {
  const formId = useId();
  const [organizations, setOrganizations] = useState(organization ? [organization] : []);
  const [organizationId, setOrganizationId] = useState(organization ? String(organization.id) : '');
  const [search, setSearch] = useState(initialUser ? String(initialUser.school_id) : '');
  const [query, setQuery] = useState(search);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState('STUDENT');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ lastPage: 1, total: 0 });
  const [loading, setLoading] = useState(Boolean(organization));
  const [optionsLoading, setOptionsLoading] = useState(!organization);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const target = organizations.find((item) => String(item.id) === organizationId);

  useEffect(() => {
    if (organization) return undefined;
    let current = true;
    getProfileOrganizations().then((response) => {
      if (current) setOrganizations(unwrapList(response.data));
    }).catch((cause) => { if (current) setError(getApiErrorMessage(cause, 'Unable to load organizations.')); })
      .finally(() => { if (current) setOptionsLoading(false); });
    return () => { current = false; };
  }, [organization, retry]);

  useEffect(() => {
    if (search.trim() === query) return undefined;
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search, query]);

  function loadCandidates() {
    if (!organizationId) return undefined;
    let current = true;
    setLoading(true);
    getProfileCandidates({ organization_id: Number(organizationId), search: query, page, per_page: 20 })
      .then((response) => {
        if (!current) return;
        setUsers(unwrapList(response.data));
        setMeta(listMeta(response.data));
        setError('');
      }).catch((cause) => { if (current) { setUsers([]); setError(getApiErrorMessage(cause, 'Unable to find existing users.')); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }
  useEffect(loadCandidates, [organizationId, query, page, retry]);

  function chooseOrganization(value) {
    setOrganizationId(value);
    setSelected(null);
    setUsers([]);
    setError('');
    setPage(1);
    setLoading(Boolean(value));
  }

  async function add(event) {
    event.preventDefault();
    if (!selected || !target || busy || loading || pendingSearch || error) return;
    setBusy(true);
    setError('');
    try {
      const response = await inviteAccountProfile({ school_id: selected.school_id, organization_id: target.id, role });
      onAdded?.(response.data);
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not add this user.'));
    } finally { setBusy(false); }
  }

  const pendingSearch = query !== search.trim();
  return <Modal open title="Add existing user" description="Add an organization profile to an existing login. The user's other profiles stay available." onClose={() => !busy && onClose()}
    footer={<><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0F2F62]">Cancel</button><button type="submit" form={formId} disabled={busy || loading || pendingSearch || !selected || !target || Boolean(error)} className="min-h-11 rounded-lg bg-[#0878B7] px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Adding...' : 'Add user'}</button></>}>
    <form id={formId} onSubmit={add} className="space-y-4">
      {organization ? <p className="text-sm font-bold text-[#0F2F62]">{formatDisplayText(organization.name)}</p> : <label className="block text-sm font-semibold text-[#0F172A]">Destination organization<select value={organizationId} disabled={busy || optionsLoading} onChange={(event) => chooseOrganization(event.target.value)} className={control}><option value="">{optionsLoading ? 'Loading organizations...' : 'Choose an organization'}</option>{organizations.map((item) => <option key={item.id} value={item.id}>{formatDisplayText(item.name)}{item.parent_organization_id ? ' (Suborganization)' : ''}</option>)}</select></label>}
      {target && <p className="rounded-lg bg-[#EEF6FB] p-3 text-xs text-[#0F2F62]">College: <strong>{formatDisplayText(target.college) || 'Not assigned'}</strong>. Only eligible users from this college who are not already members are listed.</p>}
      <label className="block text-sm font-semibold text-[#0F172A]">Search existing users<span className="relative block"><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" /><input value={search} disabled={busy || !target} onChange={(event) => { setSearch(event.target.value); setSelected(null); }} placeholder="Name, school ID, or email" className={`${control} pl-9`} /></span></label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" disabled={busy} onClick={() => { setSelected(null); setLoading(Boolean(target)); setOptionsLoading(!organization); setRetry((value) => value + 1); }} className="font-bold underline">Retry</button></p>}
      {target && (loading || pendingSearch) && <p role="status" className="text-sm text-[#64748B]">Searching users...</p>}
      {target && !loading && !pendingSearch && !error && <fieldset><legend className="text-sm font-semibold text-[#0F172A]">Choose a user</legend>{users.length === 0 ? <p className="mt-2 text-sm text-[#64748B]">No eligible users found in this college.</p> : <div className="mt-2 max-h-60 space-y-2 overflow-y-auto">{users.map((user) => <label key={user.school_id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[#DDE7EF] p-3 text-sm hover:bg-[#F8FBFD]"><input type="radio" name={`${formId}-user`} checked={selected?.school_id === user.school_id} disabled={busy} onChange={() => setSelected(user)} className="mt-1" /><span className="min-w-0 break-words"><strong>{formatDisplayText(`${user.first_name} ${user.last_name}`)}</strong><span className="block text-xs text-[#64748B]">School ID {user.school_id} · {user.email}</span></span></label>)}</div>}</fieldset>}
      {target && meta.lastPage > 1 && <nav aria-label="Existing user pages" className="flex items-center justify-between gap-2 text-xs text-[#64748B]"><button type="button" disabled={busy || loading || page <= 1} onClick={() => { setLoading(true); setSelected(null); setPage(page - 1); }} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-50">Previous</button><span>Page {page} of {meta.lastPage} · {meta.total} users</span><button type="button" disabled={busy || loading || page >= meta.lastPage} onClick={() => { setLoading(true); setSelected(null); setPage(page + 1); }} className="min-h-11 rounded-lg border border-[#DDE7EF] px-3 disabled:opacity-50">Next</button></nav>}
      <label className="block text-sm font-semibold text-[#0F172A]">Role in destination organization<select value={role} disabled={busy} onChange={(event) => setRole(event.target.value)} className={control}><option value="STUDENT">Student</option><option value="SBO_OFFICER">SBO Officer</option><option value="DEPARTMENT_HEAD">Department Head</option>{actorRole === 'SUPER_ADMIN' && <option value="ADMIN">Admin</option>}</select></label>
      {selected && <p className="text-xs text-[#64748B]">Selected: {formatDisplayText(`${selected.first_name} ${selected.last_name}`)} · School ID {selected.school_id}</p>}
    </form>
  </Modal>;
}
