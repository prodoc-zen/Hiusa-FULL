import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ShieldCheck, Users, Megaphone } from 'lucide-react';
import { getUsers } from '../../../services/userService';
import { ANNOUNCEMENTS_DATA } from '../../modules/announcements/announcementShared.jsx';

export default function AdminHomePage() {
  const [summary, setSummary] = useState({ users: 0, published: 0, drafts: 0 });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const users = await getUsers();
        if (!cancelled) {
          const announcementRows = Array.isArray(ANNOUNCEMENTS_DATA) ? ANNOUNCEMENTS_DATA : [];
          setSummary({
            users: Array.isArray(users) ? users.length : 0,
            published: announcementRows.filter((announcement) => announcement.status === 'Published').length,
            drafts: announcementRows.filter((announcement) => announcement.status === 'Draft').length,
          });
        }
      } catch {
        if (!cancelled) {
          setSummary({ users: 0, published: 0, drafts: 0 });
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Administrator</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Control Center</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Manage users, oversee elections, and enforce system governance.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Users', value: summary.users, icon: Users },
          { label: 'Published Announcements', value: summary.published, icon: Megaphone },
          { label: 'Draft Announcements', value: summary.drafts, icon: ShieldCheck },
          { label: 'System Notices', value: summary.published + summary.drafts, icon: Megaphone },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
              <item.icon size={20} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-[#0F172A]">Admin Quick Actions</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { label: 'Manage User Accounts', path: '/dashboard/admin/users' },
            { label: 'Manage Announcements', path: '/dashboard/announcements/manage-announcements' },
            { label: 'Create Announcement', path: '/dashboard/announcements/create-announcement' },
            { label: 'View Feed', path: '/dashboard/announcements/view-announcements' },
          ].map((action) => (
            <NavLink key={action.path} to={action.path} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-4 py-3 text-sm font-semibold text-[#0F172A] transition hover:border-[#0B8ED0]/40 hover:bg-white">
              {action.label}
            </NavLink>
          ))}
        </div>
      </section>
    </div>
  );
}
