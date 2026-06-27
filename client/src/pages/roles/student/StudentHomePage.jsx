import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Vote, CalendarDays, Megaphone, Package } from 'lucide-react';
import { getElections } from '../../../services/electionService';
import { getEvents } from '../../../services/eventService';
import { getAnnouncements } from '../../../services/announcementService';
import { getMerchandise } from '../../../services/merchandiseService';

export default function StudentHomePage() {
  const [data, setData] = useState({ elections: [], events: [], announcements: [], merchandise: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [electionsRes, eventsRes, announcementsRes, merchandiseRes] = await Promise.all([
          getElections(),
          getEvents(),
          getAnnouncements(),
          getMerchandise(),
        ]);

        if (cancelled) return;

        const elections = Array.isArray(electionsRes) ? electionsRes : (Array.isArray(electionsRes?.data) ? electionsRes.data : []);
        const events = Array.isArray(eventsRes?.data) ? eventsRes.data : (Array.isArray(eventsRes) ? eventsRes : []);
        const announcements = Array.isArray(announcementsRes?.data) ? announcementsRes.data : [];
        const merchandise = Array.isArray(merchandiseRes?.data) ? merchandiseRes.data : (Array.isArray(merchandiseRes) ? merchandiseRes : []);

        setData({ elections, events, announcements, merchandise });
      } catch {
        if (!cancelled) setData({ elections: [], events: [], announcements: [], merchandise: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const activeElections = data.elections.filter((e) => e.status === 'active').length;
  const upcomingEvents = data.events.filter((e) => e.status === 'upcoming' || e.status === 'approved').length;
  const publishedAnnouncements = data.announcements.filter((a) => a.is_published).length;
  const availableMerch = data.merchandise.filter((m) => m.is_active && m.stock_quantity > 0).length;

  const stat = (val) => loading ? '—' : val;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Student Portal</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Welcome to HIUSA</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Vote in active elections, browse events, read announcements, and order merchandise.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active Elections', value: stat(activeElections), icon: Vote },
          { label: 'Upcoming Events', value: stat(upcomingEvents), icon: CalendarDays },
          { label: 'Announcements', value: stat(publishedAnnouncements), icon: Megaphone },
          { label: 'Available Merch', value: stat(availableMerch), icon: Package },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
              <item.icon size={20} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A] tabular-nums">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[#0F172A]">Quick Actions</h3>
            <p className="text-sm text-slate-500">Navigate to key sections.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <NavLink to="/dashboard/elections" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
              Election List
            </NavLink>
            <NavLink to="/dashboard/events" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
              Events
            </NavLink>
            <NavLink to="/dashboard/announcements/view-announcements" className="rounded-lg border border-[#DDE7EF] px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-[#F8FBFD]">
              Announcements
            </NavLink>
            <NavLink to="/dashboard/merchandise" className="rounded-lg bg-[#0B8ED0] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0878B7]">
              Shop Merch
            </NavLink>
          </div>
        </div>
      </section>
    </div>
  );
}
