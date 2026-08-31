import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Eye,
  ListChecks,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { getTasks, createTask, updateTaskStatus } from '../../../services/taskService';
import { getUsers } from '../../../services/userService';
import { getEvents } from '../../../services/eventService';
import PaginationControls from '../../../components/PaginationControls';
import EngineBadge from '../../../components/ai/EngineBadge';

function getDelegationDetail(source) {
  if (!source || typeof source !== 'object') return null;
  const container = source.delegation && typeof source.delegation === 'object' ? source.delegation : source;
  const rankings = Array.isArray(container.rankings) ? container.rankings : null;
  const weights = container.weights && typeof container.weights === 'object' ? container.weights : null;
  const eligibilityRules = Array.isArray(container.eligibility_rules) ? container.eligibility_rules : null;
  const taskArea = container.task_area ?? container.inferred_task_area ?? null;
  const engine = container.engine ?? container.delegation_engine ?? null;
  const recommendedOfficerId = container.recommended_officer_id ?? null;

  if (!rankings && !weights && !eligibilityRules && !taskArea && !engine) return null;

  return { rankings, weights, eligibilityRules, taskArea, engine, recommendedOfficerId };
}

function formatWeightLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const statusBadge = {
  in_progress: 'bg-[#E6F6FD] text-[#0B8ED0]',
  completed: 'bg-emerald-50 text-emerald-700',
  overdue: 'bg-red-50 text-red-700',
  pending: 'bg-slate-100 text-slate-500',
};

function capitalize(s) {
  return s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '-';
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TasksPage({ initialTab = 'board' }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [tasks, setTasks] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [taskFilters, setTaskFilters] = useState({ status: '', assignee: '', event: '', type: '' });
  const [page, setPage] = useState(1);
  const [selectedTask, setSelectedTask] = useState(null);
  const [progressForm, setProgressForm] = useState({ progress_percent: 0, progress_note: '' });
  const [progressSaving, setProgressSaving] = useState(false);
  const [completionTask, setCompletionTask] = useState(null);
  const [lastDelegation, setLastDelegation] = useState(null);
  const [rankingOpen, setRankingOpen] = useState(false);
  const pageSize = 10;

  const [form, setForm] = useState({ title: '', description: '', assigned_to: '', event_id: '', deadline: '', status: 'pending' });
  const [formError, setFormError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const currentUserRole = (() => {
    try { return JSON.parse(localStorage.getItem('user') ?? '{}')?.role ?? ''; }
    catch { return ''; }
  })();
  const canManageTasks = currentUserRole === 'ADMIN';
  const canUpdateAssignedTasks = currentUserRole === 'SBO_OFFICER';

  function load() {
    setLoading(true);
    setError(null);
    const usersRequest = canManageTasks ? getUsers({ role: 'SBO_OFFICER', account_status: 'active' }) : Promise.resolve([]);
    const eventsRequest = canManageTasks ? getEvents() : Promise.resolve({ data: [] });
    Promise.all([getTasks(), usersRequest, eventsRequest])
      .then(([taskRes, userRes, eventRes]) => {
        setTasks(Array.isArray(taskRes.data) ? taskRes.data : []);
        const allUsers = Array.isArray(userRes) ? userRes : (Array.isArray(userRes.data) ? userRes.data : []);
        setOfficers(allUsers.filter((u) => u.role === 'SBO_OFFICER'));
        setEvents(Array.isArray(eventRes.data) ? eventRes.data : []);
      })
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [canManageTasks]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title || !form.deadline) return;
    setFormSubmitting(true);
    setFormError(null);
    setCreateSuccess('');
    try {
      const res = await createTask({
        title: form.title,
        description: form.description,
        assigned_to: form.assigned_to || null,
        event_id: form.event_id || null,
        deadline: form.deadline,
        status: form.status,
      });
      const detail = getDelegationDetail(res.data);
      if (detail) setLastDelegation({ taskId: res.data.id, ...detail });
      setShowForm(false);
      setCreateSuccess(`Task “${res.data.title}” was created${res.data.assignee ? ` and assigned to ${res.data.assignee.first_name} ${res.data.assignee.last_name}` : ''}.`);
      setForm({ title: '', description: '', assigned_to: '', event_id: '', deadline: '', status: 'pending' });
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to create task.');
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleStatusChange(id, newStatus, progressNote = null, progressPercent = null) {
    setError(null);
    try {
      const res = await updateTaskStatus(id, {
        status: newStatus,
        ...(progressNote?.trim() ? { progress_note: progressNote.trim() } : {}),
        ...(progressPercent !== null ? { progress_percent: Number(progressPercent) } : {}),
      });
      setTasks((prev) => prev.map((t) => (t.id === id ? res.data : t)));
      setSelectedTask((current) => (current?.id === id ? res.data : current));
      return res.data;
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to update task status.');
      throw err;
    }
  }

  function openTaskDetails(task) {
    setSelectedTask(task);
    setProgressForm({ progress_percent: task.progress_percent ?? 0, progress_note: '' });
  }

  async function saveProgressUpdate() {
    if (!selectedTask) return;
    setProgressSaving(true);
    try {
      const updated = await handleStatusChange(selectedTask.id, selectedTask.status, progressForm.progress_note, progressForm.progress_percent);
      setProgressForm({ progress_percent: updated.progress_percent ?? 0, progress_note: '' });
    } finally {
      setProgressSaving(false);
    }
  }

  const counts = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

  const filteredTasks = tasks.filter((t) => {
    const query = search.toLowerCase();
    const searchable = [t.title, t.description, t.assignee?.first_name, t.assignee?.last_name, t.assignee?.position_title, t.event?.title].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(query)
      && (!taskFilters.status || t.status === taskFilters.status)
      && (!taskFilters.assignee || String(t.assigned_to) === taskFilters.assignee)
      && (!taskFilters.event || String(t.event_id) === taskFilters.event)
      && (!taskFilters.type || t.task_type === taskFilters.type);
  });
  const pagedTasks = filteredTasks.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, tasks.length, taskFilters]);

  function exportVisibleTasks() {
    const header = ['Task ID', 'Title', 'Description', 'Type', 'Assignee', 'Role', 'Position', 'Department', 'Program', 'Year Level', 'Section', 'Related Event', 'Status', 'Progress Percent', 'Deadline', 'Completed At', 'Assigned By', 'Created At', 'Updated At'];
    const rows = filteredTasks.map((task) => [task.id, task.title, task.description, task.task_type, task.assignee ? `${task.assignee.first_name} ${task.assignee.last_name}` : '', task.assignee?.role, task.assignee?.position_title, task.assignee?.department, task.assignee?.program, task.assignee?.year_level, task.assignee?.section, task.event?.title, task.status, task.progress_percent, task.deadline, task.completed_at, task.creator ? `${task.creator.first_name} ${task.creator.last_name}` : '', task.created_at, task.updated_at]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  const workloadByAssignee = tasks.reduce((acc, t) => {
    if (!t.assignee) return acc;
    const key = t.assignee.school_id ?? t.assignee.id;
    if (!acc[key]) acc[key] = { user: t.assignee, total: 0, completed: 0 };
    acc[key].total += 1;
    if (t.status === 'completed') acc[key].completed += 1;
    return acc;
  }, {});
  const scoredAssignments = tasks
    .filter((task) => task.assignee && Number.isFinite(Number(task.final_score)))
    .sort((a, b) => Number(b.final_score) - Number(a.final_score))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {activeTab !== 'create' && <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Total Tasks', value: tasks.length, helper: 'All time', icon: ListChecks },
          { label: 'In Progress', value: counts.in_progress || 0, helper: 'Active assignments', icon: Clock },
          { label: 'Completed', value: counts.completed || 0, helper: 'Successfully done', icon: CheckCircle2 },
          { label: 'Overdue', value: counts.overdue || 0, helper: 'Past deadline', icon: AlertCircle },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-3 sm:p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'create' && canManageTasks && (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
            <div className="border-b border-[#DDE7EF] pb-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B8ED0]">Task assignment</p>
              <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Create a New Task</h2>
              <p className="mt-1 text-sm text-slate-500">Define one actionable assignment, connect it to an event when relevant, and select an officer or let the scoring engine recommend one.</p>
            </div>
            {createSuccess && <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{createSuccess}</div>}
            <form className="mt-5 space-y-5" onSubmit={handleCreate}>
              <div className="space-y-1.5"><label htmlFor="create-task-title" className="text-[13px] font-semibold text-[#0F172A]">Task Title *</label><input id="create-task-title" type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Prepare election materials" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" /></div>
              <div className="space-y-1.5"><label htmlFor="create-task-description" className="text-[13px] font-semibold text-[#0F172A]">Description</label><textarea id="create-task-description" rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the expected result, required materials, and completion criteria..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><label htmlFor="create-task-assignee" className="text-[13px] font-semibold text-[#0F172A]">Assign To</label><select id="create-task-assignee" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="">Recommend best-fit officer</option>{officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.first_name} {officer.last_name}{officer.position_title ? ` · ${officer.position_title}` : ''}</option>)}</select><p className="text-xs text-slate-400">Leaving this blank enables weighted officer recommendation.</p></div>
                <div className="space-y-1.5"><label htmlFor="create-task-event" className="text-[13px] font-semibold text-[#0F172A]">Related Event</label><select id="create-task-event" value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="">General organization task</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div>
                <div className="space-y-1.5"><label htmlFor="create-task-deadline" className="text-[13px] font-semibold text-[#0F172A]">Deadline *</label><input id="create-task-deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" /></div>
                <div className="space-y-1.5"><label htmlFor="create-task-status" className="text-[13px] font-semibold text-[#0F172A]">Initial Status</label><select id="create-task-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="pending">Pending</option><option value="in_progress">In Progress</option></select></div>
              </div>
              {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{formError}</p>}
              <div className="flex flex-wrap justify-end gap-3 border-t border-[#DDE7EF] pt-5"><button type="button" onClick={() => { setForm({ title: '', description: '', assigned_to: '', event_id: '', deadline: '', status: 'pending' }); setFormError(null); setCreateSuccess(''); }} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Clear Form</button><button type="submit" disabled={formSubmitting || !form.title || !form.deadline} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50"><Plus size={16} />{formSubmitting ? 'Creating...' : 'Create Task'}</button></div>
            </form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm"><h3 className="font-bold text-[#0F172A]">Assignment readiness</h3><div className="mt-4 space-y-3">{[['Active SBO officers', officers.length], ['Available events', events.length], ['Current open tasks', tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length]].map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2.5"><span className="text-xs font-semibold text-slate-500">{label}</span><strong className="text-lg text-[#0F172A]">{value}</strong></div>)}</div></div>
            <div className="rounded-xl border border-[#B9D9E9] bg-[#EEF6FB] p-5"><Bot size={20} className="text-[#0B8ED0]" /><h3 className="mt-3 font-bold text-[#0F172A]">Best-fit recommendation</h3><p className="mt-2 text-sm leading-6 text-slate-600">If no officer is chosen, the system evaluates active SBO officers using role fit, current workload, and prior completion performance. The result and explanation remain visible in AI Delegation.</p></div>
            <div className="rounded-xl border border-[#DDE7EF] bg-white p-5"><h3 className="font-bold text-[#0F172A]">Before creating</h3><ul className="mt-3 space-y-2 text-xs leading-5 text-slate-500"><li>• Use a specific, outcome-based title.</li><li>• Include completion criteria in the description.</li><li>• Set a realistic deadline before its linked event.</li><li>• Review assignments later from Task Board.</li></ul></div>
          </aside>
        </section>
      )}

      {activeTab === 'board' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">{canManageTasks ? 'All Tasks' : 'Assigned Tasks'}</h2>
              <p className="text-sm font-medium text-slate-500">{canManageTasks ? 'Create and manage officer tasks' : 'View and update your assignments'}</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <div className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="Search tasks..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]"
                />
              </div>
              <select aria-label="Filter tasks by status" value={taskFilters.status} onChange={(event) => setTaskFilters({ ...taskFilters, status: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs"><option value="">All statuses</option>{['pending', 'in_progress', 'completed', 'overdue'].map((value) => <option key={value} value={value}>{capitalize(value)}</option>)}</select>
              {canManageTasks && <select aria-label="Filter tasks by assignee" value={taskFilters.assignee} onChange={(event) => setTaskFilters({ ...taskFilters, assignee: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs"><option value="">All assignees</option>{officers.map((officer) => <option key={officer.school_id} value={officer.school_id}>{officer.first_name} {officer.last_name}</option>)}</select>}
              <select aria-label="Filter tasks by event" value={taskFilters.event} onChange={(event) => setTaskFilters({ ...taskFilters, event: event.target.value })} className="h-11 rounded-lg border border-[#DDE7EF] px-3 text-xs"><option value="">All events</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select>
              <button type="button" onClick={exportVisibleTasks} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]"><Download size={14} />Export</button>
              {canManageTasks && (
                <button onClick={() => setShowForm(true)} className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                  <Plus size={16} />
                  <span className="hidden sm:inline">Create Task</span>
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : filteredTasks.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No tasks found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1380px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Task</th>
                    <th className="px-5 py-3">Assignee / Position</th>
                    <th className="px-5 py-3">Academic Profile</th>
                    <th className="px-5 py-3">Related Event</th>
                    <th className="px-5 py-3">Type / Progress</th>
                    <th className="px-5 py-3">Deadline</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Assigned By / Dates</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {pagedTasks.map((t) => (
                    <tr key={t.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="max-w-[260px] px-5 py-4"><p className="font-bold text-[#0F172A]">{t.title}</p><p className="mt-1 line-clamp-2 text-[10px] text-slate-400">{t.description || 'No description'}</p></td>
                      <td className="px-5 py-4 font-medium text-slate-600">{t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '-'}<p className="text-[10px] font-semibold text-[#0B8ED0]">{t.assignee?.position_title || t.assignee?.role?.replaceAll('_', ' ') || '-'}</p></td>
                      <td className="px-5 py-4 text-xs text-slate-600"><p>{t.assignee?.program || 'Program not recorded'}</p><p className="text-[10px] text-slate-400">{[t.assignee?.year_level, t.assignee?.section].filter(Boolean).join(' · ') || 'No year/section'}</p></td>
                      <td className="px-5 py-4 text-xs font-semibold text-slate-600">{t.event?.title || 'General organization task'}</td>
                      <td className="px-5 py-4 text-xs"><p className="font-semibold text-slate-600">{capitalize(t.task_type || 'regular')}</p><div className="mt-1 h-1.5 w-24 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#0B8ED0]" style={{ width: `${Math.min(100, Number(t.progress_percent || 0))}%` }} /></div><p className="mt-1 text-[10px] text-slate-400">{t.progress_percent || 0}% complete</p></td>
                      <td className="px-5 py-4 font-medium text-slate-600">{formatDate(t.deadline)}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[t.status] || 'bg-slate-100 text-slate-500'}`}>
                          {capitalize(t.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[10px] text-slate-500"><p>{t.creator ? `${t.creator.first_name} ${t.creator.last_name}` : '-'}</p><p>Created {formatDate(t.created_at)}</p><p>Completed {formatDate(t.completed_at)}</p></td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => openTaskDetails(t)} className="inline-flex items-center gap-1 rounded-md border border-[#DDE7EF] px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-[#F8FBFD]">
                            <Eye size={12} /> View
                          </button>
                          {(canManageTasks || canUpdateAssignedTasks) && t.status === 'pending' && (
                            <button
                              onClick={() => handleStatusChange(t.id, 'in_progress', 'Task work started.', Math.max(1, t.progress_percent ?? 0))}
                              className="rounded-md bg-[#E6F6FD] px-2.5 py-1 text-xs font-bold text-[#0B8ED0] hover:bg-[#d2eef9] transition"
                            >
                              Start
                            </button>
                          )}
                          {(canManageTasks || canUpdateAssignedTasks) && ['in_progress', 'overdue'].includes(t.status) && (
                            <button
                              onClick={() => setCompletionTask(t)}
                              className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition"
                            >
                              Complete
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
            currentPage={page}
            totalItems={filteredTasks.length}
            pageSize={pageSize}
            onPageChange={setPage}
            label="tasks"
          />
        </section>
      )}

      {activeTab === 'progress' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#0F172A]">Officer Workload</h2>
          <p className="mb-5 text-sm font-medium text-slate-500">Task completion progress per assignee</p>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : Object.keys(workloadByAssignee).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No assigned tasks yet.</p>
          ) : (
            <div className="space-y-4">
              {Object.values(workloadByAssignee).map((entry) => (
                <div key={entry.user.school_id ?? entry.user.id} className="flex items-center gap-4 rounded-lg bg-[#F8FBFD] p-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
                    {entry.user.first_name?.[0]}{entry.user.last_name?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold text-[#0F172A]">
                        {entry.user.first_name} {entry.user.last_name}
                      </span>
                      <span className="text-sm font-bold text-[#0B8ED0]">{entry.completed}/{entry.total}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-[#EEF6FB] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3] transition-all duration-500"
                        style={{ width: `${entry.total > 0 ? (entry.completed / entry.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'ai' && (
        <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600">
                <Bot size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">AI Task Suggestions</h2>
                <p className="text-sm font-medium text-slate-500">Weighted officer fit scoring, per task</p>
              </div>
            </div>

            {lastDelegation?.rankings?.length > 0 && (
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => setRankingOpen((current) => !current)}
                  aria-expanded={rankingOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-700">
                    <ChevronDown size={14} className={`transition-transform ${rankingOpen ? 'rotate-180' : ''}`} />
                    Full officer ranking
                  </span>
                  <EngineBadge engine={lastDelegation.engine} />
                </button>
                {rankingOpen && (
                  <div className="mt-3">
                    {lastDelegation.taskArea && (
                      <p className="text-xs font-semibold text-slate-600">Inferred task area: <span className="text-[#0F172A]">{lastDelegation.taskArea}</span></p>
                    )}
                    <div className="mt-3 divide-y divide-[#E5EDF3]">
                      {lastDelegation.rankings.map((ranking) => {
                        const isRecommended = lastDelegation.recommendedOfficerId != null
                          && String(ranking.officer_id) === String(lastDelegation.recommendedOfficerId);
                        const positionScore = ranking.position_score ?? ranking.role_score;
                        const positionTier = ranking.position_tier ?? ranking.position_relevance_tier ?? ranking.relevance_tier ?? null;
                        return (
                          <div key={ranking.officer_id} className="py-3 first:pt-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-bold text-[#0F172A]">
                                {ranking.name}
                                {isRecommended && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase text-violet-700">Recommended</span>}
                                {positionTier && <span className="ml-2 rounded-full border border-[#DDE7EF] px-2 py-0.5 text-[10px] font-bold text-slate-500">{positionTier}</span>}
                              </p>
                              {Number.isFinite(Number(ranking.final_score)) && (
                                <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-black text-violet-700">{Number(ranking.final_score).toFixed(2)} fit</span>
                              )}
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                              {positionScore != null && (
                                <span>Position <strong className="block text-slate-700">{Number(positionScore).toFixed(2)}{lastDelegation.weights?.role != null && ` (×${(lastDelegation.weights.role * 100).toFixed(0)}%)`}{lastDelegation.weights?.position != null && ` (×${(lastDelegation.weights.position * 100).toFixed(0)}%)`}</strong></span>
                              )}
                              {ranking.workload_score != null && (
                                <span>Workload <strong className="block text-slate-700">{Number(ranking.workload_score).toFixed(2)}{lastDelegation.weights?.workload != null && ` (×${(lastDelegation.weights.workload * 100).toFixed(0)}%)`}</strong></span>
                              )}
                              {ranking.performance_score != null && (
                                <span>Performance <strong className="block text-slate-700">{Number(ranking.performance_score).toFixed(2)}{lastDelegation.weights?.performance != null && ` (×${(lastDelegation.weights.performance * 100).toFixed(0)}%)`}</strong></span>
                              )}
                            </div>
                            {ranking.explanation && <p className="mt-2 text-xs leading-5 text-slate-500">{ranking.explanation}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {scoredAssignments.length === 0 ? (
              <p className="text-sm text-slate-400">Create a task to generate an eligible officer recommendation and score breakdown.</p>
            ) : (
              <div className="space-y-3">
                {scoredAssignments.map((task) => (
                    <div key={task.id} className="rounded-lg border border-violet-100 bg-violet-50/50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-[#0F172A]">{task.title}</p>
                          <p className="mt-1 text-xs font-bold text-violet-700">
                            Recommended: {task.assignee.first_name} {task.assignee.last_name}
                          </p>
                        </div>
                        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-black text-violet-700">
                          {Number(task.final_score).toFixed(2)} fit
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <EngineBadge engine={task.id === lastDelegation?.taskId ? lastDelegation.engine : null} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                        <span>Role <strong className="block text-slate-700">{Number(task.role_score).toFixed(2)}</strong></span>
                        <span>Workload <strong className="block text-slate-700">{Number(task.workload_score).toFixed(2)}</strong></span>
                        <span>Performance <strong className="block text-slate-700">{Number(task.performance_score).toFixed(2)}</strong></span>
                      </div>
                      {task.ai_recommendation_note && <p className="mt-3 text-xs leading-5 text-slate-500">{task.ai_recommendation_note}</p>}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-[#0F172A]">How AI Delegation Works</h3>
            <div className="mt-4 space-y-3">
              {(lastDelegation?.weights
                ? [
                  'Filters candidates to active, policy-eligible SBO Officers',
                  ...Object.entries(lastDelegation.weights).map(([key, value]) => `Weighs ${formatWeightLabel(key)} at ${(Number(value) * 100).toFixed(0)}%`),
                ]
                : [
                  'Filters candidates to active, policy-eligible SBO Officers',
                  'Scores by position fit, current workload, and completed-versus-overdue performance',
                  'Recommends the officer with the highest weighted fit score',
                ]
              ).map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-violet-600" />
                  {item}
                </div>
              ))}
            </div>
            {lastDelegation?.eligibilityRules?.length > 0 && (
              <div className="mt-5 border-t border-[#DDE7EF] pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Eligibility rules for the latest request</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-slate-600">
                  {lastDelegation.eligibilityRules.map((rule, i) => <li key={i}>{rule}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">{selectedTask.title}</h2>
                <p className="mt-1 text-sm text-slate-500">Due {formatDate(selectedTask.deadline)} · {capitalize(selectedTask.status)}</p>
              </div>
              <button type="button" aria-label="Close task details" onClick={() => setSelectedTask(null)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-[#DDE7EF] p-4">
                <p className="text-xs font-bold uppercase text-slate-400">Description</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{selectedTask.description || 'No description provided.'}</p>
              </div>
              <div className="rounded-lg border border-[#DDE7EF] p-4">
                <p className="text-xs font-bold uppercase text-slate-400">Related Event</p>
                <p className="mt-2 text-sm font-semibold text-[#0F172A]">{selectedTask.event?.title || 'No linked event'}</p>
                {selectedTask.ai_recommendation_note && <p className="mt-3 text-xs leading-5 text-slate-500">{selectedTask.ai_recommendation_note}</p>}
              </div>
            </div>

            {(canManageTasks || canUpdateAssignedTasks) && selectedTask.status !== 'completed' && (
              <div className="mt-5 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4">
                <h3 className="text-sm font-bold text-[#0F172A]">Add Progress Update</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Progress (%)</label>
                    <input type="number" min="0" max="99" value={progressForm.progress_percent} onChange={(e) => setProgressForm((current) => ({ ...current, progress_percent: e.target.value }))} className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Update note</label>
                    <input value={progressForm.progress_note} onChange={(e) => setProgressForm((current) => ({ ...current, progress_note: e.target.value }))} placeholder="Describe what changed..." className="mt-1 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                  </div>
                </div>
                <button type="button" disabled={progressSaving || !progressForm.progress_note.trim()} onClick={saveProgressUpdate} className="mt-3 h-10 rounded-lg bg-[#0B8ED0] px-4 text-xs font-bold text-white disabled:opacity-50">{progressSaving ? 'Saving...' : 'Save Progress Update'}</button>
              </div>
            )}

            <div className="mt-5">
              <h3 className="text-sm font-bold text-[#0F172A]">Progress History</h3>
              {selectedTask.progress_updates?.length ? (
                <div className="mt-3 space-y-3">
                  {selectedTask.progress_updates.map((update) => (
                    <div key={update.id} className="border-l-2 border-[#0B8ED0] pl-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#0F172A]">{capitalize(update.status)} · {update.progress_percent}%</p>
                        <p className="text-[11px] text-slate-400">{new Date(update.created_at).toLocaleString('en-PH')}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{update.note || 'Status updated.'}</p>
                      {update.author && <p className="mt-1 text-[11px] text-slate-400">By {update.author.first_name} {update.author.last_name}</p>}
                    </div>
                  ))}
                </div>
              ) : <p className="mt-3 text-sm text-slate-400">No progress updates yet.</p>}
            </div>
          </div>
        </div>
      )}

      {completionTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-[#0F172A]">Confirm Task Completion</h2>
            <p className="mt-2 text-sm text-slate-500">Mark “{completionTask.title}” as completed? Progress will be saved at 100% and the Admin will be notified.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setCompletionTask(null)} className="h-11 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-slate-600">Cancel</button>
              <button type="button" onClick={async () => { await handleStatusChange(completionTask.id, 'completed', 'Task marked as completed.', 100); setCompletionTask(null); }} className="h-11 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700">Confirm Completion</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Create Task</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Task Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Prepare election materials"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Task details..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Assign To</label>
                  <select
                    value={form.assigned_to}
                    onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  >
                    <option value="">Unassigned</option>
                    {officers.map((u) => (
                      <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Related Event</label>
                  <select
                    value={form.event_id}
                    onChange={(e) => setForm({ ...form, event_id: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                  >
                    <option value="">No linked event</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>{event.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Deadline *</label>
                  <input
                    type="date"
                    value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !form.title || !form.deadline}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {formSubmitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
