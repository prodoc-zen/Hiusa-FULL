import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Key, Lock, Mail, Save, User } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import { updatePassword, updateProfile } from '../../../services/profileService';
import { getApiErrorMessage } from '../../../utils/apiError';

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user')) || {};
  } catch {
    return {};
  }
}

function roleLabel(role) {
  return {
    ADMIN: 'Admin',
    SBO_OFFICER: 'SBO Officer',
    STUDENT: 'Student',
    DEPARTMENT_HEAD: 'Department Head',
  }[role] || role || 'User';
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(getStoredUser);
  const [showPassword, setShowPassword] = useState(false);
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const [profileForm, setProfileForm] = useState({
    first_name: currentUser.first_name || '',
    last_name: currentUser.last_name || '',
    email: currentUser.email || '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);

  const [pwForm, setPwForm] = useState({ current_password: '', password: '', password_confirmation: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState(null);

  const closeFeedback = useCallback(() => {
    setFeedback((current) => ({ ...current, open: false }));
  }, []);

  const showFeedback = useCallback((type, message) => {
    setFeedback({ open: true, type, message });
  }, []);

  const initials = [currentUser.first_name?.[0], currentUser.last_name?.[0]].filter(Boolean).join('').toUpperCase() || 'U';
  const fullName = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'User';
  const organizationName = currentUser.organization?.name || currentUser.organization?.acronym || 'Selected organization';

  async function handleProfileSave(event) {
    event.preventDefault();

    if (!profileForm.first_name.trim() || !profileForm.last_name.trim() || !profileForm.email.trim()) {
      const message = 'First name, last name, and email are required.';
      setProfileError(message);
      showFeedback('error', message);
      return;
    }

    setProfileSaving(true);
    setProfileError(null);

    try {
      const response = await updateProfile({
        first_name: profileForm.first_name.trim(),
        last_name: profileForm.last_name.trim(),
        email: profileForm.email.trim(),
      });
      const updatedUser = { ...currentUser, ...response.data };

      localStorage.setItem('user', JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setProfileForm({
        first_name: updatedUser.first_name || '',
        last_name: updatedUser.last_name || '',
        email: updatedUser.email || '',
      });
      showFeedback('success', 'Profile changes saved.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to save profile.');
      setProfileError(message);
      showFeedback('error', message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSave(event) {
    event.preventDefault();

    if (!pwForm.current_password || !pwForm.password || !pwForm.password_confirmation) {
      const message = 'Current password, new password, and confirmation are required.';
      setPwError(message);
      showFeedback('error', message);
      return;
    }

    if (pwForm.password.length < 8) {
      const message = 'New password must be at least 8 characters.';
      setPwError(message);
      showFeedback('error', message);
      return;
    }

    if (pwForm.password !== pwForm.password_confirmation) {
      const message = 'New passwords do not match.';
      setPwError(message);
      showFeedback('error', message);
      return;
    }

    setPwSaving(true);
    setPwError(null);

    try {
      await updatePassword(pwForm);
      setPwForm({ current_password: '', password: '', password_confirmation: '' });
      showFeedback('success', 'Password updated. Please log in again.');
      window.setTimeout(() => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        navigate('/login', { replace: true });
      }, 1200);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Failed to update password.');
      setPwError(message);
      showFeedback('error', message);
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <FeedbackToast feedback={feedback} onClose={closeFeedback} />

      <section className="rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-lg font-black text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-[#0F172A]">Manage Profile</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">{fullName}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-400">
              {roleLabel(currentUser.role)} - {organizationName}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
              <User size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Profile Information</h2>
              <p className="text-xs font-medium text-slate-500">View and update your account details.</p>
            </div>
          </div>

          <div className="mb-5 grid gap-3 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold text-slate-500">School ID</span>
              <span className="font-bold text-[#0F172A]">{currentUser.school_id || currentUser.id || 'N/A'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold text-slate-500">Role</span>
              <span className="font-bold text-[#0F172A]">{roleLabel(currentUser.role)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold text-slate-500">Organization</span>
              <span className="truncate text-right font-bold text-[#0F172A]">{organizationName}</span>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleProfileSave}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[13px] font-semibold text-[#0F172A]">First Name</span>
                <input
                  type="text"
                  value={profileForm.first_name}
                  onChange={(event) => setProfileForm({ ...profileForm, first_name: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[13px] font-semibold text-[#0F172A]">Last Name</span>
                <input
                  type="text"
                  value={profileForm.last_name}
                  onChange={(event) => setProfileForm({ ...profileForm, last_name: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </label>
            </div>
            <label className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#0F172A]">Email</span>
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 pr-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </span>
            </label>

            {profileError && <p className="text-xs font-semibold text-red-600">{profileError}</p>}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={profileSaving}
                className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50"
              >
                <Save size={15} />
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
              <Lock size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Change Password</h2>
              <p className="text-xs font-medium text-slate-500">Verify your current password before setting a new one.</p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handlePasswordSave}>
            <label className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#0F172A]">Current Password</span>
              <span className="relative block">
                <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={pwForm.current_password}
                  onChange={(event) => setPwForm({ ...pwForm, current_password: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 pr-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition hover:text-[#0B8ED0]"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#0F172A]">New Password</span>
              <span className="relative block">
                <Key className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={pwForm.password}
                  onChange={(event) => setPwForm({ ...pwForm, password: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 pr-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </span>
            </label>
            <label className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#0F172A]">Confirm New Password</span>
              <span className="relative block">
                <Key className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={pwForm.password_confirmation}
                  onChange={(event) => setPwForm({ ...pwForm, password_confirmation: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 pr-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </span>
            </label>

            {pwError && <p className="text-xs font-semibold text-red-600">{pwError}</p>}

            <button
              type="submit"
              disabled={pwSaving}
              className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50"
            >
              <Lock size={15} />
              {pwSaving ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
