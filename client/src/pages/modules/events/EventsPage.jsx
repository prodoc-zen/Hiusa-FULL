import { useEffect, useState } from 'react';
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
import { getEvents, createEvent } from '../../../services/eventService';
import { getTasks } from '../../../services/taskService';
import PaginationControls from '../../../components/PaginationControls';

const statusBadge = {
  upcoming: 'bg-[#E6F6FD] text-[#0B8ED0]',
  approved: 'bg-[#E6F6FD] text-[#0B8ED0]',
  ongoing: 'bg-violet-50 text-violet-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

const taskStatusBadge = {
  pending: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-[#E6F6FD] text-[#0B8ED0]',
  completed: 'bg-emerald-50 text-emerald-700',
  overdue: 'bg-red-50 text-red-700',
};

function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function capitalize(s) {
  return s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '-';
}

export default function EventsPage({ initialTab = 'events' }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [eventsPage, setEventsPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);
  const pageSize = 10;

  const [form, setForm] = useState({ title: '', date: '', startTime: '', endDate: '', endTime: '', location: '', description: '' });
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([getEvents(), getTasks()])
      .then(([evRes, taskRes]) => {
        setEvents(Array.isArray(evRes.data) ? evRes.data : []);
        setTasks(Array.isArray(taskRes.data) ? taskRes.data : []);
      })
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  async function handleCreateEvent(e) {
    e.preventDefault();
    if (!form.title || !form.date || !form.startTime) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      const start_time = `${form.date}T${form.startTime}:00`;
      const end_time = form.endDate && form.endTime ? `${form.endDate}T${form.endTime}:00` : start_time;
      if (end_time <= start_time) {
        setFormError('End date/time must be after start date/time.');
        setFormSubmitting(false);
        return;
      }
      await createEvent({ title: form.title, start_time, end_time, location: form.location, description: form.description, status: 'upcoming' });
      setShowForm(false);
      setForm({ title: '', date: '', startTime: '', endDate: '', endTime: '', location: '', description: '' });
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to create event.');
    } finally {
      setFormSubmitting(false);
    }
  }

  const upcoming = events.filter((e) => ['upcoming', 'approved'].includes(e.status)).length;
  const completed = events.filter((e) => e.status === 'completed').length;

  const filteredEvents = events.filter((e) =>
    e.title?.toLowerCase().includes(search.toLowerCase())
  );
  const eventLinkedTasks = tasks.filter((t) => t.event_id);
  const pagedEvents = filteredEvents.slice((eventsPage - 1) * pageSize, eventsPage * pageSize);
  const pagedEventTasks = eventLinkedTasks.slice((tasksPage - 1) * pageSize, tasksPage * pageSize);

  const completedEvents = events.filter((e) => e.status === 'completed');

  useEffect(() => {
    setEventsPage(1);
  }, [search, events.length]);

  useEffect(() => {
    setTasksPage(1);
  }, [tasks.length]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Events', value: events.length, helper: 'This academic year', icon: Calendar },
          { label: 'Upcoming', value: upcoming, helper: 'Scheduled', icon: Clock },
          { label: 'Completed', value: completed, helper: 'Successfully held', icon: CheckCircle2 },
          { label: 'Total Tasks', value: tasks.length, helper: 'Across all events', icon: Users },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

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
            {tab === 'tasks' ? 'Assign Tasks' : tab === 'attendance' ? 'Track Attendance' : 'Events'}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'events' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">All Events</h2>
              <p className="text-sm font-medium text-slate-500">Create, manage, and monitor events</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="Search events..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]"
                />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Create Event</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : filteredEvents.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No events found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] md:min-w-[700px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-5 py-3">Start Time</th>
                    <th className="hidden md:table-cell px-5 py-3">Location</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {pagedEvents.map((evt) => (
                    <tr key={evt.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{evt.title}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-slate-400" />
                          {formatDateTime(evt.start_time)}
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-5 py-4 font-medium text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={13} className="text-slate-400" />
                          {evt.location || '-'}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[evt.status] || 'bg-slate-100 text-slate-500'}`}>
                          {capitalize(evt.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PaginationControls
            currentPage={eventsPage}
            totalItems={filteredEvents.length}
            pageSize={pageSize}
            onPageChange={setEventsPage}
            label="events"
          />
        </section>
      )}

      {activeTab === 'tasks' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Event Task Assignments</h2>
            <p className="text-sm font-medium text-slate-500">Tasks linked to events</p>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : eventLinkedTasks.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No event-linked tasks yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Task</th>
                    <th className="px-5 py-3">Assigned To</th>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-5 py-3">Deadline</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {pagedEventTasks.map((t) => (
                    <tr key={t.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{t.title}</td>
                      <td className="px-5 py-4 font-medium text-slate-600">
                        {t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '-'}
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-600">
                        {t.event?.title ?? '-'}
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-600">{t.deadline ?? '-'}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${taskStatusBadge[t.status] || 'bg-slate-100 text-slate-500'}`}>
                          {capitalize(t.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PaginationControls
            currentPage={tasksPage}
            totalItems={eventLinkedTasks.length}
            pageSize={pageSize}
            onPageChange={setTasksPage}
            label="tasks"
          />
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            [1, 2, 3].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-slate-100" />)
          ) : completedEvents.length === 0 ? (
            <div className="col-span-3 rounded-xl border border-[#DDE7EF] bg-white p-10 text-center">
              <p className="text-sm text-slate-400">No completed events yet.</p>
            </div>
          ) : (
            completedEvents.map((evt) => (
              <div key={evt.id} className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm hover:shadow-md transition">
                <div className="mb-3 flex items-center justify-between">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Completed</span>
                  <span className="text-xs font-medium text-slate-400">{formatDateTime(evt.start_time)}</span>
                </div>
                <h3 className="text-base font-bold text-[#0F172A]">{evt.title}</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">{evt.location || 'No location set'}</p>
              </div>
            ))
          )}
        </section>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Create Event</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleCreateEvent}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Event Name *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Annual General Assembly"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Start Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Start Time *</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">End Time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Main Auditorium"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !form.title || !form.date || !form.startTime}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {formSubmitting ? 'Creating...' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
