import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useState } from 'react';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import FeedbackToast from '../../../components/FeedbackToast';
import { Button, Field, Input } from '../../../components/ui';
import NotificationPreferences from '../../../components/profile/NotificationPreferences';
import RecentActivity from '../../../components/profile/RecentActivity';
import { updatePassword, updateProfile } from '../../../services/profileService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { visibleSchoolId } from '../../../utils/schoolId';

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user')) || {};
  } catch {
    return {};
  }
}

function roleLabel(role) {
  return {
    SUPER_ADMIN: 'Administrator',
    ADMIN: 'Admin',
    SBO_OFFICER: 'SBO Officer',
    STUDENT: 'Student',
    DEPARTMENT_HEAD: 'Department Head',
  }[role] || role || 'User';
}

// Each section is a heading column beside its content; they stack on narrow screens.
const SECTION = 'grid gap-4 p-5 sm:p-6 lg:grid-cols-[14rem_1fr] lg:gap-8';
const SECTION_TITLE = 'text-base font-semibold text-ink';

// Field hands its id and aria props to its one child, so the eye button lives inside this wrapper.
function PasswordInput({ visible, onToggle, toggleLabel, ...props }) {
  return (
    <span className="relative block">
      <Input type={visible ? 'text' : 'password'} className="pr-11" {...props} />
      <button type="button" aria-label={toggleLabel} onClick={onToggle} className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-control text-ink-muted hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600">{visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button>
    </span>
  );
}

export default function SettingsPage() {
  const [currentUser, setCurrentUser] = useState(getStoredUser);
  const [passwordVisibility, setPasswordVisibility] = useState({ profile: false, current: false, next: false, confirmation: false });
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });

  const [profileForm, setProfileForm] = useState({
    first_name: currentUser.first_name || '',
    last_name: currentUser.last_name || '',
    email: currentUser.email || '',
    contact_number: currentUser.contact_number || '',
    current_password: '',
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

  const fullName = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'User';
  const organizationName = currentUser.organization?.name || currentUser.organization?.acronym || '';
  const roleTitle = currentUser.position_title ? formatDisplayText(currentUser.position_title) : roleLabel(currentUser.role);
  const schoolId = currentUser.school_id ? visibleSchoolId(currentUser.school_id) : (currentUser.id || 'N/A');
  const identityChanged = profileForm.first_name.trim() !== (currentUser.first_name || '')
    || profileForm.last_name.trim() !== (currentUser.last_name || '')
    || profileForm.email.trim().toLowerCase() !== (currentUser.email || '').toLowerCase();
  const profileDirty = profileForm.first_name !== (currentUser.first_name || '')
    || profileForm.last_name !== (currentUser.last_name || '')
    || profileForm.email !== (currentUser.email || '')
    || profileForm.contact_number !== (currentUser.contact_number || '');
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
      contact_number: currentUser.contact_number || '',
      current_password: '',
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

    if (identityChanged && !profileForm.current_password) {
      const message = 'Enter your current password to change your name or email.';
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
        contact_number: profileForm.contact_number.trim() || null,
        ...(identityChanged && { current_password: profileForm.current_password }),
      });
      const updatedUser = { ...currentUser, ...response.data };

      localStorage.setItem('user', JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setProfileForm({
        first_name: updatedUser.first_name || '',
        last_name: updatedUser.last_name || '',
        email: updatedUser.email || '',
        contact_number: updatedUser.contact_number || '',
        current_password: '',
      });
      showFeedback('success', 'Profile changes saved.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Could not save your profile. Try again.');
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
      const response = await updatePassword(pwForm);
      const updatedUser = { ...currentUser, ...response?.data?.user, must_change_password: false };

      localStorage.setItem('user', JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setPwForm({ current_password: '', password: '', password_confirmation: '' });
      showFeedback('success', 'Password updated. Your other devices were signed out.');
    } catch (error) {
      const message = getApiErrorMessage(error, 'Could not update your password. Try again.');
      setPwError(message);
      showFeedback('error', message);
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <FeedbackToast feedback={feedback} onClose={closeFeedback} />

      <div className="divide-y divide-line rounded-card border border-line bg-surface">
        <section className={SECTION} aria-labelledby="account-summary-title">
          <h2 id="account-summary-title" className={SECTION_TITLE}>Your account</h2>
          <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-ink-muted">Name</dt>
              <dd className="mt-0.5 break-words font-medium text-ink">{fullName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-muted">Role</dt>
              <dd className="mt-0.5 break-words font-medium text-ink">{roleTitle}</dd>
            </div>
            {schoolId && (
              <div className="min-w-0">
                <dt className="text-xs text-ink-muted">School ID</dt>
                <dd className="mt-0.5 break-words font-medium text-ink">{schoolId}</dd>
              </div>
            )}
            {organizationName && (
              <div className="min-w-0">
                <dt className="text-xs text-ink-muted">{currentUser.organization?.organization_type === 'COLLEGE' ? 'College' : 'Organization'}</dt>
                <dd className="mt-0.5 break-words font-medium text-ink">{organizationName}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className={SECTION} aria-labelledby="personal-information-title">
          <h2 id="personal-information-title" className={SECTION_TITLE}>Personal information</h2>
          <form onSubmit={handleProfileSave} noValidate className="max-w-xl space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" required>
                <Input type="text" autoComplete="given-name" value={profileForm.first_name} onChange={(event) => setProfileForm({ ...profileForm, first_name: event.target.value })} />
              </Field>
              <Field label="Last name" required>
                <Input type="text" autoComplete="family-name" value={profileForm.last_name} onChange={(event) => setProfileForm({ ...profileForm, last_name: event.target.value })} />
              </Field>
            </div>
            <Field label="Email address" required hint="Used for account recovery and organization notifications.">
              <Input type="email" autoComplete="email" value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} />
            </Field>
            <Field label="Mobile number" optional>
              <Input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={profileForm.contact_number} onChange={(event) => setProfileForm({ ...profileForm, contact_number: event.target.value })} placeholder="e.g. 0917 123 4567" />
            </Field>
            {identityChanged && (
              <Field label="Confirm with your current password" hint="Needed to change your name or email.">
                <PasswordInput autoComplete="current-password" value={profileForm.current_password} onChange={(event) => setProfileForm({ ...profileForm, current_password: event.target.value })} visible={passwordVisibility.profile} onToggle={() => togglePasswordVisibility('profile')} toggleLabel={passwordVisibility.profile ? 'Hide password to confirm change' : 'Show password to confirm change'} />
              </Field>
            )}
            {profileError && <p role="alert" className="text-sm font-medium text-danger-strong">{profileError}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={resetProfileForm} disabled={!profileDirty || profileSaving}>Discard changes</Button>
              <Button type="submit" disabled={!profileDirty} loading={profileSaving}>Save profile</Button>
            </div>
          </form>
        </section>

        <section className={SECTION} aria-labelledby="password-security-title">
          <h2 id="password-security-title" className={SECTION_TITLE}>Password and security</h2>
          <form onSubmit={handlePasswordSave} noValidate className="max-w-xl space-y-4">
            <Field label="Current password">
              <PasswordInput autoComplete="current-password" value={pwForm.current_password} onChange={(event) => setPwForm({ ...pwForm, current_password: event.target.value })} visible={passwordVisibility.current} onToggle={() => togglePasswordVisibility('current')} toggleLabel={passwordVisibility.current ? 'Hide current password' : 'Show current password'} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password">
                <PasswordInput autoComplete="new-password" value={pwForm.password} onChange={(event) => setPwForm({ ...pwForm, password: event.target.value })} visible={passwordVisibility.next} onToggle={() => togglePasswordVisibility('next')} toggleLabel={passwordVisibility.next ? 'Hide new password' : 'Show new password'} />
              </Field>
              <Field label="Confirm new password">
                <PasswordInput autoComplete="new-password" value={pwForm.password_confirmation} onChange={(event) => setPwForm({ ...pwForm, password_confirmation: event.target.value })} visible={passwordVisibility.confirmation} onToggle={() => togglePasswordVisibility('confirmation')} toggleLabel={passwordVisibility.confirmation ? 'Hide password confirmation' : 'Show password confirmation'} />
              </Field>
            </div>

            <div className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-6">
              <span className={`flex items-center gap-2 ${passwordLongEnough ? 'text-success-strong' : 'text-ink-muted'}`}><CheckCircle2 size={15} aria-hidden="true" /> At least 8 characters</span>
              <span className={`flex items-center gap-2 ${passwordsMatch ? 'text-success-strong' : 'text-ink-muted'}`}><CheckCircle2 size={15} aria-hidden="true" /> New passwords match</span>
            </div>

            {pwError && <p role="alert" className="text-sm font-medium text-danger-strong">{pwError}</p>}

            <div className="space-y-2">
              <Button type="submit" variant="secondary" loading={pwSaving}>Update password</Button>
              <p className="text-xs text-ink-muted">Updating your password signs your other devices out. This one stays signed in.</p>
            </div>
          </form>
        </section>
      </div>

      <NotificationPreferences />

      <RecentActivity />
    </div>
  );
}
