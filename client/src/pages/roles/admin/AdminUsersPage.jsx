import { useEffect, useMemo, useState } from 'react';
import { PencilLine, Trash2, UserPlus, UserX, X } from 'lucide-react';
import { createUser, deleteUser, disableUser, getUsers, updateUser } from '../../../services/userService';
import PaginationControls from '../../../components/PaginationControls';

const roles = ['student', 'officer', 'adviser', 'admin'];

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
    role: 'student',
    password: '',
    password_confirmation: '',
  });

  const [editForm, setEditForm] = useState({
    school_id: '',
    first_name: '',
    last_name: '',
    email: '',
    role: 'student',
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await getUsers();
        if (!cancelled) {
          setUsers(Array.isArray(rows) ? rows : []);
        }
      } catch (loadError) {
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
      await createUser(createForm);
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
      role: 'student',
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
    });
    setShowEdit(true);
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!selectedUser) return;

    setError('');
    try {
      await updateUser(selectedUser.id, editForm);
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update user.');
      return;
    }
    setShowEdit(false);
    setSelectedUser(null);
    try { await refreshUsers(); } catch {}
  };

  const handleDisable = async (id) => {
    setError('');
    try {
      await disableUser(id);
      try { await refreshUsers(); } catch {}
    } catch (disableError) {
      setError(disableError?.response?.data?.message || 'Unable to disable user.');
    }
  };

  const handleDelete = async (id) => {
    setError('');
    try {
      await deleteUser(id);
      try { await refreshUsers(); } catch {}
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || 'Unable to delete user.');
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Administrator</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">User Management</h2>
            <p className="mt-1 text-sm text-slate-500">Create, edit, disable, and remove user accounts.</p>
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
              <option key={role} value={role}>{role}</option>
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
                    <span className="rounded-full bg-[#EEF6FB] px-2.5 py-1 text-[11px] font-bold capitalize text-[#0B8ED0]">{user.role}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(user)} className="inline-flex items-center gap-1 rounded-md border border-[#DDE7EF] px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-[#EEF6FB]">
                        <PencilLine size={13} />
                        Edit
                      </button>
                      {user.role !== 'admin' && (
                        <button onClick={() => handleDisable(user.id)} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                          <UserX size={13} />
                          Disable
                        </button>
                      )}
                      {user.role !== 'admin' && (
                        <button onClick={() => handleDelete(user.id)} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
                          <Trash2 size={13} />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-[#94A3B8]">No users found.</td>
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
            <select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
              {roles.map((role) => (
                <option key={role} value={role}>{role}</option>
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
            <select value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
              {roles.map((role) => (
                <option key={role} value={role}>{role}</option>
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
