import { useEffect, useMemo, useState } from 'react';
import { PencilLine, UserCheck, UserPlus, UserX } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { createUser, disableUser, getUsers, reactivateUser, updateUser } from '../../../services/userService';

const roles = ['STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'];
const ROLE_LABELS = {
  STUDENT: 'Student',
  SBO_OFFICER: 'SBO Officer',
  ADMIN: 'Admin',
  DEPARTMENT_HEAD: 'Department Head',
};

const SBO_POSITIONS = [
  'President',
  'Vice President',
  'Secretary',
  'Treasurer',
  'Auditor',
  'Public Information Officer',
  'Business Manager',
  'Representative',
];

const emptyCreateForm = {
  school_id: '',
  first_name: '',
  last_name: '',
  email: '',
  role: 'STUDENT',
  position_title: '',
  password: '',
  password_confirmation: '',
};

const emptyEditForm = {
  school_id: '',
  first_name: '',
  last_name: '',
  email: '',
  role: 'STUDENT',
  position_title: '',
};

function Field({ label, children, error }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span>}
    </label>
  );
}

function firstError(error) {
  const errors = error?.response?.data?.errors;
  if (errors) {
    return Object.values(errors).flat()[0];
  }

  return error?.response?.data?.message;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const [reactivateTarget, setReactivateTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await getUsers();
        if (!cancelled) {
          setUsers(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load users.');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return users.filter((user) => {
      const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
      const query = search.toLowerCase();
      const matchesSearch =
        fullName.includes(query) ||
        String(user.school_id ?? '').toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query);
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  const pagedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter]);

  const refreshUsers = async () => {
    const rows = await getUsers();
    setUsers(Array.isArray(rows) ? rows : []);
  };

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setModalError('');
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (busy) return;
    setShowCreate(false);
    setModalError('');
  };

  const openEdit = (user) => {
    setSelectedUser(user);
    setEditForm({
      school_id: user.school_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      position_title: user.position_title || '',
    });
    setModalError('');
  };

  const closeEdit = () => {
    if (busy) return;
    setSelectedUser(null);
    setModalError('');
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setModalError('');
    setBusy(true);

    try {
      await createUser({
        ...createForm,
        position_title: createForm.role === 'SBO_OFFICER' ? createForm.position_title : '',
      });
      setShowCreate(false);
      setCreateForm(emptyCreateForm);
      await refreshUsers();
      setFeedback({ open: true, type: 'success', message: 'User account created.' });
    } catch (createError) {
      setModalError(firstError(createError) || 'Unable to create user.');
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!selectedUser) return;

    setModalError('');
    setBusy(true);

    try {
      const editableFields = { ...editForm };
      delete editableFields.school_id;
      await updateUser(selectedUser.id, {
        ...editableFields,
        position_title: editForm.role === 'SBO_OFFICER' ? editForm.position_title : '',
      });
      setSelectedUser(null);
      await refreshUsers();
      setFeedback({ open: true, type: 'success', message: 'User account updated.' });
    } catch (updateError) {
      setModalError(firstError(updateError) || 'Unable to update user.');
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async () => {
    if (!reactivateTarget) return;

    setError('');
    setBusy(true);

    try {
      await reactivateUser(reactivateTarget.id);
      await refreshUsers();
      setFeedback({ open: true, type: 'success', message: `${reactivateTarget.first_name} ${reactivateTarget.last_name} was reactivated.` });
      setReactivateTarget(null);
    } catch (reactivateError) {
      setError(firstError(reactivateError) || 'Unable to reactivate user.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!disableTarget) return;

    setError('');
    setBusy(true);

    try {
      await disableUser(disableTarget.id);
      await refreshUsers();
      setFeedback({ open: true, type: 'success', message: `${disableTarget.first_name} ${disableTarget.last_name} was deactivated.` });
      setDisableTarget(null);
    } catch (disableError) {
      setError(firstError(disableError) || 'Unable to disable user.');
    } finally {
      setBusy(false);
    }
  };

  const userForm = (form, setForm, mode) => (
    <form id={`${mode}-user-form`} onSubmit={mode === 'create' ? handleCreate : handleEdit} className="grid gap-3 sm:grid-cols-2">
      <Field label="School ID">
        <input
          type="number"
          min="1"
          max="99999999"
          value={form.school_id}
          onChange={(event) => mode === 'create' && setForm({ ...form, school_id: event.target.value })}
          required
          readOnly={mode === 'edit'}
          className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 read-only:bg-slate-100 read-only:text-slate-500 read-only:focus:border-[#DDE7EF] read-only:focus:ring-0"
        />
      </Field>
      <Field label="Email">
        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </Field>
      <Field label="First Name">
        <input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </Field>
      <Field label="Last Name">
        <input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </Field>
      <Field label="Role">
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, position_title: event.target.value === 'SBO_OFFICER' ? form.position_title : '' })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
          {roles.map((role) => (
            <option key={role} value={role}>{ROLE_LABELS[role]}</option>
          ))}
        </select>
      </Field>
      <Field label="SBO Position">
        <select
          value={form.position_title}
          onChange={(event) => setForm({ ...form, position_title: event.target.value })}
          disabled={form.role !== 'SBO_OFFICER'}
          className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <option value="">Assign SBO position</option>
          {SBO_POSITIONS.map((position) => (
            <option key={position} value={position}>{position}</option>
          ))}
        </select>
      </Field>
      {mode === 'create' && (
        <>
          <Field label="Password">
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
          </Field>
          <Field label="Confirm Password">
            <input type="password" value={form.password_confirmation} onChange={(event) => setForm({ ...form, password_confirmation: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
          </Field>
        </>
      )}
      {modalError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 sm:col-span-2">
          {modalError}
        </div>
      )}
    </form>
  );

  return (
    <div className="space-y-5">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Administrator</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">User Management</h2>
            <p className="mt-1 text-sm text-slate-500">View, search, filter, add, update, deactivate, and reactivate user accounts.</p>
          </div>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0878B7]">
            <UserPlus size={15} />
            New User
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, school ID, or email"
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          />
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
          >
            <option value="all">All roles</option>
            {roles.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      )}

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">School ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">SBO Position</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5EDF3] text-sm">
              {pagedUsers.map((user) => (
                <tr key={user.id} className="hover:bg-[#F8FBFD]">
                  <td className="px-4 py-3.5 font-mono text-xs text-[#64748B]">{user.school_id}</td>
                  <td className="px-4 py-3.5 font-semibold text-[#0F172A]">{user.first_name} {user.last_name}</td>
                  <td className="px-4 py-3.5 text-xs text-[#64748B]">{user.email}</td>
                  <td className="px-4 py-3.5">
                    <span className="rounded-full bg-[#EEF6FB] px-2.5 py-1 text-[11px] font-bold text-[#0B8ED0]">{ROLE_LABELS[user.role] || user.role}</span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-[#64748B]">{user.role === 'SBO_OFFICER' ? (user.position_title || '-') : '-'}</td>
                  <td className="px-4 py-3.5">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${user.account_status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {user.account_status || 'active'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(user)} className="inline-flex items-center gap-1 rounded-md border border-[#DDE7EF] px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-[#EEF6FB]">
                        <PencilLine size={13} />
                        Edit
                      </button>
                      {user.role !== 'ADMIN' && user.account_status !== 'disabled' && (
                        <button onClick={() => setDisableTarget(user)} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                          <UserX size={13} />
                          Deactivate
                        </button>
                      )}
                      {user.account_status !== 'active' && (
                        <button onClick={() => setReactivateTarget(user)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                          <UserCheck size={13} />
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-[#94A3B8]">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={page}
          totalItems={filtered.length}
          pageSize={pageSize}
          onPageChange={setPage}
          label="users"
        />
      </section>

      <Modal
        open={showCreate}
        title="Create User"
        description="Add a new account. The user will sign in with their School ID."
        onClose={closeCreate}
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        footer={(
          <>
            <button type="button" onClick={closeCreate} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">Cancel</button>
            <button type="submit" form="create-user-form" disabled={busy} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">{busy ? 'Creating...' : 'Create User'}</button>
          </>
        )}
      >
        {userForm(createForm, setCreateForm, 'create')}
      </Modal>

      <Modal
        open={Boolean(selectedUser)}
        title="Edit User"
        description={selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}` : ''}
        onClose={closeEdit}
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        footer={(
          <>
            <button type="button" onClick={closeEdit} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">Cancel</button>
            <button type="submit" form="edit-user-form" disabled={busy} className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">{busy ? 'Saving...' : 'Save Changes'}</button>
          </>
        )}
      >
        {userForm(editForm, setEditForm, 'edit')}
      </Modal>

      <ConfirmModal
        open={Boolean(disableTarget)}
        title="Deactivate User"
        message="This will change the account status and sign the user out of active sessions."
        recordName={disableTarget ? `${disableTarget.first_name} ${disableTarget.last_name}` : ''}
        confirmText="Deactivate"
        variant="danger"
        busy={busy}
        onCancel={() => !busy && setDisableTarget(null)}
        onConfirm={handleDisable}
      />

      <ConfirmModal
        open={Boolean(reactivateTarget)}
        title="Reactivate User"
        message="This will restore account access. If the account was previously deactivated, the user may still need to recover or reset their password."
        recordName={reactivateTarget ? `${reactivateTarget.first_name} ${reactivateTarget.last_name}` : ''}
        confirmText="Reactivate"
        variant="success"
        busy={busy}
        onCancel={() => !busy && setReactivateTarget(null)}
        onConfirm={handleReactivate}
      />
    </div>
  );
}
