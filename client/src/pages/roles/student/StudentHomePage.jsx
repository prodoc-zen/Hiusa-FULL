import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Vote, CalendarDays, Megaphone, Package, ArrowRight } from 'lucide-react';
import { getElections } from '../../../services/electionService';
import { getEvents } from '../../../services/eventService';
import { getAnnouncements } from '../../../services/announcementService';
import { getMerchandise } from '../../../services/merchandiseService';

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function fmtPrice(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ROLE_LABEL = { all: 'All Members', student: 'Students', officer: 'Officers', adviser: 'Advisers' };

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

        setData({
          elections: Array.isArray(electionsRes) ? electionsRes : (Array.isArray(electionsRes?.data) ? electionsRes.data : []),
          events: Array.isArray(eventsRes?.data) ? eventsRes.data : (Array.isArray(eventsRes) ? eventsRes : []),
          announcements: Array.isArray(announcementsRes?.data) ? announcementsRes.data : [],
          merchandise: Array.isArray(merchandiseRes?.data) ? merchandiseRes.data : (Array.isArray(merchandiseRes) ? merchandiseRes : []),
        });
      } catch {
        if (!cancelled) setData({ elections: [], events: [], announcements: [], merchandise: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const activeElection = data.elections.find((e) => e.status === 'active') || null;
  const upcomingEvents = data.events
    .filter((e) => e.status === 'upcoming' || e.status === 'approved')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 3);
  const latestAnnouncements = data.announcements.filter((a) => a.is_published).slice(0, 5);
  const availableMerch = data.merchandise.filter((m) => m.is_active && m.stock_quantity > 0).slice(0, 4);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Student Portal</p>
        <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Welcome to HIUSA</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Vote in active elections, browse events, read announcements, and order merchandise.</p>
      </section>

      {/* Active Election CTA */}
      {!loading && (
        activeElection ? (
          <section className="rounded-xl border border-[#0B8ED0]/25 bg-gradient-to-br from-[#E6F6FD] to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#0B8ED0] text-white">
                  <Vote size={22} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Active Election</p>
                  <h3 className="mt-1 text-lg font-black text-[#0F172A]">{activeElection.title}</h3>
                  <p className="mt-0.5 text-sm text-slate-500">Your vote matters. Cast it before the election closes.</p>
                </div>
              </div>
              <span className="mt-1 shrink-0 rounded-full bg-[#0B8ED0] px-3 py-1 text-[11px] font-black text-white">LIVE</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 sm:gap-4">
              <NavLink
                to="/dashboard/elections/cast-vote"
                className="flex items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#0878B7]"
              >
                Cast Vote <ArrowRight size={15} />
              </NavLink>
              <NavLink
                to="/dashboard/elections/election-results"
                className="rounded-lg border border-[#DDE7EF] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-[#F8FBFD]"
              >
                View Results
              </NavLink>
            </div>
          </section>
        ) : (
          <section className="flex items-center gap-4 rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-100 text-slate-400">
              <Vote size={20} />
            </div>
            <div>
              <p className="font-bold text-[#0F172A]">No Active Election</p>
              <p className="text-sm text-slate-400">There are no elections running right now.</p>
            </div>
            <NavLink to="/dashboard/elections" className="ml-auto text-xs font-bold text-[#0B8ED0] hover:underline">View Elections</NavLink>
          </section>
        )
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Upcoming Events */}
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
              <h3 className="text-base font-bold text-[#0F172A]">Upcoming Events</h3>
              <NavLink to="/dashboard/events" className="text-xs font-bold text-[#0B8ED0] hover:underline">View all</NavLink>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">{[...Array(3)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : upcomingEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No upcoming events.</p>
            ) : (
              <div className="divide-y divide-[#E5EDF3]">
                {upcomingEvents.map((ev) => (
                  <div key={ev.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                      <CalendarDays size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[#0F172A]">{ev.title}</p>
                      <p className="text-xs text-slate-400">{formatDate(ev.start_time)}{ev.location ? ` · ${ev.location}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Announcements Feed */}
          <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
              <h3 className="text-base font-bold text-[#0F172A]">Announcements</h3>
              <NavLink to="/dashboard/announcements/view-announcements" className="text-xs font-bold text-[#0B8ED0] hover:underline">View all</NavLink>
            </div>
            {loading ? (
              <div className="space-y-2 p-5">{[...Array(3)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : latestAnnouncements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No announcements yet.</p>
            ) : (
              <div className="divide-y divide-[#E5EDF3]">
                {latestAnnouncements.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]">
                      <Megaphone size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-semibold text-[#0F172A]">{a.title}</p>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 capitalize">
                          {ROLE_LABEL[a.target_role] || a.target_role}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{a.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Merchandise Grid */}
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm h-fit">
          <div className="flex items-center justify-between border-b border-[#DDE7EF] px-5 py-4">
            <h3 className="text-base font-bold text-[#0F172A]">Available Merchandise</h3>
            <NavLink to="/dashboard/merchandise" className="text-xs font-bold text-[#0B8ED0] hover:underline">Shop</NavLink>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 gap-3 p-5">
              {[...Array(4)].map((_, i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : availableMerch.length === 0 ? (
            <div className="py-10 text-center">
              <Package size={32} className="mx-auto mb-2 text-slate-200" />
              <p className="text-sm text-slate-400">No merchandise available.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-5">
              {availableMerch.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3">
                  <div className="mb-2 h-12 w-full overflow-hidden rounded-md bg-[#E6F6FD]">
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                      : <div className="grid h-full w-full place-items-center"><Package size={22} className="text-[#0B8ED0]" /></div>
                    }
                  </div>
                  <p className="truncate text-[13px] font-bold text-[#0F172A]">{item.name}</p>
                  <p className="text-xs font-semibold text-[#0B8ED0]">{fmtPrice(item.price)}</p>
                  <p className="text-[11px] text-slate-400">{item.stock_quantity} left</p>
                </div>
              ))}
            </div>
          )}
          {!loading && availableMerch.length > 0 && (
            <div className="border-t border-[#DDE7EF] p-3">
              <NavLink
                to="/dashboard/merchandise"
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] text-xs font-bold text-white transition hover:bg-[#0878B7]"
              >
                Browse All Items <ArrowRight size={13} />
              </NavLink>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
