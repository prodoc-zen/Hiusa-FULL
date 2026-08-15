import { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Eye,
  MapPin,
  Pencil,
  Plus,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { getEvents, getEvent, createEvent, updateEvent, generateEventPlan, getAttendance, recordAttendance } from '../../../services/eventService';
import { getTasks } from '../../../services/taskService';
import { getUsers } from '../../../services/userService';
import PaginationControls from '../../../components/PaginationControls';

const statusBadge = {
  planning: 'bg-amber-50 text-amber-700',
  upcoming: 'bg-[#E6F6FD] text-[#0B8ED0]',
  approved: 'bg-[#E6F6FD] text-[#0B8ED0]',
  ongoing: 'bg-violet-50 text-violet-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

const statusLabel = {
  planning: 'Pending Approval',
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
  const [dateFilter, setDateFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventsPage, setEventsPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);
  const pageSize = 10;

  const [form, setForm] = useState({ title: '', date: '', startTime: '', endDate: '', endTime: '', location: '', description: '', requires_budget: false, budget_notes: '', vendor_deadlines: '', logistics_checklist: '' });
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [planForm, setPlanForm] = useState({ event_id: '', requirements: '', create_workflow: true });
  const [planResult, setPlanResult] = useState('');
  const [planError, setPlanError] = useState(null);
  const [planSubmitting, setPlanSubmitting] = useState(false);

  const [selectedAttEventId, setSelectedAttEventId] = useState(null);
  const [attendanceData, setAttendanceData] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [checkInSearch, setCheckInSearch] = useState('');
  const [checkInUserId, setCheckInUserId] = useState(null);
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [checkInError, setCheckInError] = useState(null);
  const [checkInSuccess, setCheckInSuccess] = useState(null);

  let currentUser = {};
  try { currentUser = JSON.parse(localStorage.getItem('user') ?? '{}') ?? {}; } catch {}
  const currentUserRole = currentUser?.role ?? '';
  const canCreateEvents = currentUserRole === 'ADMIN';
  const canManageAttendance = currentUserRole === 'ADMIN' || currentUserRole === 'SBO_OFFICER';

  function load() {
    setLoading(true);
    setError(null);
    const canLoadTasks = currentUserRole === 'ADMIN' || currentUserRole === 'SBO_OFFICER';
    const requests = canLoadTasks ? [getEvents(), getTasks()] : [getEvents(), Promise.resolve({ data: [] })];
    Promise.all(requests)
      .then(([evRes, taskRes]) => {
        setEvents(Array.isArray(evRes.data) ? evRes.data : []);
        setTasks(Array.isArray(taskRes.data) ? taskRes.data : []);
      })
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [currentUserRole]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === 'attendance' && canManageAttendance && !usersLoaded) {
      getUsers()
        .then((data) => {
          setAllUsers(Array.isArray(data) ? data : []);
          setUsersLoaded(true);
        })
        .catch(() => {});
    }
  }, [activeTab, canManageAttendance, usersLoaded]);

  async function handleSelectAttEvent(id) {
    setSelectedAttEventId(id);
    setAttendanceData(null);
    setAttendanceLoading(true);
    setCheckInSearch('');
    setCheckInUserId(null);
    setCheckInError(null);
    setCheckInSuccess(null);
    try {
      const res = await getAttendance(id);
      setAttendanceData(res.data);
    } catch {
      setAttendanceData(null);
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function handleCheckIn() {
    if (canManageAttendance && !checkInUserId) return;
    setCheckInSubmitting(true);
    setCheckInError(null);
    setCheckInSuccess(null);
    try {
      await recordAttendance(selectedAttEventId, { user_id: canManageAttendance ? checkInUserId : currentUser.id, method: 'manual' });
      setCheckInUserId(null);
      setCheckInSearch('');
      setCheckInSuccess('Check-in recorded.');
      const res = await getAttendance(selectedAttEventId);
      setAttendanceData(res.data);
    } catch (err) {
      setCheckInError(err.response?.data?.message ?? 'Failed to record check-in.');
    } finally {
      setCheckInSubmitting(false);
    }
  }

  async function handleSaveEvent(e) {
    e.preventDefault();
    if (!form.title || !form.date || !form.startTime || !form.endDate || !form.endTime) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      const start_time = `${form.date}T${form.startTime}:00`;
      const end_time = `${form.endDate}T${form.endTime}:00`;
      if (end_time && end_time <= start_time) {
        setFormError('End date/time must be after start date/time.');
        setFormSubmitting(false);
        return;
      }
      const payload = {
        title: form.title,
        start_time,
        end_time,
        location: form.location,
        description: form.description,
        requires_budget: form.requires_budget,
        planning_details: {
          budget_notes: form.budget_notes,
          vendor_deadlines: form.vendor_deadlines,
          logistics_checklist: form.logistics_checklist,
        },
      };

      if (editingEventId) {
        await updateEvent(editingEventId, payload);
      } else {
        await createEvent(payload);
      }
      setShowForm(false);
      setEditingEventId(null);
      setForm({ title: '', date: '', startTime: '', endDate: '', endTime: '', location: '', description: '', requires_budget: false, budget_notes: '', vendor_deadlines: '', logistics_checklist: '' });
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? `Failed to ${editingEventId ? 'update' : 'create'} event.`);
    } finally {
      setFormSubmitting(false);
    }
  }

  function openCreateForm() {
    setEditingEventId(null);
    setForm({ title: '', date: '', startTime: '', endDate: '', endTime: '', location: '', description: '', requires_budget: false, budget_notes: '', vendor_deadlines: '', logistics_checklist: '' });
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(event) {
    const planning = event.planning_details || {};
    setEditingEventId(event.id);
    setForm({
      title: event.title || '',
      date: String(event.start_time || '').slice(0, 10),
      startTime: String(event.start_time || '').slice(11, 16),
      endDate: String(event.end_time || '').slice(0, 10),
      endTime: String(event.end_time || '').slice(11, 16),
      location: event.location || '',
      description: event.description || '',
      requires_budget: Boolean(event.requires_budget),
      budget_notes: planning.budget_notes || '',
      vendor_deadlines: planning.vendor_deadlines || '',
      logistics_checklist: planning.logistics_checklist || '',
    });
    setFormError(null);
    setShowForm(true);
  }

  async function openEventDetails(event) {
    setSelectedEvent(event);
    setDetailsLoading(true);
    try {
      const response = await getEvent(event.id);
      setSelectedEvent(response.data);
    } catch {
      setSelectedEvent(event);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function handleGeneratePlan(e) {
    e.preventDefault();
    if (!planForm.event_id || !planForm.requirements.trim()) return;
    setPlanSubmitting(true);
    setPlanError(null);
    setPlanResult('');
    try {
      const res = await generateEventPlan(planForm.event_id, {
        requirements: planForm.requirements,
        create_workflow: planForm.create_workflow,
      });
      setPlanResult(res.data?.plan || '');
      setPlanForm({ event_id: planForm.event_id, requirements: '', create_workflow: true });
      load();
    } catch (err) {
      setPlanError(err.response?.data?.message ?? 'Failed to generate event plan.');
    } finally {
      setPlanSubmitting(false);
    }
  }

  const upcoming = events.filter((e) => ['upcoming', 'approved'].includes(e.status)).length;
  const completed = events.filter((e) => e.status === 'completed').length;

  const filteredEvents = events.filter((event) => {
    const matchesSearch = event.title?.toLowerCase().includes(search.toLowerCase());
    const matchesDate = !dateFilter || String(event.start_time || '').slice(0, 10) === dateFilter;
    return matchesSearch && matchesDate;
  });
  const eventLinkedTasks = tasks.filter((t) => t.event_id);
  const pagedEvents = filteredEvents.slice((eventsPage - 1) * pageSize, eventsPage * pageSize);
  const pagedEventTasks = eventLinkedTasks.slice((tasksPage - 1) * pageSize, tasksPage * pageSize);

  const checkedInUserIds = new Set((attendanceData?.records ?? []).map((r) => r.user_id));
  const filteredCheckInUsers = allUsers
    .filter(
      (u) =>
        !checkedInUserIds.has(u.id) &&
        (checkInSearch.trim() === '' ||
          `${u.first_name} ${u.last_name}`.toLowerCase().includes(checkInSearch.toLowerCase()) ||
          String(u.school_id ?? '').toLowerCase().includes(checkInSearch.toLowerCase()))
    )
    .slice(0, 6);

  useEffect(() => {
    setEventsPage(1);
  }, [search, dateFilter, events.length]);

  useEffect(() => {
    setTasksPage(1);
  }, [tasks.length]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Total Events', value: events.length, helper: 'This academic year', icon: Calendar },
          { label: 'Upcoming', value: upcoming, helper: 'Scheduled', icon: Clock },
          { label: 'Completed', value: completed, helper: 'Successfully held', icon: CheckCircle2 },
          { label: 'Total Tasks', value: tasks.length, helper: 'Across all events', icon: Users },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-3 sm:p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

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
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <div className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="Search events..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]"
                />
              </div>
              <input
                type="date"
                aria-label="Filter events by date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
                className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-[13px] outline-none focus:border-[#0B8ED0]"
              />
              {canCreateEvents && (
                <button onClick={openCreateForm} className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                  <Plus size={16} />
                  <span className="hidden sm:inline">Create Event</span>
                </button>
              )}
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
                    <th className="px-5 py-3 text-right">Actions</th>
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
                          {statusLabel[evt.status] || capitalize(evt.status)}
                        </span>
                        {evt.approval_status === 'rejected' && evt.approval_remarks && (
                          <p className="mt-1 max-w-[220px] text-[11px] text-red-600">
                            <span className="font-semibold">Rejected:</span> {evt.approval_remarks}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          <button type="button" title="View event details" aria-label={`View ${evt.title}`} onClick={() => openEventDetails(evt)} className="grid h-9 w-9 place-items-center rounded-md border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]">
                            <Eye size={15} />
                          </button>
                          {canCreateEvents && (
                            <button type="button" title="Edit event" aria-label={`Edit ${evt.title}`} onClick={() => openEditForm(evt)} className="grid h-9 w-9 place-items-center rounded-md border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]">
                              <Pencil size={15} />
                            </button>
                          )}
                        </div>
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
        <section className="space-y-4">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#0F172A]">Generate Event Plan</h2>
            <form className="mt-4 grid gap-3 lg:grid-cols-[220px_1fr_auto]" onSubmit={handleGeneratePlan}>
              <select
                value={planForm.event_id}
                onChange={(e) => setPlanForm({ ...planForm, event_id: e.target.value })}
                className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
              >
                <option value="">Select event</option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>{evt.title}</option>
                ))}
              </select>
              <textarea
                rows={2}
                value={planForm.requirements}
                onChange={(e) => setPlanForm({ ...planForm, requirements: e.target.value })}
                placeholder="Timeline, resources, vendors, logistics, risks..."
                className="rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] resize-none"
              />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={planForm.create_workflow}
                    onChange={(e) => setPlanForm({ ...planForm, create_workflow: e.target.checked })}
                    className="h-4 w-4 rounded border-[#DDE7EF]"
                  />
                  Workflow
                </label>
                <button
                  type="submit"
                  disabled={planSubmitting || !planForm.event_id || !planForm.requirements.trim()}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50"
                >
                  {planSubmitting ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </form>
            {planError && <p className="mt-2 text-xs font-semibold text-red-600">{planError}</p>}
            {planResult && (
              <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-xs leading-5 text-slate-700">{planResult}</pre>
            )}
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
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
                      <td className="max-w-[220px] truncate px-5 py-4 font-bold text-[#0F172A]">{t.title}</td>
                      <td className="max-w-[160px] truncate px-5 py-4 font-medium text-slate-600">
                        {t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '-'}
                      </td>
                      <td className="max-w-[160px] truncate px-5 py-4 font-medium text-slate-600">
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
          </div>
        </section>
      )}

      {activeTab === 'attendance' && (
        <section className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Attendance Tracking</h2>
            <p className="text-sm font-medium text-slate-500">Record and view event check-ins</p>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : events.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No events yet.</p>
          ) : (
            <div className="flex min-h-[400px]">
              {/* Left panel - event list */}
              <div className={`border-r border-[#DDE7EF] lg:flex lg:w-72 lg:shrink-0 lg:flex-col ${selectedAttEventId ? 'hidden' : 'flex w-full flex-col'}`}>
                <div className="border-b border-[#DDE7EF] px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Select Event</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {events.map((evt) => (
                    <button
                      key={evt.id}
                      type="button"
                      onClick={() => handleSelectAttEvent(evt.id)}
                      className={`flex w-full items-start gap-3 border-b border-[#E5EDF3] px-4 py-3 text-left transition last:border-b-0 hover:bg-[#F8FBFD] ${selectedAttEventId === evt.id ? 'bg-[#EEF6FB]' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-[#0F172A]">{evt.title}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-slate-400">{formatDateTime(evt.start_time)}</p>
                      </div>
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${statusBadge[evt.status] || 'bg-slate-100 text-slate-500'}`}>
                        {capitalize(evt.status)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right panel - detail */}
              <div className={`min-w-0 flex-1 flex-col ${selectedAttEventId ? 'flex' : 'hidden lg:flex'}`}>
                {!selectedAttEventId ? (
                  <div className="flex flex-1 items-center justify-center p-10 text-center">
                    <div>
                      <Users size={36} className="mx-auto mb-3 text-slate-200" />
                      <p className="text-sm text-slate-400">Select an event to view attendance</p>
                    </div>
                  </div>
                ) : attendanceLoading ? (
                  <div className="space-y-2 p-5">
                    {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
                  </div>
                ) : (
                  <>
                    {/* Mobile back button */}
                    <div className="flex items-center border-b border-[#DDE7EF] p-4 lg:hidden">
                      <button
                        type="button"
                        onClick={() => setSelectedAttEventId(null)}
                        className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B8ED0]"
                      >
                        <ChevronLeft size={16} />
                        All Events
                      </button>
                    </div>

                    {/* Event header */}
                    <div className="border-b border-[#DDE7EF] p-5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Attendance</p>
                      <h3 className="mt-1 text-base font-black text-[#0F172A]">{attendanceData?.event?.title ?? '-'}</h3>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">{formatDateTime(attendanceData?.event?.start_time)}</p>
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                        <UserCheck size={12} />
                        {attendanceData?.count ?? 0} checked in
                      </div>
                    </div>

                    {/* Check-in form - officer only */}
                    {canManageAttendance ? (
                      <div className="border-b border-[#DDE7EF] p-5">
                        <p className="mb-3 text-[13px] font-bold text-[#0F172A]">Record Check-In</p>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              value={checkInSearch}
                              onChange={(e) => { setCheckInSearch(e.target.value); setCheckInUserId(null); setCheckInSuccess(null); }}
                              type="text"
                              placeholder="Search name or student ID..."
                              className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-8 pr-3 text-[13px] outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleCheckIn}
                            disabled={!checkInUserId || checkInSubmitting}
                            className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-40"
                          >
                            <UserCheck size={15} />
                            <span className="hidden sm:inline">{checkInSubmitting ? 'Recording...' : 'Check In'}</span>
                          </button>
                        </div>
                        {checkInSearch.trim() !== '' && !checkInUserId && filteredCheckInUsers.length > 0 && (
                          <div className="mt-1 overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-lg">
                            {filteredCheckInUsers.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => {
                                  setCheckInUserId(u.id);
                                  setCheckInSearch(`${u.first_name} ${u.last_name} (${u.school_id})`);
                                }}
                                className="flex w-full items-center gap-3 border-b border-[#E5EDF3] px-4 py-2.5 text-left transition last:border-b-0 hover:bg-[#EEF6FB]"
                              >
                                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-[10px] font-black text-white">
                                  {u.first_name?.[0]}{u.last_name?.[0]}
                                </div>
                                <div>
                                  <p className="text-[13px] font-semibold text-[#0F172A]">{u.first_name} {u.last_name}</p>
                                  <p className="text-[11px] font-medium text-slate-400">{u.school_id} - {capitalize(u.role)}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {checkInSearch.trim() !== '' && !checkInUserId && filteredCheckInUsers.length === 0 && (
                          <p className="mt-2 text-xs font-medium text-slate-400">No matching members found.</p>
                        )}
                        {checkInError && <p className="mt-2 text-xs font-semibold text-red-600">{checkInError}</p>}
                        {checkInSuccess && <p className="mt-2 text-xs font-semibold text-emerald-600">{checkInSuccess}</p>}
                      </div>
                    ) : (
                      <div className="border-b border-[#DDE7EF] p-5">
                        <button
                          type="button"
                          onClick={handleCheckIn}
                          disabled={checkInSubmitting || (attendanceData?.records?.length ?? 0) > 0}
                          className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-40"
                        >
                          <UserCheck size={15} />
                          {checkInSubmitting ? 'Recording...' : 'Check In'}
                        </button>
                        {checkInError && <p className="mt-2 text-xs font-semibold text-red-600">{checkInError}</p>}
                        {checkInSuccess && <p className="mt-2 text-xs font-semibold text-emerald-600">{checkInSuccess}</p>}
                      </div>
                    )}

                    {/* Attendees table */}
                    {(attendanceData?.records?.length ?? 0) === 0 ? (
                      <p className="p-8 text-center text-sm text-slate-400">No check-ins recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[400px] text-left">
                          <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <tr>
                              <th className="px-5 py-3">Member</th>
                              <th className="px-5 py-3">School ID</th>
                              <th className="px-5 py-3">Method</th>
                              <th className="px-5 py-3">Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E5EDF3] text-sm">
                            {attendanceData.records.map((rec) => (
                              <tr key={rec.id} className="transition hover:bg-[#F8FBFD]">
                                <td className="px-5 py-3.5 font-bold text-[#0F172A]">
                                  {rec.user ? `${rec.user.first_name} ${rec.user.last_name}` : '-'}
                                </td>
                                <td className="px-5 py-3.5 font-medium text-slate-600">{rec.user?.school_id ?? '-'}</td>
                                <td className="px-5 py-3.5">
                                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${rec.method === 'biometric' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                    {capitalize(rec.method)}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 font-medium text-slate-600">{formatDateTime(rec.check_in_time)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[selectedEvent.status] || 'bg-slate-100 text-slate-600'}`}>{statusLabel[selectedEvent.status] || capitalize(selectedEvent.status)}</span>
                <h2 className="mt-3 text-xl font-extrabold text-[#0F172A]">{selectedEvent.title}</h2>
              </div>
              <button type="button" aria-label="Close event details" onClick={() => setSelectedEvent(null)} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            {detailsLoading ? (
              <div className="mt-5 h-28 animate-pulse rounded-lg bg-slate-100" />
            ) : (
              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <p><span className="font-bold text-[#0F172A]">Schedule:</span> {formatDateTime(selectedEvent.start_time)} to {formatDateTime(selectedEvent.end_time)}</p>
                <p><span className="font-bold text-[#0F172A]">Location:</span> {selectedEvent.location || 'Not specified'}</p>
                <p className="whitespace-pre-wrap"><span className="font-bold text-[#0F172A]">Description:</span> {selectedEvent.description || 'No description provided.'}</p>
                {selectedEvent.approval_remarks && <p className="rounded-lg bg-red-50 p-3 text-red-700"><span className="font-bold">Approval remarks:</span> {selectedEvent.approval_remarks}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">{editingEventId ? 'Edit Event' : 'Create Event'}</h2>
              <button onClick={() => { setShowForm(false); setEditingEventId(null); }} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleSaveEvent}>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <label className="flex items-center gap-2 text-[13px] font-semibold text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={form.requires_budget}
                  onChange={(e) => setForm({ ...form, requires_budget: e.target.checked })}
                  className="h-4 w-4 rounded border-[#DDE7EF]"
                />
                Requires budget allocation
              </label>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Budget Details</label>
                <textarea
                  rows={2}
                  value={form.budget_notes}
                  onChange={(e) => setForm({ ...form, budget_notes: e.target.value })}
                  placeholder="Expected expenses or funding notes..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Vendor Deadlines</label>
                <textarea
                  rows={2}
                  value={form.vendor_deadlines}
                  onChange={(e) => setForm({ ...form, vendor_deadlines: e.target.value })}
                  placeholder="Supplier, payment, or delivery deadlines..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Logistics Checklist</label>
                <textarea
                  rows={2}
                  value={form.logistics_checklist}
                  onChange={(e) => setForm({ ...form, logistics_checklist: e.target.value })}
                  placeholder="Venue setup, materials, registration, documentation..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditingEventId(null); }} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !form.title || !form.date || !form.startTime || !form.endDate || !form.endTime}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : editingEventId ? 'Save Changes' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
