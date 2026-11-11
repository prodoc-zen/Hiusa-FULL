import { formatDisplayText } from '../../../utils/displayText.js';
import { manilaDateStamp } from '../../../utils/dateTime';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInRouterContext, useSearchParams } from 'react-router-dom';
import { dashboardPopupLeft, dashboardPopupTop } from '../../../utils/dashboardPopupPosition';
import { Download, Eye, Fingerprint, MoreVertical, PencilLine, Search, Trash2, Upload, UserCheck, UserPlus, UserX } from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import PaginationControls from '../../../components/PaginationControls';
import { Button, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, StatusBadge } from '../../../components/ui';
import UserImportDrawer from '../../../components/users/UserImportDrawer';
import OneTimeLinkModal from '../../../components/users/OneTimeLinkModal';
import { deleteUser, disableUser, getAcademicStructure, getSboPositions, getUsers, reactivateUser, resetUserPassword, updateUser, uploadUserPhoto } from '../../../services/userService';
import { getStudentDebts } from '../../../services/financeService';
import AddExistingUserModal from '../../../components/users/AddExistingUserModal';
import ManageAccountProfilesModal from '../../../components/users/ManageAccountProfilesModal';
import OrgAccessPanel from '../../../components/org/OrgAccessPanel';
import { enrollFingerprint, identifyFingerprint, removeFingerprint } from '../../../services/fingerprintService';
import { useFingerprintReader } from '../../../hooks/useFingerprintReader';
import ScannerStatus from '../../../components/fingerprint/ScannerStatus';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import UserIdentityCard from '../../../components/users/UserIdentityCard';

const accountRoles = ['STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'];
const filterRoles = accountRoles;
const ROLE_LABELS = {
  SUPER_ADMIN: 'Super admin',
  STUDENT: 'Student',
  SBO_OFFICER: 'SBO officer',
  ADMIN: 'Administrator or department secretary (full organization access)',
  DEPARTMENT_HEAD: 'Department head',
};
const ROLE_SHORT = { ...ROLE_LABELS, ADMIN: 'Administrator' };
const money = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const yearLabel = (year) => `${year}${year % 100 >= 11 && year % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[year % 10] || 'th')} Year`;
const yearNumber = (label) => Number(String(label).match(/^(\d+)/)?.[1]);
const programYears = (program) => Array.from({ length: Number(program?.duration_years) || 4 }, (_, index) => yearLabel(index + 1));

const emptyEditForm = {
  school_id: '',
  first_name: '',
  last_name: '',
  contact_number: '',
  role: 'STUDENT',
  position_title: '',
  department: '',
  program: '',
  year_level: '',
  major: '', section: '',
};

function firstError(error) {
  const errors = error?.response?.data?.errors;
  if (errors) {
    return Object.values(errors).flat()[0];
  }

  return error?.response?.data?.message;
}

export function UserActionDock({ user, actorRole, onEdit, onView, onFingerprint, onVerify, onDeactivate, onReactivate, onDelete, onAddProfile, onManageProfiles }) {
  const menuId = useId();
  const [expanded, setExpanded] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12, origin: 'top right' });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const name = `${user.first_name} ${user.last_name}`;
  const officerCanManageTarget = actorRole !== 'SBO_OFFICER' || user.role === 'STUDENT';
  const canManageAccount = actorRole !== 'SBO_OFFICER' && officerCanManageTarget && user.role !== 'SUPER_ADMIN';
  const canManageFingerprint = officerCanManageTarget && user.role !== 'SUPER_ADMIN';
  const actions = [
    canManageAccount && { key: 'edit', label: `Edit ${name}`, menuLabel: 'Edit user', title: 'Edit user', icon: PencilLine, onClick: onEdit },
    { key: 'view', label: `View ${name}`, menuLabel: 'View profile', title: 'View user', icon: Eye, onClick: onView },
    ['ADMIN', 'SUPER_ADMIN'].includes(actorRole) && onAddProfile && user.role !== 'SUPER_ADMIN' && { key: 'membership', label: `Add ${name} to an organization`, menuLabel: 'Add to organization', title: 'Add organization profile', icon: UserPlus, onClick: onAddProfile },
    ['ADMIN', 'SUPER_ADMIN'].includes(actorRole) && onManageProfiles && user.role !== 'SUPER_ADMIN' && { key: 'profiles', label: `Manage profiles for ${name}`, menuLabel: 'Manage profiles', title: 'Manage organization profiles', icon: UserPlus, onClick: onManageProfiles },
    canManageFingerprint && { key: 'fingerprint', label: `${user.fingerprint_enrolled ? 'Re-enroll' : 'Enroll'} fingerprint for ${name}`, menuLabel: user.fingerprint_enrolled ? 'Re-enroll fingerprint' : 'Enroll fingerprint', title: user.fingerprint_enrolled ? 'Re-enroll fingerprint' : 'Enroll fingerprint', icon: Fingerprint, onClick: onFingerprint },
    user.role !== 'SUPER_ADMIN' && { key: 'verify', label: `Verify identity for ${name}`, menuLabel: 'Verify identity (1:N)', title: 'Identify one fingerprint against the organization', icon: UserCheck, onClick: onVerify },
    canManageAccount && user.account_status !== 'disabled' && { key: 'deactivate', label: `Deactivate ${name}`, menuLabel: 'Deactivate account', title: 'Deactivate user', icon: UserX, onClick: onDeactivate },
    canManageAccount && user.account_status !== 'active' && { key: 'reactivate', label: `Reactivate ${name}`, menuLabel: 'Reactivate account', title: 'Reactivate user', icon: UserCheck, onClick: onReactivate },
    canManageAccount && { key: 'delete', label: `Delete ${name}`, menuLabel: 'Delete profile', title: 'Delete organization profile', icon: Trash2, onClick: onDelete },
  ].filter(Boolean);

  useEffect(() => {
    if (!expanded) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setExpanded(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const closeOnViewportChange = () => setExpanded(false);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [expanded]);

  const run = (action) => {
    setExpanded(false);
    action.onClick();
  };

  const toggleMenu = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const minLeft = dashboardPopupLeft();
      const menuWidth = 224;
      const menuHeight = 62 + (actions.length * 44);
      const minTop = dashboardPopupTop();
      const visibleMenuHeight = Math.min(menuHeight, Math.max(44, window.innerHeight - minTop - 12));
      const opensUpward = window.innerHeight - rect.bottom < visibleMenuHeight + 16 && rect.top - visibleMenuHeight - 8 >= minTop;
      const preferredTop = opensUpward ? rect.top - visibleMenuHeight - 8 : rect.bottom + 8;
      setMenuPosition({
        left: Math.max(minLeft, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12)),
        top: Math.max(minTop, Math.min(preferredTop, window.innerHeight - visibleMenuHeight - 12)),
        origin: opensUpward ? 'bottom right' : 'top right',
      });
    }
    setExpanded(true);
  };

  const menu = typeof document === 'undefined' ? null : createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={`Actions for ${formatDisplayText(name)}`}
      aria-hidden={!expanded}
      style={{ left: menuPosition.left, top: menuPosition.top, transformOrigin: menuPosition.origin }}
      className={`fixed z-[100] max-h-[calc(100dvh-var(--dashboard-navbar-bottom,0px)-20px)] w-56 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-raised ${expanded ? 'visible' : 'invisible pointer-events-none'}`}
    >
      <p className="truncate border-b border-line-soft px-2.5 py-2 text-xs font-medium text-ink-muted">{formatDisplayText(name)}</p>
      <div className="pt-1">
        {actions.map((action) => {
          const Icon = action.icon;
          const destructive = action.key === 'delete';
          return (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              aria-label={action.label}
              tabIndex={expanded ? 0 : -1}
              onClick={() => run(action)}
              className={`flex h-11 w-full items-center gap-3 rounded-control px-2.5 text-left text-[13px] font-medium ${destructive ? 'text-danger-strong hover:bg-danger-tint' : 'text-ink hover:bg-subtle'}`}
            >
              <Icon size={15} aria-hidden="true" className={destructive ? '' : 'text-ink-muted'} />
              <span className="min-w-0 flex-1 truncate">{action.menuLabel}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="ml-auto flex h-11 w-11 items-center justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${expanded ? 'Close' : 'Open'} actions for ${formatDisplayText(name)}`}
        aria-expanded={expanded}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={toggleMenu}
        className={`grid h-11 w-11 place-items-center rounded-control border border-line transition-colors duration-150 ${expanded ? 'bg-subtle text-ink' : 'bg-surface text-ink-muted hover:bg-subtle hover:text-ink'}`}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}

export function FingerprintEnrollmentModal({ user, onClose, onSaved }) {
  const reader = useFingerprintReader();
  const [captured, setCaptured] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function handleEnroll() {
    setBusy(true);
    setCaptured(0);
    setError('');
    try {
      const capture = await reader.enrollFingerprint(4, ({ captured: count }) => setCaptured(count));
      await enrollFingerprint(user.school_id, capture);
      onSaved('Fingerprint enrollment completed. This user can now be identified with one attendance scan.');
    } catch (enrollmentError) {
      setError(enrollmentError?.response ? firstError(enrollmentError) || 'Unable to enroll this fingerprint.' : enrollmentError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError('');
    try {
      await removeFingerprint(user.school_id);
      onSaved('Fingerprint enrollment removed.');
    } catch (removeError) {
      setError(firstError(removeError) || 'Unable to remove this fingerprint.');
    } finally {
      setBusy(false);
    }
  }

  if (confirmRemove) {
    return <ConfirmModal
      open
      title="Remove fingerprint enrollment"
      message="The encrypted fingerprint template will be removed. Attendance identification will stop working for this student until they enroll again."
      recordName={`${user.first_name} ${user.last_name} · School ID ${user.school_id}`}
      confirmText="Remove fingerprint"
      variant="danger"
      busy={busy}
      onCancel={() => !busy && setConfirmRemove(false)}
      onConfirm={handleRemove}
    />;
  }

  return (
    <Drawer
      open
      title={user.fingerprint_enrolled ? 'Re-enroll fingerprint' : 'Enroll fingerprint'}
      description={`${user.first_name} ${user.last_name} · School ID ${user.school_id}`}
      onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
        {user.fingerprint_enrolled && <Button variant="secondary" className="text-danger-strong" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove</Button>}
        <Button onClick={handleEnroll} disabled={busy || !reader.connected || !consentConfirmed}>{busy ? 'Capturing...' : user.fingerprint_enrolled ? 'Start re-enrollment' : 'Start 4-scan enrollment'}</Button>
      </>}
    >
      <div className="space-y-4">
        <UserIdentityCard user={user} compact />
        <ScannerStatus reader={reader} />
        <div>
          <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-ink">Capture progress</p><span className="text-xs font-medium tabular-nums text-ink-muted">{captured} / 4</span></div>
          <div className="mt-3 grid grid-cols-4 gap-2">{[1, 2, 3, 4].map((step) => <span key={step} className={`h-2 rounded-full ${captured >= step ? 'bg-brand-700' : 'bg-line'}`} />)}</div>
          <p className="mt-3 text-xs leading-5 text-ink-muted-strong">Use the same finger four times, lifting it fully after each accepted capture. Only the encrypted SourceAFIS template is stored.</p>
        </div>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-5 text-ink-muted-strong">
          <input type="checkbox" data-autofocus checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 shrink-0 rounded border-line" />
          <span>I confirm the user consented to biometric enrollment and understands they may request removal of the stored template.</span>
        </label>
        {busy && <p className="text-sm font-medium text-ink">{captured ? 'Sample accepted. Lift your finger, then place the same finger again.' : 'Place the selected finger flat on the reader.'}</p>}
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Drawer>
  );
}

function FingerprintVerificationModal({ expectedUser, onClose }) {
  const reader = useFingerprintReader();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleVerify() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const capture = await reader.identifyFingerprint();
      const response = await identifyFingerprint(capture);
      const identifiedUser = response.data?.user;
      if (!identifiedUser?.school_id) throw new Error('The matcher did not return an identified user. Scan again.');
      setResult({
        user: identifiedUser,
        matchesExpected: String(identifiedUser?.school_id) === String(expectedUser.school_id),
        score: response.data?.match?.score,
        threshold: response.data?.match?.threshold,
      });
    } catch (verificationError) {
      setError(verificationError?.response ? firstError(verificationError) || 'No enrolled user matched this fingerprint.' : verificationError.message);
    } finally {
      setBusy(false);
    }
  }

  const identifiedName = result?.user ? `${result.user.first_name} ${result.user.last_name}` : '';

  return (
    <Drawer
      open
      title="Verify fingerprint identity"
      description="One scan checks the fingerprint against every enrolled user in this organization."
      onClose={() => !busy && onClose()}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
        <Button leftIcon={Fingerprint} onClick={handleVerify} disabled={busy || !reader.connected}>{busy ? 'Scanning once...' : result ? 'Scan again' : 'Scan once to verify'}</Button>
      </>}
    >
      <div className="space-y-4">
        <ScannerStatus reader={reader} />
        <div>
          <p className="text-xs font-semibold text-ink-muted">Expected account</p>
          <p className="mt-1 text-sm font-semibold text-ink">{formatDisplayText(expectedUser.first_name)} {formatDisplayText(expectedUser.last_name)}</p>
          <p className="text-xs text-ink-muted-strong">School ID {expectedUser.school_id} · {ROLE_LABELS[expectedUser.role] || expectedUser.role}</p>
        </div>

        {busy && <p className="text-sm font-medium text-ink">Place one finger flat on the reader. HIUSA searches this organization's enrolled fingerprints.</p>}
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
        {result && <div role="status" className="border-t border-line pt-4">
          <p className={`text-sm font-semibold ${result.matchesExpected ? 'text-success-strong' : 'text-warning-strong'}`}>{result.matchesExpected ? 'Identity confirmed' : 'Different user identified'}</p>
          <p className="mt-1 text-base font-semibold text-ink">{identifiedName}</p>
          <p className="text-xs text-ink-muted-strong">School ID {result.user?.school_id} · {ROLE_LABELS[result.user?.role] || result.user?.role}</p>
          {Number.isFinite(Number(result.score)) && <p className="mt-2 text-xs text-ink-muted">Match score {Number(result.score).toFixed(2)}{Number.isFinite(Number(result.threshold)) ? ` · Required ${Number(result.threshold).toFixed(2)}` : ''}</p>}
        </div>}
      </div>
    </Drawer>
  );
}

export default function AdminUsersPage() {
  let actorRole = '';
  let actorOrganizationId = null;
  try {
    const actor = JSON.parse(localStorage.getItem('user') || '{}');
    actorRole = actor?.role || '';
    actorOrganizationId = actor?.organization_id || actor?.organization?.id || null;
  } catch {}
  const roles = actorRole === 'SBO_OFFICER' ? ['STUDENT'] : accountRoles;
  const visibleFilterRoles = actorRole === 'SBO_OFFICER' ? ['STUDENT'] : filterRoles;
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [searchParams, setSearchParams] = inRouter ? useSearchParams() : [new URLSearchParams(), () => {}];
  const [activeUnit, setActiveUnit] = useState(() => (searchParams.get('tab') === 'admins' ? 'admins' : 'members'));
  const isAdminsUnit = activeUnit === 'admins';
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 10 });
  const [roleSummary, setRoleSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState(() => (searchParams.get('tab') === 'admins' ? 'ADMIN' : 'all'));
  useEffect(() => {
    const tabParam = searchParams.get('tab') === 'admins' ? 'admins' : 'members';
    setActiveUnit(tabParam);
    setRoleFilter(tabParam === 'admins' ? 'ADMIN' : 'all');
  }, [searchParams]);
  const switchUnit = (unit) => {
    setActiveUnit(unit);
    setRoleFilter(unit === 'admins' ? 'ADMIN' : 'all');
    if (inRouter) {
      const next = new URLSearchParams(searchParams);
      if (unit === 'admins') next.set('tab', 'admins');
      else next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  };
  const [programFilter, setProgramFilter] = useState('all');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [modalError, setModalError] = useState('');
  const [modalFieldErrors, setModalFieldErrors] = useState({});
  const [editPhoto, setEditPhoto] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetLink, setResetLink] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUser, setInviteUser] = useState(null);
  const [inviteRole, setInviteRole] = useState('STUDENT');
  const [selectedUser, setSelectedUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [profileDebt, setProfileDebt] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const profileRequestRef = useRef(0);
  const [disableTarget, setDisableTarget] = useState(null);
  const [reactivateTarget, setReactivateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [managedProfileUser, setManagedProfileUser] = useState(null);
  const [fingerprintTarget, setFingerprintTarget] = useState(null);
  const [fingerprintVerifyTarget, setFingerprintVerifyTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [page, setPage] = useState(1);
  const [sboPositions, setSboPositions] = useState([]);
  const [academicStructure, setAcademicStructure] = useState({ department: '', programs: [] });
  const pageSize = 20;
  const [showImport, setShowImport] = useState(false);
  const loadRequestRef = useRef(0);

  const [editForm, setEditForm] = useState(emptyEditForm);

  // Debounced so typing doesn't fire a request per keystroke - role/search are
  // now server-side filters (the endpoint paginates), not a client-side scan.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Shared by load() and export(): every filter maps onto a /users query parameter.
  const userQuery = {
    ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
    ...(programFilter !== 'all' ? { program: programFilter } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };

  async function load() {
    // Filter changes and the page-1 reset they trigger race two requests against
    // each other; only the one still current when it resolves may write state, so
    // a stale filter-change request landing after the page-reset request can't
    // leave the table showing page N while `page` state (and the footer) say 1.
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError('');
    setLoadError('');
    try {
      // Positions and the academic structure are best-effort: a hiccup there must
      // not blank the user table, so each falls back to null instead of rejecting.
      const [usersRes, positions, structure] = await Promise.all([
        getUsers({ ...userQuery, page, per_page: pageSize }),
        getSboPositions().catch(() => null),
        getAcademicStructure().catch(() => null),
      ]);
      if (loadRequestRef.current !== requestId) return;
      setUsers(unwrapList(usersRes));
      setMeta(listMeta(usersRes));
      setRoleSummary(usersRes?.summary?.by_role ?? {});
      setSboPositions(Array.isArray(positions) ? positions : []);
      if (structure) setAcademicStructure(structure || { department: '', programs: [] });
    } catch {
      if (loadRequestRef.current === requestId) setLoadError('Unable to load users.');
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [roleFilter, programFilter, debouncedSearch, page]);

  const refreshUsers = load;

  // Every filter is applied server-side, so any change goes back to page 1.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, programFilter]);

  // /users has no sort parameter, so the page is ordered by name on screen.
  const sortedUsers = useMemo(() => [...users].sort((left, right) => `${left.last_name} ${left.first_name}`.localeCompare(`${right.last_name} ${right.first_name}`)), [users]);

  const exportUsers = async () => {
    // Export every user matching the active filters; the table shows one page.
    const exportRows = await fetchAllPages(getUsers, userQuery);
    const headers = ['School ID', 'Last Name', 'First Name', 'Email', 'Role', 'Position', 'Department', 'Program', 'Major', 'Year Level', 'Section', 'Account Status', 'Created At', 'Updated At'];
    const rows = exportRows.map((user) => [user.school_id, user.last_name, user.first_name, user.email, user.role, user.position_title, user.department, user.program, user.major, user.year_level, user.section, user.account_status, user.created_at, user.updated_at]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `user-register-${manilaDateStamp()}.csv`; link.click(); URL.revokeObjectURL(url);
  };


  const openAddStudent = (user = null) => {
    setInviteUser(user);
    setInviteRole(isAdminsUnit && !user ? 'ADMIN' : 'STUDENT');
    setShowInvite(true);
  };

  const openEdit = (user) => {
    setSelectedUser(user);
    setEditForm({
      school_id: user.school_id,
      first_name: user.first_name,
      last_name: user.last_name,
      contact_number: user.contact_number || '',
      role: user.role,
      position_title: user.position_title || '',
      department: user.department || '',
      program: user.program || '',
      year_level: user.year_level || '',
      major: user.major || '', section: user.section || '',
    });
    setModalError('');
    setResetError('');
    setModalFieldErrors({}); setEditPhoto(null);
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
    if (user.role !== 'STUDENT' || actorRole === 'SBO_OFFICER') { setProfileLoading(false); return; }
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

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!selectedUser) return;
    if (editPhoto && (editPhoto.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(editPhoto.type))) { setModalFieldErrors({ photo: ['Choose a JPEG, PNG, or WebP image up to 2 MB.'] }); return; }

    setModalError('');
    setModalFieldErrors({});
    setBusy(true);

    try {
      const editableFields = { ...editForm };
      delete editableFields.school_id;
      await updateUser(selectedUser.id, {
        ...editableFields,
        position_title: ['ADMIN', 'SBO_OFFICER'].includes(editForm.role) ? editForm.position_title : '',
      });
      let photoError = false;
      if (editPhoto) {
        try { await uploadUserPhoto(selectedUser.id, editPhoto); } catch { photoError = true; }
      }
      setSelectedUser(null);
      setEditPhoto(null);
      await refreshUsers();
      setFeedback({ open: true, type: photoError ? 'error' : 'success', message: photoError ? 'Account updated, but its profile photo could not be uploaded.' : 'User account updated.' });
    } catch (updateError) {
      setModalError(firstError(updateError) || 'Unable to update user.');
      setModalFieldErrors(updateError?.response?.data?.errors || {});
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    setResetError('');
    setResetBusy(true);
    try {
      const response = await resetUserPassword(selectedUser.id);
      const name = `${selectedUser.first_name} ${selectedUser.last_name}`;
      setSelectedUser(null);
      if (response.reset_link) {
        setResetLink({ link: response.reset_link, name });
      } else {
        setFeedback({ open: true, type: 'success', message: response.message || `Password reset instructions were sent to ${name}.` });
      }
    } catch (resetRequestError) {
      setResetError(firstError(resetRequestError) || 'Could not start the password reset. Try again.');
    } finally {
      setResetBusy(false);
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
      setFeedback({ open: true, type: 'success', message: `${deleteTarget.first_name} ${deleteTarget.last_name} had their organization profile removed.` });
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(firstError(deleteError) || 'Unable to delete this user because linked records may still exist.');
      setDeleteTarget(null);
    } finally { setBusy(false); }
  };

  const fieldError = (name) => modalFieldErrors[name]?.[0];

  const userForm = (form, setForm) => {
    const selectedProgram = academicStructure.programs?.find((program) => program.name === form.program);
    const hasPosition = ['ADMIN', 'SBO_OFFICER'].includes(form.role);
    return (
      <form id="edit-user-form" onSubmit={handleEdit} className="space-y-4">
        {selectedUser && <UserIdentityCard user={selectedUser} compact />}
        <h3 className="text-sm font-semibold text-ink">Identity and contact</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldError('first_name')}>
            <Input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} />
          </Field>
          <Field label="Last name" required error={fieldError('last_name')}>
            <Input value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} />
          </Field>
        </div>
        <Field label="Contact number" optional error={fieldError('contact_number')}>
          <Input type="tel" value={form.contact_number} onChange={(event) => setForm({ ...form, contact_number: event.target.value })} placeholder="e.g. +63 912 345 6789" maxLength={30} />
        </Field>
        <Field label="Profile photo" optional error={fieldError('photo')} hint="JPEG, PNG or WebP, up to 2 MB.">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setEditPhoto(event.target.files?.[0] || null)} className="block w-full rounded-control border border-line bg-surface text-sm text-ink file:mr-3 file:h-10 file:border-0 file:bg-subtle file:px-4 file:text-sm file:font-semibold file:text-brand-700" />
        </Field>
        <h3 className="border-t border-line pt-4 text-sm font-semibold text-ink">Role and academic details</h3>
        <Field label="Role" required error={fieldError('role')}>
          <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, position_title: '' })} disabled={actorRole === 'SBO_OFFICER' || selectedUser?.role === 'ADMIN'}>
            {(selectedUser?.role === 'ADMIN' ? ['ADMIN'] : roles).map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </Select>
        </Field>
        {hasPosition && (
          <Field label="Organization position" optional error={fieldError('position_title')}>
            <Select value={form.position_title} onChange={(event) => setForm({ ...form, position_title: event.target.value })}>
              <option value="">Choose a position</option>
              {sboPositions.filter((position) => position.is_active && position.role === form.role && !/^adviser$/i.test(position.title.trim())).map((position) => (
                <option key={position.id} value={position.title}>{formatDisplayText(position.title)}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Course or program"
          optional
          error={fieldError('program')}
          hint={form.role === 'STUDENT' && !academicStructure.programs?.length ? 'Set up a program in Programs and sections first.' : undefined}
        >
          <Select value={form.program} onChange={(event) => setForm({ ...form, program: event.target.value, section: '' })}>
            <option value="">Choose a program</option>
            {academicStructure.programs?.map((program) => <option key={program.id} value={program.name}>{formatDisplayText(program.name)}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Year level" optional error={fieldError('year_level')}>
            <Select value={form.year_level} onChange={(event) => setForm({ ...form, year_level: event.target.value, section: '' })} disabled={!form.program}>
              <option value="">Choose a year level</option>
              {programYears(selectedProgram).map((year) => <option key={year}>{year}</option>)}
            </Select>
          </Field>
          <Field label="Section" optional error={fieldError('section')}>
            <Select value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value })} disabled={!form.program || !form.year_level}>
              <option value="">Choose a section</option>
              {selectedProgram?.sections?.filter((section) => Number(section.year_level) === yearNumber(form.year_level)).map((section) => <option key={section.id} value={section.name}>{formatDisplayText(section.name)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Major or specialization" optional error={fieldError('major')}>
          <Input value={form.major} onChange={(event) => setForm({ ...form, major: event.target.value })} />
        </Field>
        {modalError && <p role="alert" className="text-sm font-semibold text-danger-strong">{modalError}</p>}
      </form>
    );
  };

  const resetPasswordSection = () => {
    if (actorRole !== 'ADMIN' || !['STUDENT', 'SBO_OFFICER'].includes(selectedUser?.role) || (selectedUser.account_status || 'active') !== 'active') return null;
    if (selectedUser.is_primary_profile === false) {
      return <p className="mt-4 border-t border-line pt-4 text-sm text-ink-muted">The SAO resets this password.</p>;
    }
    return (
      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-ink">Password</h3>
        <p className="text-sm text-ink-muted">Create a one-time link that lets this member choose a new password. You never see or set the password yourself.</p>
        <Button variant="secondary" onClick={handleResetPassword} loading={resetBusy} disabled={busy}>Reset password</Button>
        {resetError && <p role="alert" className="text-sm font-semibold text-danger-strong">{resetError}</p>}
      </div>
    );
  };

  const filtersActive = Boolean(search.trim() || (!isAdminsUnit && roleFilter !== 'all') || programFilter !== 'all');

  const clearUserFilters = () => {
    setSearch('');
    setRoleFilter(isAdminsUnit ? 'ADMIN' : 'all');
    setProgramFilter('all');
    setPage(1);
  };

  const dock = (user) => (
    <UserActionDock
      user={user}
      actorRole={actorRole}
      onEdit={() => openEdit(user)}
      onView={() => openProfile(user)}
      onManageProfiles={() => setManagedProfileUser(user)}
      onAddProfile={() => openAddStudent(user)}
      onFingerprint={() => setFingerprintTarget(user)}
      onVerify={() => setFingerprintVerifyTarget(user)}
      onDeactivate={() => setDisableTarget(user)}
      onReactivate={() => setReactivateTarget(user)}
      onDelete={() => setDeleteTarget(user)}
    />
  );

  // The default state (an active account, no fingerprint yet) carries no badge and no text. Status and
  // fingerprint sit under the name, and the program column appears only when someone on the page has one,
  // so no row shows an empty cell.
  const hasAcademic = sortedUsers.some((user) => user.program || user.year_level || user.section || user.major);
  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (user) => (
        <>
          <span className="font-medium">{formatDisplayText(user.first_name)} {formatDisplayText(user.last_name)}</span>
          {user.account_status && user.account_status !== 'active' && <span className="ml-2 align-middle"><StatusBadge tone={user.account_status === 'disabled' ? 'danger' : 'warning'} label={user.account_status === 'disabled' ? 'Disabled' : 'Inactive'} /></span>}
          <span className="block text-xs tabular-nums text-ink-muted">{user.school_id}</span>
          {user.fingerprint_enrolled && <span className="block text-xs text-ink-muted">Fingerprint enrolled</span>}
        </>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (user) => (
        <>
          {user.position_title ? formatDisplayText(user.position_title) : ROLE_SHORT[user.role] || user.role}
          {user.position_title && <span className="block text-xs text-ink-muted">{ROLE_SHORT[user.role] || user.role}</span>}
        </>
      ),
    },
    ...(hasAcademic ? [{
      key: 'program',
      header: 'Program',
      render: (user) => (
        <>
          {user.program}
          {(user.year_level || user.section || user.major) && <span className="block text-xs text-ink-muted">{[user.year_level, user.section, user.major].filter(Boolean).join(' · ')}</span>}
        </>
      ),
    }] : []),
  ];

  const canManage = actorRole !== 'SBO_OFFICER';

  // Export and Import sit with the table they act on, so the page header holds only the one primary action
  // and stays inside a 390px screen.
  const tableTools = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="text-sm tabular-nums text-ink-muted">{meta.total} {meta.total === 1 ? 'user' : 'users'}</p>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" leftIcon={Download} onClick={exportUsers} disabled={!meta.total}>Export</Button>
          {actorRole === 'ADMIN' && <Button variant="ghost" leftIcon={Upload} onClick={() => setShowImport(true)}>Import</Button>}
        </div>
      )}
    </div>
  );

  const filters = (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
          <Input aria-label="Search users" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, school ID, program or email" className="pl-9" />
        </div>
        {!isAdminsUnit && visibleFilterRoles.length > 1 && (
          <Select aria-label="Filter by role" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }} className="sm:w-44">
            <option value="all">All roles</option>
            {visibleFilterRoles.map((role) => (
              <option key={role} value={role}>{ROLE_SHORT[role]}</option>
            ))}
          </Select>
        )}
        <Select aria-label="Filter by program" value={programFilter} onChange={(event) => setProgramFilter(event.target.value)} className="sm:w-52">
          <option value="all">All programs</option>
          {academicStructure.programs?.map((program) => <option key={program.id} value={program.name}>{formatDisplayText(program.name)}</option>)}
        </Select>
        {filtersActive && (
          <button type="button" onClick={clearUserFilters} className="min-h-11 self-start rounded-control px-1 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 sm:self-auto">Clear</button>
        )}
      </div>
      {tableTools}
    </div>
  );

  const tabClass = (selected) => `-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm ${selected ? 'border-brand-700 font-semibold text-ink' : 'border-transparent font-medium text-ink-muted hover:text-ink'}`;

  return (
    <div className="space-y-5">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
      <PageHeader
        primary={canManage ? <Button leftIcon={UserPlus} onClick={() => openAddStudent()}>{isAdminsUnit ? 'Add administrator' : 'Add existing student'}</Button> : undefined}
      />

      {actorRole === 'ADMIN' && (
        <div className="flex border-b border-line" role="tablist" aria-label="Member management units">
          <button type="button" role="tab" aria-selected={!isAdminsUnit} onClick={() => switchUnit('members')} className={tabClass(!isAdminsUnit)}>All members</button>
          <button type="button" role="tab" aria-selected={isAdminsUnit} onClick={() => switchUnit('admins')} className={tabClass(isAdminsUnit)}>Manage admins ({roleSummary.ADMIN ?? 0})</button>
        </div>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}

      <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <DataTable
          caption={isAdminsUnit ? 'Administrators' : 'Users'}
          columns={columns}
          rows={sortedUsers}
          rowKey={(user) => user.id}
          loading={loading}
          error={loadError || null}
          onRetry={refreshUsers}
          filters={filters}
          filtersActive={filtersActive}
          onClearFilters={clearUserFilters}
          pageSize={pageSize}
          actions={dock}
          emptyState={!filtersActive && meta.total === 0 ? (
            <EmptyState title="No users yet" description="People you add to this organization show here." />
          ) : undefined}
          pagination={(
            <PaginationControls
              currentPage={meta.currentPage}
              totalItems={meta.total}
              pageSize={meta.perPage}
              onPageChange={setPage}
              label="users"
            />
          )}
        />
      </section>

      {actorRole === 'ADMIN' && actorOrganizationId && <OrgAccessPanel organizationId={actorOrganizationId} actorRole={actorRole} />}

      <Drawer
        open={Boolean(profileUser)}
        title="User profile"
        description={profileUser ? `${profileUser.first_name} ${profileUser.last_name} · School ID ${profileUser.school_id}` : ''}
        width="max-w-xl"
        onClose={closeProfile}
      >
        {profileUser && <div className="space-y-5">
          <UserIdentityCard user={profileUser} />
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ['Email', profileUser.email], ['Contact number', profileUser.contact_number], ['Role', ROLE_LABELS[profileUser.role] || profileUser.role], ['Account status', profileUser.account_status || 'active'],
              ['Department', profileUser.department], ['Course or program', profileUser.program], ['Year level', profileUser.year_level],
              ['Major or specialization', profileUser.major], ['Section', profileUser.section], ['Organization position', profileUser.position_title], ['Fingerprint', profileUser.fingerprint_enrolled ? 'Enrolled' : 'Not enrolled'],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className="mt-0.5 min-h-5 break-words text-sm text-ink">{value}</dd></div>)}
          </dl>
          {profileUser.role === 'STUDENT' && actorRole !== 'SBO_OFFICER' && <section className="border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">What this student owes</h3>
              {profileDebt && <StatusBadge tone={profileDebt.clearance_status === 'financially_cleared' ? 'success' : 'warning'} label={profileDebt.clearance_status === 'financially_cleared' ? 'Financially cleared' : 'Pending clearance'} />}
            </div>
            {profileLoading && <div role="status" className="mt-3"><Skeleton className="h-20 w-full" /><span className="sr-only">Loading what this student owes</span></div>}
            {profileError && <p role="alert" className="mt-3 text-sm font-medium text-warning-strong">{profileError}</p>}
            {!profileLoading && profileDebt && <>
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">{[['Invoice balance', profileDebt.invoice_debt], ['Reserved merchandise', profileDebt.reserved_order_debt], ['Total outstanding', profileDebt.total_debt]].map(([label, amount]) => <div key={label}><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{money(amount)}</dd></div>)}</dl>
              {profileDebt.total_debt > 0 && <div className="mt-4 space-y-4">
                {profileDebt.invoices?.length > 0 && <div><p className="text-sm font-semibold text-ink">Unsettled invoices</p><ul className="mt-1 divide-y divide-line-soft">{profileDebt.invoices.map((invoice) => <li key={invoice.id} className="flex justify-between gap-3 py-2 text-sm"><span><span className="font-medium">{invoice.reference}</span><span className="block text-xs text-ink-muted">{invoice.description}</span></span><span className="font-medium tabular-nums">{money(invoice.remaining_balance)}</span></li>)}</ul></div>}
                {profileDebt.reserved_orders?.length > 0 && <div><p className="text-sm font-semibold text-ink">Reserved merchandise awaiting payment</p><ul className="mt-1 divide-y divide-line-soft">{profileDebt.reserved_orders.map((order) => <li key={order.id} className="flex justify-between gap-3 py-2 text-sm"><span><span className="font-medium">Order ORD-{order.id}</span><span className="block text-xs text-ink-muted">{formatDisplayText(order.merchandise?.name) || 'Merchandise item'}</span></span><span className="font-medium tabular-nums">{money(order.total_price)}</span></li>)}</ul></div>}
              </div>}
              {profileDebt.total_debt <= 0 && <p className="mt-4 text-sm font-medium text-success-strong">No unsettled invoices or reserved merchandise.</p>}
            </>}
          </section>}
        </div>}
      </Drawer>

      {fingerprintTarget && <FingerprintEnrollmentModal
        user={fingerprintTarget}
        onClose={() => setFingerprintTarget(null)}
        onSaved={async (message) => {
          setFingerprintTarget(null);
          await refreshUsers();
          setFeedback({ open: true, type: 'success', message });
        }}
      />}

      {fingerprintVerifyTarget && <FingerprintVerificationModal
        expectedUser={fingerprintVerifyTarget}
        onClose={() => setFingerprintVerifyTarget(null)}
      />}

      {managedProfileUser && <ManageAccountProfilesModal user={managedProfileUser} onClose={() => setManagedProfileUser(null)} onDeleted={(result) => { setFeedback({ open: true, type: 'success', message: result.message }); load(); }} />}
      {showInvite && <AddExistingUserModal actorRole={actorRole} initialUser={inviteUser} initialRole={inviteRole} onClose={() => setShowInvite(false)} onAdded={() => { setFeedback({ open: true, type: 'success', message: 'User added to the organization.' }); load(); }} />}

      <Drawer
        open={Boolean(selectedUser)}
        title="Edit user"
        description={selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}` : ''}
        width="max-w-xl"
        onClose={closeEdit}
        footer={(
          <>
            <Button variant="secondary" onClick={closeEdit} disabled={busy}>Cancel</Button>
            <Button type="submit" form="edit-user-form" loading={busy}>Save changes</Button>
          </>
        )}
      >
        {userForm(editForm, setEditForm)}
        {resetPasswordSection()}
      </Drawer>

      <ConfirmModal
        open={Boolean(disableTarget)}
        title="Deactivate user"
        message="This changes the account status and signs the user out of active sessions."
        recordName={disableTarget ? `${disableTarget.first_name} ${disableTarget.last_name}` : ''}
        confirmText="Deactivate"
        variant="danger"
        busy={busy}
        onCancel={() => !busy && setDisableTarget(null)}
        onConfirm={handleDisable}
      />

      <ConfirmModal
        open={Boolean(reactivateTarget)}
        title="Reactivate user"
        message="This restores account access. If the account was deactivated before, the user may still need to reset their password."
        recordName={reactivateTarget ? `${reactivateTarget.first_name} ${reactivateTarget.last_name}` : ''}
        confirmText="Reactivate"
        variant="success"
        busy={busy}
        onCancel={() => !busy && setReactivateTarget(null)}
        onConfirm={handleReactivate}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete organization profile"
        message="This removes the organization profile. Other profiles stay. If it is the final profile, the user account is also deleted. Linked records can prevent final deletion."
        recordName={deleteTarget ? `${deleteTarget.first_name} ${deleteTarget.last_name}` : ''}
        confirmationText={deleteTarget ? `${deleteTarget.first_name} ${deleteTarget.last_name}`.trim() : ''}
        confirmText="Delete profile"
        variant="danger"
        busy={busy}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
      {resetLink && (
        <OneTimeLinkModal
          title="Reset link ready"
          description={`Send this to ${resetLink.name}. It lets them choose a new password.`}
          label="Reset link"
          hint="Works once and expires in 60 minutes. It is not shown again."
          link={resetLink.link}
          onClose={() => { setFeedback({ open: true, type: 'success', message: `Reset link created for ${resetLink.name}.` }); setResetLink(null); }}
        />
      )}
      <UserImportDrawer open={showImport} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />
    </div>
  );
}
