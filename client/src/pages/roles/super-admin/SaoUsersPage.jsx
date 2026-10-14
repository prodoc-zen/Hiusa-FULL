import { useCallback, useEffect, useState } from 'react';
import { Eye, Trash2, UsersRound } from 'lucide-react';
import { Button, Card, Drawer, EmptyState, Input, PageHeader, Select, StatusBadge } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import { getSystemUser, getSystemUsers, deleteSystemUser } from '../../../services/systemAdministrationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';

const ROLES = [
  ['SUPER_ADMIN', 'SAO'], ['ADMIN', 'Organization Admin'], ['SBO_OFFICER', 'Officer'],
  ['DEPARTMENT_HEAD', 'Department Head'], ['STUDENT', 'Student'],
];
const ROLE_NAMES = Object.fromEntries(ROLES);

function fullName(user) {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
}

export default function SaoUsersPage() {
  const [filters, setFilters] = useState({ search: '', role: '', status: '' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: { total: 0, currentPage: 1, perPage: 20 } });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => { setFilters((current) => ({ ...current, search: query.trim() })); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    getSystemUsers({ page, per_page: 20, search: filters.search || undefined, role: filters.role || undefined, status: filters.status || undefined })
      .then((data) => setState({ loading: false, error: '', rows: unwrapList(data), meta: listMeta(data) }))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load users.') })));
  }, [filters, page]);
  useEffect(() => { load(); }, [load]);

  function openDetails(user) {
    setSelected(user);
    setDetail(null);
    setDetailError('');
    getSystemUser(user.school_id).then(setDetail).catch((error) => setDetailError(getApiErrorMessage(error, 'Could not load user details.')));
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteSystemUser(deleting.school_id);
      setNotice(`${fullName(deleting)} and linked records were deleted.`);
      setDeleting(null);
      setSelected(null);
      setDetail(null);
      if (page > 1 && state.rows.length === 1) setPage(page - 1);
      else load();
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not delete this user.'));
    } finally {
      setBusy(false);
    }
  }

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  return <div className="space-y-5 pb-8">
    <PageHeader title="University users" description="Search accounts across every organization and college." />
    <Card bodyClassName="p-0">
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
        <label className="text-xs font-semibold text-ink">Search users<Input className="mt-1 w-full" type="search" placeholder="Name, email, or school ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="text-xs font-semibold text-ink">Role<Select className="mt-1 w-full" value={filters.role} onChange={(event) => changeFilter('role', event.target.value)}><option value="">All roles</option>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label className="text-xs font-semibold text-ink">Status<Select className="mt-1 w-full" value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="disabled">Disabled</option></Select></label>
      </div>
      {notice && <p role="status" className="m-4 text-sm font-semibold text-green-800">{notice}</p>}
      {state.loading ? <p role="status" className="p-6 text-sm text-ink-muted">Loading users…</p> : state.error ? <div className="p-6"><p role="alert" className="text-sm text-danger-strong">{state.error}</p><Button variant="secondary" onClick={load}>Try again</Button></div> : state.rows.length === 0 ? <div className="p-6"><EmptyState icon={UsersRound} title="No users found" description="Try another name, role, or status." /></div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-[13px]">
          <caption className="sr-only">University user accounts</caption>
          <thead className="bg-subtle text-xs font-bold uppercase text-ink-muted"><tr><th scope="col" className="px-4 py-3">User</th><th scope="col" className="px-4 py-3">School ID</th><th scope="col" className="px-4 py-3">Organization</th><th scope="col" className="px-4 py-3">Role</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3 text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-line">{state.rows.map((user) => <tr key={user.school_id}>
            <td className="px-4 py-3"><span className="block font-semibold text-ink">{fullName(user)}</span><span className="break-all text-xs text-ink-muted">{user.email}</span></td>
            <td className="px-4 py-3 tabular-nums text-ink-muted-strong">{user.school_id}</td>
            <td className="px-4 py-3 text-ink-muted-strong">{user.organization?.name || '—'}</td>
            <td className="px-4 py-3 text-ink-muted-strong">{ROLE_NAMES[user.role] || user.role}</td>
            <td className="px-4 py-3"><StatusBadge status={user.account_status} /></td>
            <td className="px-4 py-2"><TableRowActions subject={fullName(user)} actions={[
              { label: 'View user and clearance', icon: Eye, onClick: () => openDetails(user) },
              { label: 'Delete user', icon: Trash2, danger: true, onClick: () => { setActionError(''); setDeleting(user); } },
            ]} /></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {!state.loading && !state.error && <div className="p-4"><PaginationControls currentPage={state.meta.currentPage} totalItems={state.meta.total} pageSize={state.meta.perPage} onPageChange={setPage} label="users" /></div>}
    </Card>
    <Drawer open={Boolean(selected)} title={fullName(selected)} description={selected ? `School ID ${selected.school_id}` : undefined} onClose={() => setSelected(null)} width="max-w-2xl">
      {detailError ? <p role="alert" className="text-sm text-danger-strong">{detailError}</p> : !detail ? <p role="status" className="text-sm text-ink-muted">Loading account…</p> : <div className="space-y-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs font-semibold text-ink-muted">Email</dt><dd className="break-all font-medium text-ink">{detail.user.email}</dd></div><div><dt className="text-xs font-semibold text-ink-muted">Status</dt><dd><StatusBadge status={detail.user.account_status} /></dd></div></dl>
        <section><h3 className="text-sm font-bold text-ink">Profiles</h3><ul className="mt-2 divide-y divide-line rounded-lg border border-line">{detail.user.profiles.map((profile) => <li key={profile.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span className="font-medium text-ink">{profile.organization?.name || 'Organization unavailable'}</span><span className="text-ink-muted">{ROLE_NAMES[profile.role] || profile.role}</span></li>)}</ul></section>
        <section><h3 className="text-sm font-bold text-ink">Clearance history</h3>{detail.clearances.length === 0 ? <p className="mt-2 text-sm text-ink-muted">No clearance periods for this user.</p> : <ul className="mt-2 divide-y divide-line rounded-lg border border-line">{detail.clearances.map((period) => <li key={period.period_id} className="px-3 py-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-ink">{period.title}</span><StatusBadge status={period.is_complete ? 'cleared' : 'pending'} /></div><p className="text-xs text-ink-muted">{period.academic_year}</p><div className="mt-2 flex flex-wrap gap-2">{period.signatures.map((signature) => <span key={signature.required_role} className="text-xs text-ink-muted">{signature.required_role.replaceAll('_', ' ')}: {signature.status}</span>)}</div></li>)}</ul>}</section>
        <section><h3 className="text-sm font-bold text-ink">Linked records</h3><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(detail.linked_records || {}).map(([key, count]) => <div key={key} className="rounded-lg border border-line p-2"><dt className="text-xs text-ink-muted">{key.replaceAll('_', ' ')}</dt><dd className="text-sm font-bold tabular-nums text-ink">{count}</dd></div>)}</dl></section>
      </div>}
    </Drawer>
    <ConfirmModal open={Boolean(deleting)} title="Delete user and linked records?" recordName={fullName(deleting)} message="This permanently removes the account, profiles, clearances, and linked submissions, financial, event, and order records. It cannot be undone." confirmationText={String(deleting?.school_id || '')} confirmText="Delete user" busy={busy} error={actionError} onCancel={() => setDeleting(null)} onConfirm={remove} />
  </div>;
}
