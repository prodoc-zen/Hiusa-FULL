import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, Eye, EyeOff, IdCard, KeyRound, LockKeyhole, Mail, Save, ShieldCheck, UserRound } from 'lucide-react';
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
  const [passwordVisibility, setPasswordVisibility] = useState({ current: false, next: false, confirmation: false });
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
  const schoolId = currentUser.school_id || currentUser.id || 'N/A';
  const profileDirty = profileForm.first_name !== (currentUser.first_name || '')
    || profileForm.last_name !== (currentUser.last_name || '')
    || profileForm.email !== (currentUser.email || '');
  const passwordLongEnough = pwForm.password.length >= 8;
  const passwordsMatch = Boolean(pwForm.password) && pwForm.password === pwForm.password_confirmation;

  function togglePasswordVisibility(field) {
    setPasswordVisibility((current) => ({ ...current, [field]: !current[field] }));
  }

  function resetProfileForm() {
    setProfileForm({
      first_name: currentUser.first_name || '',
      last_name: currentUser.last_name || '',
      email: currentUser.email || '',
    });
    setProfileError(null);
  }

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
    <div className="mx-auto max-w-6xl space-y-6">
      <FeedbackToast feedback={feedback} onClose={closeFeedback} />

      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0B8ED0]">Account settings</p>
          <h1 className="mt-1 text-2xl font-black text-[#0F172A] sm:text-3xl">Manage your profile</h1>
          <p className="mt-1 text-sm font-medium text-[#64748B]">Keep your personal details current and protect your HIUSA account.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
          <CheckCircle2 size={14} /> Account active
        </span>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm lg:sticky lg:top-6">
          <div className="bg-[#0B1831] px-5 py-6 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-4 border-white/20 bg-[#0B8ED0] text-2xl font-black text-white shadow-sm">
              {initials}
            </div>
            <h2 className="mt-4 break-words text-lg font-extrabold text-white">{fullName}</h2>
            <span className="mt-2 inline-flex rounded-full bg-[#16C7F3]/15 px-3 py-1 text-[11px] font-bold text-[#7DDEFA]">{roleLabel(currentUser.role)}</span>
            {currentUser.position_title && <p className="mt-2 text-xs font-medium text-slate-300">{currentUser.position_title}</p>}
          </div>

          <div className="divide-y divide-[#E5EDF3] px-5">
            <div className="flex gap-3 py-4">
              <IdCard size={17} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">School ID</p>
                <p className="mt-1 break-words text-sm font-bold text-[#0F172A]">{schoolId}</p>
              </div>
            </div>
            <div className="flex gap-3 py-4">
              <Building2 size={17} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Organization</p>
                <p className="mt-1 break-words text-sm font-bold leading-5 text-[#0F172A]">{organizationName}</p>
              </div>
            </div>
            <div className="flex gap-3 py-4">
              <Mail size={17} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Email address</p>
                <p className="mt-1 break-all text-sm font-bold text-[#0F172A]">{currentUser.email || 'Not provided'}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-[#DDE7EF] bg-[#F8FBFD] p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-xs font-bold text-[#0F172A]">Protected account</p>
                <p className="mt-1 text-[11px] font-medium leading-5 text-[#64748B]">Profile and password changes are verified by the authenticated API.</p>
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-6">
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-[#DDE7EF] p-5 sm:p-6">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                <UserRound size={19} />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-[#0F172A]">Personal information</h2>
                <p className="mt-0.5 text-xs font-medium text-[#64748B]">Update the name and email shown across your organization.</p>
              </div>
            </div>

            <form onSubmit={handleProfileSave}>
              <div className="space-y-5 p-5 sm:p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[13px] font-semibold text-[#0F172A]">First name</span>
                    <input type="text" autoComplete="given-name" value={profileForm.first_name} onChange={(event) => setProfileForm({ ...profileForm, first_name: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[13px] font-semibold text-[#0F172A]">Last name</span>
                    <input type="text" autoComplete="family-name" value={profileForm.last_name} onChange={(event) => setProfileForm({ ...profileForm, last_name: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                  </label>
                </div>
                <label className="space-y-1.5">
                  <span className="text-[13px] font-semibold text-[#0F172A]">Email address</span>
                  <span className="relative block">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={16} />
                    <input type="email" autoComplete="email" value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                  </span>
                  <span className="block text-[11px] font-medium text-[#94A3B8]">Used for account recovery and organization notifications.</span>
                </label>

                {profileError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">{profileError}</p>}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-[#DDE7EF] bg-[#F8FBFD] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button type="button" onClick={resetProfileForm} disabled={!profileDirty || profileSaving} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-5 text-sm font-bold text-[#64748B] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Discard changes</button>
                <button type="submit" disabled={!profileDirty || profileSaving} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:cursor-not-allowed disabled:opacity-40">
                  <Save size={15} /> {profileSaving ? 'Saving...' : 'Save profile'}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-[#DDE7EF] p-5 sm:p-6">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                <LockKeyhole size={19} />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-[#0F172A]">Password & security</h2>
                <p className="mt-0.5 text-xs font-medium text-[#64748B]">Confirm your current password before choosing a new one.</p>
              </div>
            </div>

            <form onSubmit={handlePasswordSave}>
              <div className="space-y-5 p-5 sm:p-6">
                <label className="block max-w-xl space-y-1.5">
                  <span className="text-[13px] font-semibold text-[#0F172A]">Current password</span>
                  <span className="relative block">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={16} />
                    <input type={passwordVisibility.current ? 'text' : 'password'} autoComplete="current-password" value={pwForm.current_password} onChange={(event) => setPwForm({ ...pwForm, current_password: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-10 pr-11 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                    <button type="button" aria-label={passwordVisibility.current ? 'Hide current password' : 'Show current password'} onClick={() => togglePasswordVisibility('current')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#94A3B8] transition hover:text-[#0B8ED0]">{passwordVisibility.current ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </span>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[13px] font-semibold text-[#0F172A]">New password</span>
                    <span className="relative block">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={16} />
                      <input type={passwordVisibility.next ? 'text' : 'password'} autoComplete="new-password" value={pwForm.password} onChange={(event) => setPwForm({ ...pwForm, password: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-10 pr-11 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                      <button type="button" aria-label={passwordVisibility.next ? 'Hide new password' : 'Show new password'} onClick={() => togglePasswordVisibility('next')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#94A3B8] transition hover:text-[#0B8ED0]">{passwordVisibility.next ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                    </span>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[13px] font-semibold text-[#0F172A]">Confirm new password</span>
                    <span className="relative block">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={16} />
                      <input type={passwordVisibility.confirmation ? 'text' : 'password'} autoComplete="new-password" value={pwForm.password_confirmation} onChange={(event) => setPwForm({ ...pwForm, password_confirmation: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-10 pr-11 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                      <button type="button" aria-label={passwordVisibility.confirmation ? 'Hide password confirmation' : 'Show password confirmation'} onClick={() => togglePasswordVisibility('confirmation')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#94A3B8] transition hover:text-[#0B8ED0]">{passwordVisibility.confirmation ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                    </span>
                  </label>
                </div>

                <div className="grid gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-xs font-semibold sm:grid-cols-2">
                  <span className={`flex items-center gap-2 ${passwordLongEnough ? 'text-emerald-700' : 'text-[#64748B]'}`}><CheckCircle2 size={15} /> At least 8 characters</span>
                  <span className={`flex items-center gap-2 ${passwordsMatch ? 'text-emerald-700' : 'text-[#64748B]'}`}><CheckCircle2 size={15} /> New passwords match</span>
                </div>

                {pwError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">{pwError}</p>}
              </div>

              <div className="flex flex-col gap-3 border-t border-[#DDE7EF] bg-[#F8FBFD] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="flex items-center gap-2 text-[11px] font-medium text-[#64748B]"><ShieldCheck size={15} /> Updating your password signs you out on every device.</p>
                <button type="submit" disabled={pwSaving} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50">
                  <LockKeyhole size={15} /> {pwSaving ? 'Updating...' : 'Update password'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
