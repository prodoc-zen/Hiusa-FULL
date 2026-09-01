import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleX, Download, Eye, PencilLine, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { createUser, deleteUser, disableUser, getAcademicStructure, getSboPositions, getUsers, reactivateUser, updateUser } from '../../../services/userService';
import { getStudentDebts } from '../../../services/financeService';

const roles = ['STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'];
const ROLE_LABELS = {
  STUDENT: 'Student',
  SBO_OFFICER: 'SBO Officer',
  ADMIN: 'Admin',
  DEPARTMENT_HEAD: 'Department Head',
};
const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

const emptyCreateForm = {
  school_id: '',
  first_name: '',
  last_name: '',
  email: '',
  contact_number: '',
  role: 'STUDENT',
  position_title: '',
  department: '',
  program: '',
  year_level: '',
  major: '', section: '',
  password: '',
  password_confirmation: '',
};

const emptyEditForm = {
  school_id: '',
  first_name: '',
  last_name: '',
  email: '',
  contact_number: '',
  role: 'STUDENT',
  position_title: '',
  department: '',
  program: '',
  year_level: '',
  major: '', section: '',
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [programFilter, setProgramFilter] = useState('all');
  const [yearLevelFilter, setYearLevelFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [profileDebt, setProfileDebt] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const profileRequestRef = useRef(0);
  const [disableTarget, setDisableTarget] = useState(null);
  const [reactivateTarget, setReactivateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [page, setPage] = useState(1);
  const [sboPositions, setSboPositions] = useState([]);
  const [academicStructure, setAcademicStructure] = useState({ department: '', programs: [] });
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
      } finally {
        if (!cancelled) setLoading(false);
      }

      const [positionsResult, structureResult] = await Promise.allSettled([getSboPositions(), getAcademicStructure()]);
      if (!cancelled && positionsResult.status === 'fulfilled') {
        setSboPositions(Array.isArray(positionsResult.value) ? positionsResult.value : []);
      }
      if (!cancelled && structureResult.status === 'fulfilled') {
        setAcademicStructure(structureResult.value || { department: '', programs: [] });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const matching = users.filter((user) => {
      const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
      const query = search.toLowerCase();
      const matchesSearch =
        fullName.includes(query) ||
        String(user.school_id ?? '').toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        (user.department || '').toLowerCase().includes(query) ||
        (user.program || '').toLowerCase().includes(query) ||
        (user.year_level || '').toLowerCase().includes(query);
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const matchesDepartment = departmentFilter === 'all' || user.department === departmentFilter;
      const matchesProgram = programFilter === 'all' || user.program === programFilter;
      const matchesYearLevel = yearLevelFilter === 'all' || user.year_level === yearLevelFilter;
      const matchesSection = sectionFilter === 'all' || user.section === sectionFilter;
      const matchesStatus = statusFilter === 'all' || user.account_status === statusFilter;
      return matchesSearch && matchesRole && matchesDepartment && matchesProgram && matchesYearLevel && matchesSection && matchesStatus;
    });
    return [...matching].sort((left, right) => {
      if (sort === 'newest') return new Date(right.created_at || 0) - new Date(left.created_at || 0);
      if (sort === 'school_id') return String(left.school_id).localeCompare(String(right.school_id), undefined, { numeric: true });
      if (sort === 'program') return String(left.program || '').localeCompare(String(right.program || '')) || String(left.year_level || '').localeCompare(String(right.year_level || '')) || String(left.section || '').localeCompare(String(right.section || ''));
      return `${left.last_name} ${left.first_name}`.localeCompare(`${right.last_name} ${right.first_name}`);
    });
  }, [users, search, roleFilter, departmentFilter, programFilter, yearLevelFilter, sectionFilter, statusFilter, sort]);

  const pagedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, departmentFilter, programFilter, yearLevelFilter, sectionFilter, statusFilter, sort]);

  const exportUsers = () => {
    const headers = ['School ID', 'Last Name', 'First Name', 'Email', 'Role', 'Position', 'Department', 'Program', 'Major', 'Year Level', 'Section', 'Account Status', 'Created At', 'Updated At'];
    const rows = filtered.map((user) => [user.school_id, user.last_name, user.first_name, user.email, user.role, user.position_title, user.department, user.program, user.major, user.year_level, user.section, user.account_status, user.created_at, user.updated_at]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `user-register-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  const refreshUsers = async () => {
    const rows = await getUsers();
    setUsers(Array.isArray(rows) ? rows : []);
    const [positionsResult, structureResult] = await Promise.allSettled([getSboPositions(), getAcademicStructure()]);
    if (positionsResult.status === 'fulfilled') {
      setSboPositions(Array.isArray(positionsResult.value) ? positionsResult.value : []);
    }
    if (structureResult.status === 'fulfilled') {
      setAcademicStructure(structureResult.value || { department: '', programs: [] });
    }
  };


  const openCreate = () => {
    setCreateForm({ ...emptyCreateForm, department: academicStructure.department || 'College of Computer Studies' });
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
      contact_number: user.contact_number || '',
      role: user.role,
      position_title: user.position_title || '',
      department: user.department || '',
      program: user.program || '',
      year_level: user.year_level || '',
      major: user.major || '', section: user.section || '',
    });
    setModalError('');
  };

  const closeEdit = () => {
    if (busy) return;
    setSelectedUser(null);
    setModalError('');
  };

  const openProfile = async (user) => {
    const requestId = ++profileRequestRef.current;
    setProfileUser(user);
    setProfileDebt(null);
    setProfileError('');
    if (user.role !== 'STUDENT') { setProfileLoading(false); return; }
    setProfileLoading(true);
    try {
      const response = await getStudentDebts({ student_id: user.school_id });
      const debts = response.data ?? response;
      if (profileRequestRef.current === requestId) setProfileDebt(Array.isArray(debts) ? debts[0] ?? null : null);
    } catch {
      if (profileRequestRef.current === requestId) setProfileError('The student profile opened, but the live debt summary could not be loaded.');
    } finally { if (profileRequestRef.current === requestId) setProfileLoading(false); }
  };

  const closeProfile = () => {
    profileRequestRef.current += 1;
    setProfileUser(null);
    setProfileDebt(null);
    setProfileError('');
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setModalError('');
    setBusy(true);

    try {
      await createUser({
        ...createForm,
        position_title: ['ADMIN', 'SBO_OFFICER'].includes(createForm.role) ? createForm.position_title : '',
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
        position_title: ['ADMIN', 'SBO_OFFICER'].includes(editForm.role) ? editForm.position_title : '',
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setError(''); setBusy(true);
    try {
      await deleteUser(deleteTarget.id);
      await refreshUsers();
      setFeedback({ open: true, type: 'success', message: `${deleteTarget.first_name} ${deleteTarget.last_name} was permanently deleted.` });
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(firstError(deleteError) || 'Unable to delete this user because linked records may still exist.');
      setDeleteTarget(null);
    } finally { setBusy(false); }
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
      {form.role === 'STUDENT' && <Field label="Contact Number">
        <input type="tel" value={form.contact_number} onChange={(event) => setForm({ ...form, contact_number: event.target.value })} placeholder="e.g. +63 912 345 6789" maxLength={30} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </Field>}
      <Field label="First Name">
        <input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </Field>
      <Field label="Last Name">
        <input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} required className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </Field>
      <Field label="Role">
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, position_title: '' })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15">
          {roles.map((role) => (
            <option key={role} value={role}>{ROLE_LABELS[role]}</option>
          ))}
        </select>
      </Field>
      <Field label="Organization Position">
        <select
          value={form.position_title}
          onChange={(event) => setForm({ ...form, position_title: event.target.value })}
          disabled={!['ADMIN', 'SBO_OFFICER'].includes(form.role)}
          className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <option value="">{['ADMIN', 'SBO_OFFICER'].includes(form.role) ? 'Choose a position' : 'Not available for this role'}</option>
          {sboPositions.filter((position) => position.is_active && position.role === form.role).map((position) => (
            <option key={position.id} value={position.title}>{position.title}</option>
          ))}
        </select>
      </Field>
      <Field label="Department"><input value={academicStructure.department || 'College of Computer Studies'} readOnly className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-slate-100 px-3 text-sm text-slate-500" /></Field>
      <Field label="Course / Program">
        <select value={form.program} onChange={(event) => setForm({ ...form, program: event.target.value, section: '' })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"><option value="">Choose a program</option>{academicStructure.programs?.map((program) => <option key={program.id} value={program.name}>{program.name}</option>)}</select>
      </Field>
      <Field label="Year Level">
        <select value={form.year_level} onChange={(event) => setForm({ ...form, year_level: event.target.value, section: '' })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"><option value="">Choose a year level</option>{YEAR_LEVELS.map((year) => <option key={year}>{year}</option>)}</select>
      </Field>
      <Field label="Major / Specialization"><input value={form.major} onChange={(event) => setForm({ ...form, major: event.target.value })} placeholder="Optional specialization" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm" /></Field>
      <Field label="Section"><select value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value })} disabled={!form.program || !form.year_level} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none disabled:bg-slate-100"> <option value="">Choose a section</option>{academicStructure.programs?.find((program) => program.name === form.program)?.sections?.filter((section) => Number(section.year_level) === YEAR_LEVELS.indexOf(form.year_level) + 1).map((section) => <option key={section.id} value={section.name}>{section.name}</option>)}</select></Field>
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
          <div className="flex gap-2"><button onClick={exportUsers} disabled={!filtered.length} className="inline-flex items-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50"><Download size={15} /> Export</button><button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0878B7]"><UserPlus size={15} /> New User</button></div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, school ID, department, program, or email"
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
          <select aria-label="Filter by department" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="all">All departments</option>{academicStructure.department && <option value={academicStructure.department}>{academicStructure.department}</option>}</select>
          <select aria-label="Filter by program" value={programFilter} onChange={(event) => { setProgramFilter(event.target.value); setSectionFilter('all'); }} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="all">All programs</option>{academicStructure.programs?.map((program) => <option key={program.id} value={program.name}>{program.name}</option>)}</select>
          <select aria-label="Filter by year level" value={yearLevelFilter} onChange={(event) => { setYearLevelFilter(event.target.value); setSectionFilter('all'); }} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="all">All year levels</option>{YEAR_LEVELS.map((year) => <option key={year}>{year}</option>)}</select>
          <select aria-label="Filter by section" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="all">All sections</option>{academicStructure.programs?.filter((program) => programFilter === 'all' || program.name === programFilter).flatMap((program) => program.sections || []).filter((section) => yearLevelFilter === 'all' || Number(section.year_level) === YEAR_LEVELS.indexOf(yearLevelFilter) + 1).map((section) => <option key={section.id} value={section.name}>{section.name}</option>)}</select>
          <select aria-label="Filter by account status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="all">All account statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="disabled">Disabled</option></select>
          <select aria-label="Sort users" value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="name">Name A–Z</option><option value="school_id">School ID</option><option value="program">Program / Year / Section</option><option value="newest">Newest accounts</option></select>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          ['Total users', users.length], ['Matching users', filtered.length], ['Active accounts', filtered.filter((user) => user.account_status === 'active').length], ['Students', filtered.filter((user) => user.role === 'STUDENT').length],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-[#0F172A]">{value}</p></div>)}</div>
        <div className="mt-3 flex justify-end"><button type="button" onClick={() => { setSearch(''); setRoleFilter('all'); setDepartmentFilter('all'); setProgramFilter('all'); setYearLevelFilter('all'); setSectionFilter('all'); setStatusFilter('all'); setSort('name'); }} className="rounded-lg border border-[#DDE7EF] px-3 py-2 text-xs font-bold text-slate-600">Reset filters</button></div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      )}

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-left">
            <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">School ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Program / Major</th>
                <th className="px-4 py-3">Year Level</th>
                <th className="px-4 py-3">Section</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5EDF3] text-sm">
              {loading && Array.from({ length: 6 }, (_, index) => (
                <tr key={`user-skeleton-${index}`} aria-hidden="true">
                  {Array.from({ length: 8 }, (__, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-4">
                      <div className="h-4 animate-pulse rounded bg-slate-100" />
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && pagedUsers.map((user) => (
                <tr key={user.id} className="hover:bg-[#F8FBFD]">
                  <td className="px-4 py-3.5 font-mono text-xs text-[#64748B]">{user.school_id}</td>
                  <td className="px-4 py-3.5 font-semibold text-[#0F172A]">{user.first_name} {user.last_name}</td>
                  <td className="px-4 py-3.5">
                    <span className="rounded-full bg-[#EEF6FB] px-2.5 py-1 text-[11px] font-bold text-[#0B8ED0]">{ROLE_LABELS[user.role] || user.role}</span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-[#64748B]"><p className="font-semibold text-slate-700">{user.program || '-'}</p>{user.major && <p className="mt-0.5">{user.major}</p>}</td>
                  <td className="px-4 py-3.5 text-xs font-semibold text-slate-600">{user.year_level || '-'}</td>
                  <td className="px-4 py-3.5 text-xs font-semibold text-slate-600">{user.section || '-'}</td>
                  <td className="px-4 py-3.5">
                    {user.account_status === 'active' ? <CircleCheck aria-label="Active" size={20} className="text-emerald-600" /> : <CircleX aria-label="Inactive" size={20} className="text-red-600" />}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-1.5">
                      <button aria-label={`Edit ${user.first_name} ${user.last_name}`} title="Edit user" onClick={() => openEdit(user)} className="grid h-9 w-9 place-items-center rounded-md border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]"><PencilLine size={14} /></button>
                      <button aria-label={`View ${user.first_name} ${user.last_name}`} title="View user" onClick={() => openProfile(user)} className="grid h-9 w-9 place-items-center rounded-md border border-[#B9D9E9] bg-[#EEF6FB] text-[#0878B7] hover:bg-[#DDF2FB]"><Eye size={14} /></button>
                      {user.role !== 'ADMIN' && user.account_status !== 'disabled' && (
                        <button aria-label={`Deactivate ${user.first_name} ${user.last_name}`} title="Deactivate user" onClick={() => setDisableTarget(user)} className="grid h-9 w-9 place-items-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"><UserX size={14} /></button>
                      )}
                      {user.account_status !== 'active' && (
                        <button aria-label={`Reactivate ${user.first_name} ${user.last_name}`} title="Reactivate user" onClick={() => setReactivateTarget(user)} className="grid h-9 w-9 place-items-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><UserCheck size={14} /></button>
                      )}
                      {user.role !== 'ADMIN' && <button aria-label={`Delete ${user.first_name} ${user.last_name}`} title="Delete user" onClick={() => setDeleteTarget(user)} className="grid h-9 w-9 place-items-center rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-[#94A3B8]">No users found.</td>
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
        open={Boolean(profileUser)}
        title="User Profile"
        description={profileUser ? `${profileUser.first_name} ${profileUser.last_name} - School ID ${profileUser.school_id}` : ''}
        onClose={closeProfile}
        maxWidth="max-w-3xl"
        footer={<button type="button" onClick={closeProfile} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Close</button>}
      >
        {profileUser && <div className="space-y-5">
          <div className="grid gap-3 rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Email', profileUser.email], ['Contact number', profileUser.contact_number || 'Not recorded'], ['Role', ROLE_LABELS[profileUser.role] || profileUser.role], ['Account status', profileUser.account_status || 'active'],
              ['Department', profileUser.department || 'Not recorded'], ['Course / Program', profileUser.program || 'Not recorded'], ['Year level', profileUser.year_level || 'Not recorded'],
              ['Major / Specialization', profileUser.major || 'Not recorded'], ['Section', profileUser.section || 'Not recorded'], ['Organization position', profileUser.position_title || 'Not assigned'],
            ].map(([label, value]) => <div key={label}><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-[#0F172A]">{value}</p></div>)}
          </div>
          {profileUser.role === 'STUDENT' && <section>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Financial standing</p><h3 className="mt-1 text-lg font-black text-[#0F172A]">Live Student Debt Summary</h3></div>{profileDebt && <span className={`rounded-full px-3 py-1 text-xs font-bold ${profileDebt.clearance_status === 'financially_cleared' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{profileDebt.clearance_status === 'financially_cleared' ? 'Financially cleared' : 'Pending clearance'}</span>}</div>
            {profileLoading && <div className="mt-3 h-24 animate-pulse rounded-xl bg-slate-100" />}
            {profileError && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{profileError}</p>}
            {!profileLoading && profileDebt && <>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">{[['Invoice balance', profileDebt.invoice_debt], ['Reserved merchandise', profileDebt.reserved_order_debt], ['Total outstanding', profileDebt.total_debt]].map(([label, amount]) => <div key={label} className="rounded-xl border border-[#DDE7EF] bg-white p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-[#0F172A]">PHP {Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></div>)}</div>
              {profileDebt.total_debt > 0 && <div className="mt-4 space-y-3">
                {profileDebt.invoices?.length > 0 && <div><p className="text-sm font-bold text-[#0F172A]">Unsettled invoices</p>{profileDebt.invoices.map((invoice) => <div key={invoice.id} className="mt-2 flex justify-between gap-3 rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm"><span><strong>{invoice.reference}</strong><br /><span className="text-xs text-slate-500">{invoice.description}</span></span><strong>PHP {Number(invoice.remaining_balance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>)}</div>}
                {profileDebt.reserved_orders?.length > 0 && <div><p className="text-sm font-bold text-[#0F172A]">Reserved merchandise awaiting payment</p>{profileDebt.reserved_orders.map((order) => <div key={order.id} className="mt-2 flex justify-between gap-3 rounded-lg border border-[#DDE7EF] px-3 py-2 text-sm"><span><strong>Order ORD-{order.id}</strong><br /><span className="text-xs text-slate-500">{order.merchandise?.name || 'Merchandise item'}</span></span><strong>PHP {Number(order.total_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>)}</div>}
              </div>}
              {profileDebt.total_debt <= 0 && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">No current invoices or reserved-merchandise debt found.</p>}
            </>}
          </section>}
        </div>}
      </Modal>

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

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete User Permanently"
        message="This removes the account permanently. The system will block deletion if the user has linked operational records."
        recordName={deleteTarget ? `${deleteTarget.first_name} ${deleteTarget.last_name}` : ''}
        confirmText="Delete User"
        variant="danger"
        busy={busy}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
