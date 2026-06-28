import { useEffect, useState } from 'react';
import {
  Bell,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  Key,
  Lock,
  Moon,
  Save,
  Shield,
  Sun,
  User,
} from 'lucide-react';
import { updateProfile, updatePassword } from '../../../services/profileService';

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user')) || {};
  } catch {
    return {};
  }
}

export default function SettingsPage({ initialSection = 'profile' }) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [showPassword, setShowPassword] = useState(false);
  const storedUser = getStoredUser();

  const [profileForm, setProfileForm] = useState({
    first_name: storedUser.first_name || '',
    last_name: storedUser.last_name || '',
    email: storedUser.email || '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState(null);

  const [pwForm, setPwForm] = useState({ current_password: '', password: '', password_confirmation: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState(null);

  const initials = [storedUser.first_name?.[0], storedUser.last_name?.[0]].filter(Boolean).join('').toUpperCase() || 'U';

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileError(null);
    setProfileSuccess(false);
    try {
      const res = await updateProfile(profileForm);
      localStorage.setItem('user', JSON.stringify({ ...storedUser, ...res.data }));
      setProfileSuccess(true);
    } catch (err) {
      setProfileError(err.response?.data?.message ?? 'Failed to save profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSave(e) {
    e.preventDefault();
    if (pwForm.password !== pwForm.password_confirmation) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwSaving(true);
    setPwError(null);
    setPwSuccess(false);
    try {
      await updatePassword(pwForm);
      setPwForm({ current_password: '', password: '', password_confirmation: '' });
      setPwSuccess(true);
    } catch (err) {
      setPwError(err.response?.data?.message ?? 'Failed to update password.');
    } finally {
      setPwSaving(false);
    }
  }

  const sections = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'organization', label: 'Organization', icon: Globe },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'preferences', label: 'Preferences', icon: Bell },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
      <nav className="rounded-xl border border-[#DDE7EF] bg-white p-3 shadow-sm h-fit">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Settings</p>
        <div className="space-y-1">
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-[13px] font-semibold transition ${
                activeSection === s.key ? 'bg-[#E6F6FD] text-[#0B8ED0]' : 'text-slate-600 hover:bg-[#F8FBFD]'
              }`}
            >
              <div className="flex items-center gap-3">
                <s.icon size={17} />
                {s.label}
              </div>
              <ChevronRight size={14} className={activeSection === s.key ? 'text-[#0B8ED0]' : 'text-slate-300'} />
            </button>
          ))}
        </div>
      </nav>

      <div className="space-y-6">
        {activeSection === 'profile' && (
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A] mb-6">Your Profile</h2>
            <div className="flex items-center gap-5 mb-6">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xl font-black text-white">
                {initials}
              </div>
              <div>
                <p className="text-base font-bold text-[#0F172A]">{storedUser.first_name} {storedUser.last_name}</p>
                <p className="text-sm font-medium text-slate-500 capitalize">{storedUser.role} · HIUSA</p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleProfileSave}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">First Name</label>
                  <input
                    type="text"
                    value={profileForm.first_name}
                    onChange={(e) => setProfileForm({ ...profileForm, first_name: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Last Name</label>
                  <input
                    type="text"
                    value={profileForm.last_name}
                    onChange={(e) => setProfileForm({ ...profileForm, last_name: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Email</label>
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Student ID</label>
                  <input type="text" value={storedUser.school_id || ''} disabled className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm bg-[#F8FBFD] outline-none text-slate-400" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Role</label>
                  <input type="text" value={storedUser.role || ''} disabled className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm bg-[#F8FBFD] outline-none capitalize text-slate-400" />
                </div>
              </div>
              {profileError && <p className="text-xs text-red-600">{profileError}</p>}
              {profileSuccess && <p className="text-xs font-semibold text-emerald-600">Profile updated successfully.</p>}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  <Save size={15} />
                  {profileSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeSection === 'organization' && (
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A] mb-6">Organization Profile</h2>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Organization Name</label>
                <input type="text" defaultValue="HIUSA" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea rows={3} defaultValue="Official student council organization managing student governance, events, elections, and services." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Academic Year</label>
                  <input type="text" defaultValue="2025-2026" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">School</label>
                  <input type="text" defaultValue="University" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button type="submit" className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  <Save size={15} /> Save Changes
                </button>
              </div>
            </form>
          </section>
        )}

        {activeSection === 'security' && (
          <section className="space-y-6">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#0F172A] mb-6">Change Password</h2>
              <form className="space-y-4 max-w-md" onSubmit={handlePasswordSave}>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Current Password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Lock size={16} /></div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={pwForm.current_password}
                      onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
                      placeholder="••••••••"
                      className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 pr-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-[#0B8ED0]">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">New Password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Key size={16} /></div>
                    <input
                      type="password"
                      value={pwForm.password}
                      onChange={(e) => setPwForm({ ...pwForm, password: e.target.value })}
                      placeholder="••••••••"
                      className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Confirm New Password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Key size={16} /></div>
                    <input
                      type="password"
                      value={pwForm.password_confirmation}
                      onChange={(e) => setPwForm({ ...pwForm, password_confirmation: e.target.value })}
                      placeholder="••••••••"
                      className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                    />
                  </div>
                </div>
                {pwError && <p className="text-xs text-red-600">{pwError}</p>}
                {pwSuccess && <p className="text-xs font-semibold text-emerald-600">Password updated successfully.</p>}
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  <Lock size={15} />
                  {pwSaving ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#0F172A] mb-4">Two-Factor Authentication</h2>
              <div className="flex items-center justify-between rounded-lg bg-[#F8FBFD] p-4">
                <div className="flex items-center gap-3">
                  <Shield size={20} className="text-[#0B8ED0]" />
                  <div>
                    <p className="text-sm font-bold text-[#0F172A]">Two-Factor Authentication</p>
                    <p className="text-xs font-medium text-slate-500">Add an extra layer of security</p>
                  </div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="h-6 w-11 rounded-full bg-slate-200 peer-checked:bg-[#0B8ED0] after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full after:shadow-sm" />
                </label>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'preferences' && (
          <section className="space-y-6">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#0F172A] mb-4">Notification Preferences</h2>
              <div className="space-y-3">
                {[
                  { label: 'Election updates', desc: 'Get notified about voting periods and results' },
                  { label: 'Task assignments', desc: 'New tasks assigned to you or your team' },
                  { label: 'Event reminders', desc: 'Upcoming events and attendance alerts' },
                  { label: 'Announcements', desc: 'New posts and important updates' },
                ].map((pref) => (
                  <div key={pref.label} className="flex items-center justify-between rounded-lg bg-[#F8FBFD] p-4">
                    <div>
                      <p className="text-sm font-bold text-[#0F172A]">{pref.label}</p>
                      <p className="text-xs font-medium text-slate-500">{pref.desc}</p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input type="checkbox" defaultChecked className="sr-only peer" />
                      <div className="h-6 w-11 rounded-full bg-slate-200 peer-checked:bg-[#0B8ED0] after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full after:shadow-sm" />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#0F172A] mb-4">Appearance</h2>
              <div className="flex gap-3">
                <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-[#0B8ED0] bg-[#E6F6FD] p-4 text-sm font-bold text-[#0B8ED0]">
                  <Sun size={18} /> Light
                </button>
                <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white p-4 text-sm font-bold text-slate-500 hover:bg-[#F8FBFD] transition">
                  <Moon size={18} /> Dark
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
