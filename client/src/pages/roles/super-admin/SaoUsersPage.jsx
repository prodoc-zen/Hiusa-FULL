import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, SkeletonText, StatusBadge } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import OneTimeLinkModal from '../../../components/users/OneTimeLinkModal';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import { getSystemUser, getSystemUsers, deleteSystemUser, resetSystemUserPassword } from '../../../services/systemAdministrationService';
import { listMeta, unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { visibleSchoolId } from '../../../utils/schoolId';

const ROLES = [
  ['SUPER_ADMIN', 'SAO'], ['ADMIN', 'Organization admin'], ['SBO_OFFICER', 'Officer'],
  ['DEPARTMENT_HEAD', 'Department Head'], ['STUDENT', 'Student'],
];
const ROLE_NAMES = Object.fromEntries(ROLES);

function fullName(user) {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
}

// The server sends each linked record as { label, count } with the label in plain words; only the ones that exist are worth reading.
function presentLinkedRecords(linkedRecords) {
  return Object.entries(linkedRecords || {}).map(([key, record]) => ({ key, label: record?.label, count: Number(record?.count) || 0 })).filter((record) => record.count > 0);
}

function deleteRefusal(error) {
  const linked = presentLinkedRecords(error?.response?.data?.linked_records);
  const message = getApiErrorMessage(error, 'Could not delete this user.');
  if (!linked.length) return message;
  return `This account cannot be deleted because it has linked records (${linked.map(({ label, count }) => `${label}: ${count}`).join(', ')}). Deactivate the account instead.`;
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
  const [resetting, setResetting] = useState(null);
  const [resetLink, setResetLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [existingAdmin, setExistingAdmin] = useState(null);
  const loadCounter = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setFilters((current) => current.search === query.trim() ? current : { ...current, search: query.trim() }); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    loadCounter.current += 1;
    const ticket = loadCounter.current;
    setState((current) => ({ ...current, loading: true, error: '' }));
    getSystemUsers({ page, per_page: 20, search: filters.search || undefined, role: filters.role || undefined, status: filters.status || undefined })
      .then((data) => { if (ticket === loadCounter.current) setState({ loading: false, error: '', rows: unwrapList(data), meta: listMeta(data) }); })
      .catch((error) => { if (ticket === loadCounter.current) setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load users.') })); });
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
      setNotice(`${fullName(deleting)} was deleted.`);
      setDeleting(null);
      setSelected(null);
      setDetail(null);
      if (page > 1 && state.rows.length === 1) setPage(page - 1);
      else load();
    } catch (error) {
      setActionError(deleteRefusal(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!resetting) return;
    setBusy(true);
    setActionError('');
    try {
      const response = await resetSystemUserPassword(resetting.school_id);
      if (response.reset_link) setResetLink({ link: response.reset_link, name: fullName(resetting) });
      else setNotice(response.message || 'Password reset instructions were sent.');
      setResetting(null);
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Could not reset this password.'));
    } finally {
      setBusy(false);
    }
  }

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  const detailRecords = presentLinkedRecords(detail?.linked_records);
  const filtersActive = Boolean(filters.search || filters.role || filters.status);
  function clearFilters() {
    setQuery('');
    setFilters({ search: '', role: '', status: '' });
    setPage(1);
  }

  const columns = [
    {
      key: 'user',
      header: 'User',
      render: (user) => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center justify-end gap-2 md:justify-start">
            <span className="font-medium text-ink">{fullName(user)}</span>
            {user.account_status && user.account_status !== 'active' && <StatusBadge status={user.account_status} />}
          </span>
          <span className="block text-xs text-ink-muted [overflow-wrap:anywhere]">{user.email}</span>
          {visibleSchoolId(user.school_id) && <span className="block text-xs tabular-nums text-ink-muted">ID {user.school_id}</span>}
        </span>
      ),
    },
    { key: 'organization', header: 'Organization', className: 'md:min-w-56', render: (user) => user.organization?.name || '' },
    { key: 'role', header: 'Role', render: (user) => [...new Set([user.role, ...(user.profile_roles || [])])].map((role) => ROLE_NAMES[role] || role).join(', ') },
  ];

  return <div className="space-y-5 pb-8">
    <PageHeader title="University users" primary={<Button leftIcon={UserPlus} onClick={() => setExistingAdmin({})}>Add administrator</Button>} />
    {notice && <p role="status" className="text-sm font-medium text-success-strong">{notice}</p>}
    <DataTable
      caption="University user accounts"
      columns={columns}
      rows={state.rows}
      rowKey={(user) => user.school_id}
      loading={state.loading}
      error={state.error}
      onRetry={load}
      filtersActive={filtersActive}
      onClearFilters={clearFilters}
      stickyHeader={false}
      emptyState={filtersActive ? undefined : <EmptyState title="No users yet" description="Accounts appear here once people sign up or are added." />}
      filters={<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Search users" className="sm:flex-1"><Input type="search" placeholder="Name, email, or school ID" value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        <Field label="Role" className="sm:w-48"><Select filter value={filters.role} onChange={(event) => changeFilter('role', event.target.value)}><option value="">All roles</option>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        <Field label="Status" className="sm:w-44"><Select filter value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="disabled">Disabled</option></Select></Field>
        {filtersActive && <button type="button" onClick={clearFilters} className="inline-flex min-h-11 items-center rounded-control text-sm font-medium text-brand-700 hover:underline sm:self-end">Clear</button>}
      </div>}
      actions={(user) => <TableRowActions subject={fullName(user)} actions={[
        { label: 'View user and clearance', icon: Eye, onClick: () => openDetails(user) },
        user.role !== 'SUPER_ADMIN' && user.account_status === 'active' && { label: 'Add admin profile', icon: UserPlus, onClick: () => setExistingAdmin({ user }) },
        ['STUDENT', 'SBO_OFFICER'].includes(user.role) && user.account_status === 'active' && { label: 'Reset password', icon: KeyRound, onClick: () => { setActionError(''); setResetting(user); } },
        { label: 'Delete user', icon: Trash2, danger: true, onClick: () => { setActionError(''); setDeleting(user); } },
      ]} />}
      pagination={<PaginationControls currentPage={state.meta.currentPage} totalItems={state.meta.total} pageSize={state.meta.perPage} onPageChange={setPage} label="users" />}
    />
    <Drawer open={Boolean(selected)} title={fullName(selected)} description={selected && visibleSchoolId(selected.school_id) ? `School ID ${selected.school_id}` : undefined} onClose={() => setSelected(null)} width="max-w-2xl">
      {detailError ? <p role="alert" className="text-sm text-danger-strong">{detailError}</p> : !detail ? <SkeletonText lines={4} /> : <div className="space-y-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs font-semibold text-ink-muted">Email</dt><dd className="break-all font-medium text-ink">{detail.user.email}</dd></div><div><dt className="text-xs font-semibold text-ink-muted">Status</dt><dd><StatusBadge status={detail.user.account_status} /></dd></div></dl>
        <section><h3 className="text-sm font-semibold text-ink">Profiles</h3><ul className="mt-2 divide-y divide-line rounded-lg border border-line">{detail.user.profiles.map((profile) => <li key={profile.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"><span className="font-medium text-ink">{profile.organization?.name || 'Organization unavailable'}</span><span className="text-ink-muted">{ROLE_NAMES[profile.role] || profile.role}</span></li>)}</ul></section>
        <section><h3 className="text-sm font-semibold text-ink">Clearance history</h3>{detail.clearances.length === 0 ? <p className="mt-2 text-sm text-ink-muted">No clearance periods for this user.</p> : <ul className="mt-2 divide-y divide-line rounded-lg border border-line">{detail.clearances.map((period) => <li key={period.period_id} className="px-3 py-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-ink">{period.title}</span><StatusBadge status={period.is_complete ? 'cleared' : 'pending'} /></div><p className="text-xs text-ink-muted">{period.academic_year}</p><div className="mt-2 flex flex-wrap gap-2">{period.signatures.map((signature) => <span key={signature.required_role} className="text-xs text-ink-muted">{signature.required_role.replaceAll('_', ' ')}: {signature.status}</span>)}</div></li>)}</ul>}</section>
        <section><h3 className="text-sm font-semibold text-ink">Linked records</h3>{detailRecords.length === 0 ? <p className="mt-2 text-sm text-ink-muted">No linked records. This account can be deleted.</p> : <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{detailRecords.map(({ key, label, count }) => <div key={key} className="rounded-lg border border-line p-2"><dt className="text-xs text-ink-muted">{label}</dt><dd className="text-sm font-semibold tabular-nums text-ink">{count}</dd></div>)}</dl>}</section>
      </div>}
    </Drawer>
    {existingAdmin && <AddExistingUserModal actorRole="SUPER_ADMIN" initialRole="ADMIN" initialUser={existingAdmin.user} onClose={() => setExistingAdmin(null)} onAdded={() => { setNotice('Administrator added.'); load(); }} />}
    <ConfirmModal open={Boolean(resetting)} title="Create reset link" recordName={fullName(resetting)} message="This creates a one-time reset link. It is shown to you once to hand over, and it is emailed only when email is turned on. Their current password is not shown." confirmText="Create reset link" variant="primary" busy={busy} error={actionError} onCancel={() => setResetting(null)} onConfirm={resetPassword} />
    {resetLink && <OneTimeLinkModal title="Reset link ready" description={`Send this to ${resetLink.name}. It lets them choose a new password.`} label="Reset link" hint="Works once and expires in 60 minutes. It is not shown again." link={resetLink.link} onClose={() => { setNotice(`Reset link created for ${resetLink.name}.`); setResetLink(null); }} />}
    <ConfirmModal open={Boolean(deleting)} title="Delete user?" recordName={fullName(deleting)} message="Only the account and its profiles are removed. An account with any history, such as submissions, finance, event, order, or clearance records, cannot be deleted and should be deactivated instead. This cannot be undone." confirmationText={fullName(deleting)} confirmText="Delete user" busy={busy} error={actionError} onCancel={() => setDeleting(null)} onConfirm={remove} />
  </div>;
}
