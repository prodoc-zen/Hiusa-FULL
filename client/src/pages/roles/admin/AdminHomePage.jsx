import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ShieldCheck, Users, Megaphone, FileText, GraduationCap, UserCheck, Briefcase } from 'lucide-react';
import { getUsers } from '../../../services/userService';
import { getAnnouncements } from '../../../services/announcementService';

const ROLE_CONFIG = [
  { key: 'student',  label: 'Students',  icon: GraduationCap, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'officer',  label: 'Officers',  icon: Briefcase,     color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'adviser',  label: 'Advisers',  icon: UserCheck,     color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'admin',    label: 'Admins',    icon: ShieldCheck,   color: 'bg-red-50 text-red-700 border-red-200' },
];

export default function AdminHomePage() {
  const [users, setUsers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [usersRes, announcementsRes] = await Promise.all([
          getUsers(),
          getAnnouncements(),
        ]);

        if (cancelled) return;

        setUsers(Array.isArray(usersRes) ? usersRes : (Array.isArray(usersRes?.data) ? usersRes.data : []));
        setAnnouncements(Array.isArray(announcementsRes?.data) ? announcementsRes.data : []);
      } catch {
        if (!cancelled) { setUsers([]); setAnnouncements([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const countByRole = (role) => users.filter((u) => u.role === role).length;
  const published = announcements.filter((a) => a.is_published).length;
  const drafts = announcements.filter((a) => !a.is_published).length;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Administrator</p>
        <h2 className="mt-1 text-2xl sm:text-3xl font-black text-[#0F172A]">Control Center</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Manage users, oversee elections, and enforce system governance.</p>
      </section>

      {/* User counts by role */}
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#0F172A]">Users by Role</h3>
            <p className="text-xs font-medium text-slate-400">{users.length} total accounts</p>
          </div>
          <NavLink to="/dashboard/admin/users" className="text-xs font-bold text-[#0B8ED0] hover:underline">Manage Users</NavLink>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ROLE_CONFIG.map((rc) => {
            const count = loading ? '-' : countByRole(rc.key);
            const Icon = rc.icon;
            return (
              <div key={rc.key} className={`flex items-center gap-3 rounded-lg border p-3.5 ${rc.color}`}>
                <Icon size={18} className="shrink-0" />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{rc.label}</p>
                  <p className="text-xl font-black tabular-nums">{count}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Announcement summary */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Published Announcements', value: loading ? '-' : published, icon: Megaphone, color: 'bg-[#E6F6FD] text-[#0B8ED0]' },
          { label: 'Draft Announcements', value: loading ? '-' : drafts, icon: FileText, color: 'bg-amber-50 text-amber-700' },
          { label: 'Total Announcements', value: loading ? '-' : published + drafts, icon: ShieldCheck, color: 'bg-[#E6F6FD] text-[#0B8ED0]' },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className={`mb-4 grid h-11 w-11 place-items-center rounded-lg ${item.color}`}>
              <item.icon size={20} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A] tabular-nums">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold text-[#0F172A] mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { label: 'Manage User Accounts', path: '/dashboard/admin/users' },
            { label: 'Manage Announcements', path: '/dashboard/announcements/manage-announcements' },
            { label: 'Create Announcement', path: '/dashboard/announcements/create-announcement' },
            { label: 'View Feed', path: '/dashboard/announcements/view-announcements' },
          ].map((action) => (
            <NavLink
              key={action.path}
              to={action.path}
              className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-sm font-semibold text-[#0F172A] transition hover:border-[#0B8ED0]/40 hover:bg-white"
            >
              {action.label}
            </NavLink>
          ))}
        </div>
      </section>
    </div>
  );
}
