import { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  MapPin,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';

const stats = [
  { label: 'Total Events', value: '24', helper: 'This academic year', icon: Calendar },
  { label: 'Upcoming', value: '5', helper: 'Next 30 days', icon: Clock },
  { label: 'Completed', value: '18', helper: 'Successfully held', icon: CheckCircle2 },
  { label: 'Avg. Attendance', value: '87%', helper: 'Across all events', icon: Users },
];

const events = [
  { name: 'Annual General Assembly', date: '2026-07-15', time: '9:00 AM', location: 'Main Auditorium', status: 'Upcoming', attendance: '—', budget: '₱45,000' },
  { name: 'Leadership Summit 2026', date: '2026-07-22', time: '1:00 PM', location: 'Conference Hall B', status: 'Upcoming', attendance: '—', budget: '₱32,000' },
  { name: 'Freshmen Orientation', date: '2026-06-20', time: '8:00 AM', location: 'Gymnasium', status: 'Completed', attendance: '452/500', budget: '₱28,000' },
  { name: 'Cultural Night', date: '2026-06-10', time: '6:00 PM', location: 'Open Grounds', status: 'Completed', attendance: '380/400', budget: '₱55,000' },
  { name: 'Officer Training Workshop', date: '2026-06-05', time: '10:00 AM', location: 'Room 301', status: 'Completed', attendance: '28/30', budget: '₱8,500' },
];

const statusBadge = {
  Upcoming: 'bg-[#E6F6FD] text-[#0B8ED0]',
  Completed: 'bg-emerald-50 text-emerald-700',
  Cancelled: 'bg-red-50 text-red-700',
};

const taskAssignments = [
  { task: 'Prepare venue layout', officer: 'Maria Santos', event: 'Annual General Assembly', status: 'In Progress' },
  { task: 'Send invitations', officer: 'Daniel Reyes', event: 'Leadership Summit', status: 'Completed' },
  { task: 'Order catering', officer: 'Alyssa Mariano', event: 'Annual General Assembly', status: 'Pending' },
  { task: 'Set up sound system', officer: 'Carlo Lim', event: 'Annual General Assembly', status: 'Not Started' },
];

const taskStatusBadge = {
  Completed: 'bg-emerald-50 text-emerald-700',
  'In Progress': 'bg-[#E6F6FD] text-[#0B8ED0]',
  Pending: 'bg-amber-50 text-amber-700',
  'Not Started': 'bg-slate-100 text-slate-500',
};

export default function EventsPage() {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState('events');

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 flex items-center justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition">
                <stat.icon size={19} />
              </div>
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      {/* Tab nav */}
      <div className="flex flex-wrap gap-2">
        {['events', 'tasks', 'attendance'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            {tab === 'tasks' ? 'Assign Tasks' : tab === 'attendance' ? 'Track Attendance' : tab}
          </button>
        ))}
      </div>

      {/* Events list */}
      {activeTab === 'events' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">All Events</h2>
              <p className="text-sm font-medium text-slate-500">Create, manage, and monitor events</p>
            </div>
            <div className="flex gap-2">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                <Search size={15} className="text-slate-400" />
                <input type="text" placeholder="Search events..." className="w-[140px] bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
              </div>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]">
                <Filter size={16} />
              </button>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Create Event</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3">Budget</th>
                  <th className="px-5 py-3">Attendance</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {events.map((evt) => (
                  <tr key={evt.name} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-5 py-4 font-bold text-[#0F172A]">{evt.name}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Clock size={13} className="text-slate-400" />
                        {evt.date} · {evt.time}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <MapPin size={13} className="text-slate-400" />
                        {evt.location}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-bold text-[#0F172A]">{evt.budget}</td>
                    <td className="px-5 py-4 font-semibold text-slate-600">{evt.attendance}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[evt.status]}`}>{evt.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Assign tasks tab */}
      {activeTab === 'tasks' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Event Task Assignments</h2>
            <p className="text-sm font-medium text-slate-500">Assign and track tasks for upcoming events</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Task</th>
                  <th className="px-5 py-3">Assigned To</th>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {taskAssignments.map((t, i) => (
                  <tr key={i} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-5 py-4 font-bold text-[#0F172A]">{t.task}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">{t.officer}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">{t.event}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${taskStatusBadge[t.status]}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Track attendance tab */}
      {activeTab === 'attendance' && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {events.filter(e => e.status === 'Completed').map((evt) => (
            <div key={evt.name} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm hover:shadow-md transition">
              <div className="mb-3 flex items-center justify-between">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[evt.status]}`}>{evt.status}</span>
                <span className="text-xs font-medium text-slate-400">{evt.date}</span>
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">{evt.name}</h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{evt.location}</p>
              <div className="mt-4 flex items-center gap-3">
                <Users size={16} className="text-[#0B8ED0]" />
                <div className="flex-1">
                  <div className="h-2.5 rounded-full bg-[#EEF6FB] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3]" style={{ width: evt.attendance.includes('/') ? `${(parseInt(evt.attendance) / parseInt(evt.attendance.split('/')[1])) * 100}%` : '0%' }} />
                  </div>
                </div>
                <span className="text-sm font-bold text-[#0F172A]">{evt.attendance}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Create Event Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Create Event</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Event Name</label>
                <input type="text" placeholder="e.g. Annual General Assembly" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Date</label>
                  <input type="date" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Time</label>
                  <input type="time" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Location</label>
                <input type="text" placeholder="e.g. Main Auditorium" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Budget (₱)</label>
                  <input type="number" placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Capacity</label>
                  <input type="number" placeholder="e.g. 500" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea rows={3} placeholder="Brief description of the event..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">Create Event</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
