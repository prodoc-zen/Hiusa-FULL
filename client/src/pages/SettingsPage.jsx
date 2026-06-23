import { useState } from 'react';
import {
  Bell,
  Camera,
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

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('profile');
  const [showPassword, setShowPassword] = useState(false);

  const sections = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'organization', label: 'Organization', icon: Globe },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'preferences', label: 'Preferences', icon: Bell },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
      {/* Settings nav */}
      <nav className="rounded-xl border border-[#DDE7EF] bg-white p-3 shadow-sm h-fit">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Settings</p>
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-[13px] font-semibold transition ${
                activeSection === section.key
                  ? 'bg-[#E6F6FD] text-[#0B8ED0]'
                  : 'text-slate-600 hover:bg-[#F8FBFD]'
              }`}
            >
              <div className="flex items-center gap-3">
                <section.icon size={17} />
                {section.label}
              </div>
              <ChevronRight size={14} className={activeSection === section.key ? 'text-[#0B8ED0]' : 'text-slate-300'} />
            </button>
          ))}
        </div>
      </nav>

      {/* Settings content */}
      <div className="space-y-6">
        {/* Profile */}
        {activeSection === 'profile' && (
          <section className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A] mb-6">Officer Profile</h2>

            {/* Avatar */}
            <div className="flex items-center gap-5 mb-6">
              <div className="relative">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xl font-black text-white">
                  JC
                </div>
                <button className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-white border-2 border-[#DDE7EF] text-slate-500 hover:text-[#0B8ED0] transition shadow-sm">
                  <Camera size={14} />
                </button>
              </div>
              <div>
                <p className="text-base font-bold text-[#0F172A]">John Carlo</p>
                <p className="text-sm font-medium text-slate-500">President · HIUSA</p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Full Name</label>
                  <input type="text" defaultValue="John Carlo" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Email</label>
                  <input type="email" defaultValue="john.carlo@hiusa.edu" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Student ID</label>
                  <input type="text" defaultValue="STU-2026-001" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm bg-[#F8FBFD] outline-none" disabled />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Role</label>
                  <input type="text" defaultValue="President" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm bg-[#F8FBFD] outline-none" disabled />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Bio</label>
                <textarea rows={3} defaultValue="Student council president focused on transparency and digital innovation." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="flex justify-end pt-2">
                <button type="submit" className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  <Save size={15} />
                  Save Changes
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Organization */}
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
                  <input type="text" defaultValue="University of Example" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button type="submit" className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  <Save size={15} />
                  Save Changes
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Security */}
        {activeSection === 'security' && (
          <section className="space-y-6">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#0F172A] mb-6">Change Password</h2>
              <form className="space-y-4 max-w-md" onSubmit={(e) => e.preventDefault()}>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Current Password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Lock size={16} /></div>
                    <input type={showPassword ? 'text' : 'password'} placeholder="••••••••" className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 pr-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-[#0B8ED0]">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">New Password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Key size={16} /></div>
                    <input type="password" placeholder="••••••••" className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Confirm New Password</label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400"><Key size={16} /></div>
                    <input type="password" placeholder="••••••••" className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-10 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
                  </div>
                </div>
                <button type="submit" className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">
                  <Lock size={15} />
                  Update Password
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

        {/* Preferences */}
        {activeSection === 'preferences' && (
          <section className="space-y-6">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#0F172A] mb-4">Notification Preferences</h2>
              <div className="space-y-3">
                {[
                  { label: 'Election updates', desc: 'Get notified about voting periods and results' },
                  { label: 'Task assignments', desc: 'New tasks assigned to you or your team' },
                  { label: 'Event reminders', desc: 'Upcoming events and attendance alerts' },
                  { label: 'Financial alerts', desc: 'Budget warnings and transaction notifications' },
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
                  <Sun size={18} />
                  Light
                </button>
                <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white p-4 text-sm font-bold text-slate-500 hover:bg-[#F8FBFD] transition">
                  <Moon size={18} />
                  Dark
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
