import { useEffect, useMemo, useState } from 'react';
import { PencilLine, UserPlus, UserX, X } from 'lucide-react';
import { createUser, disableUser, getUsers, updateUser } from '../../../services/userService';
import PaginationControls from '../../../components/PaginationControls';

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

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [createForm, setCreateForm] = useState({
    school_id: '',
    first_name: '',
    last_name: '',
    email: '',
    role: 'STUDENT',
    position_title: '',
    password: '',
    password_confirmation: '',
  });

  const [editForm, setEditForm] = useState({
    school_id: '',
    first_name: '',
    last_name: '',
    email: '',
    role: 'STUDENT',
    position_title: '',
  });

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
      const matchesSearch =
        fullName.includes(search.toLowerCase()) ||
        String(user.school_id ?? '').toLowerCase().includes(search.toLowerCase()) ||
        user.email.toLowerCase().includes(search.toLowerCase());
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

  const handleCreate = async (event) => {
    event.preventDefault();
    setError('');

    try {
      await createUser({
        ...createForm,
        position_title: createForm.role === 'SBO_OFFICER' ? createForm.position_title : '',
      });
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to create user.');
      return;
    }

    setShowCreate(false);
    setCreateForm({
      school_id: '',
      first_name: '',
      last_name: '',
      email: '',
      role: 'STUDENT',
      position_title: '',
      password: '',
      password_confirmation: '',
    });
    try { await refreshUsers(); } catch {}
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
    setShowEdit(true);
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!selectedUser) return;

    setError('');
    try {
      await updateUser(selectedUser.id, {
        ...editForm,
        position_title: editForm.role === 'SBO_OFFICER' ? editForm.position_title : '',
      });
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update user.');
      return;
    }
    setShowEdit(false);
    setSelectedUser(null);
    try { await refreshUsers(); } catch {}
  };

  const handleDisable = async (user) => {
    const confirmed = window.confirm(`Deactivate ${user.first_name} ${user.last_name}? This will update the account status and sign the user out of active sessions.`);
    if (!confirmed) return;

    setError('');
    try {
      await disableUser(user.id);
      try { await refreshUsers(); } catch {}
    } catch (disableError) {
      setError(disableError?.response?.data?.message || 'Unable to disable user.');
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Administrator</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">User Management</h2>
            <p className="mt-1 text-sm text-slate-500">View, search, filter, add, update, and deactivate user accounts.</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0878B7]">
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
                        <button onClick={() => handleDisable(user)} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                          <UserX size={13} />
                          Deactivate
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

      {showCreate && (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-[#0F172A]">Create User</h3>
            <button onClick={() => setShowCreate(false)} className="rounded p-1 text-slate-400 hover:bg-red-50">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <input type="number" min="1" max="99999999" value={createForm.school_id} onChange={(event) => setCreateForm({ ...createForm, school_id: event.target.value })} placeholder="School ID" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} placeholder="Email" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input value={createForm.first_name} onChange={(event) => setCreateForm({ ...createForm, first_name: event.target.value })} placeholder="First name" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input value={createForm.last_name} onChange={(event) => setCreateForm({ ...createForm, last_name: event.target.value })} placeholder="Last name" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value, position_title: event.target.value === 'SBO_OFFICER' ? createForm.position_title : '' })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
              {roles.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
            <select
              value={createForm.position_title}
              onChange={(event) => setCreateForm({ ...createForm, position_title: event.target.value })}
              disabled={createForm.role !== 'SBO_OFFICER'}
              className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">Assign SBO position</option>
              {SBO_POSITIONS.map((position) => (
                <option key={position} value={position}>{position}</option>
              ))}
            </select>
            <input type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} placeholder="Password" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input type="password" value={createForm.password_confirmation} onChange={(event) => setCreateForm({ ...createForm, password_confirmation: event.target.value })} placeholder="Confirm password" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <div className="sm:col-span-2 flex gap-2 pt-1">
              <button type="submit" className="rounded-lg bg-[#0B8ED0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0878B7]">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-[#DDE7EF] px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {showEdit && selectedUser && (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-[#0F172A]">Edit User</h3>
            <button onClick={() => setShowEdit(false)} className="rounded p-1 text-slate-400 hover:bg-red-50">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleEdit} className="grid gap-3 sm:grid-cols-2">
            <input type="number" min="1" max="99999999" value={editForm.school_id} onChange={(event) => setEditForm({ ...editForm, school_id: event.target.value })} placeholder="School ID" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} placeholder="Email" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input value={editForm.first_name} onChange={(event) => setEditForm({ ...editForm, first_name: event.target.value })} placeholder="First name" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <input value={editForm.last_name} onChange={(event) => setEditForm({ ...editForm, last_name: event.target.value })} placeholder="Last name" className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm" />
            <select value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value, position_title: event.target.value === 'SBO_OFFICER' ? editForm.position_title : '' })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
              {roles.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
            <select
              value={editForm.position_title}
              onChange={(event) => setEditForm({ ...editForm, position_title: event.target.value })}
              disabled={editForm.role !== 'SBO_OFFICER'}
              className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">Assign SBO position</option>
              {SBO_POSITIONS.map((position) => (
                <option key={position} value={position}>{position}</option>
              ))}
            </select>
            <div className="sm:col-span-2 flex gap-2 pt-1">
              <button type="submit" className="rounded-lg bg-[#0B8ED0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0878B7]">Save</button>
              <button type="button" onClick={() => setShowEdit(false)} className="rounded-lg border border-[#DDE7EF] px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
