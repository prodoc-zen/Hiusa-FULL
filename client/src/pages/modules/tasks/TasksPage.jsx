import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Filter,
  ListChecks,
  Plus,
  Search,
  X,
  Zap,
} from 'lucide-react';
import { getTasks, createTask, updateTaskStatus } from '../../../services/taskService';
import { getUsers } from '../../../services/userService';
import PaginationControls from '../../../components/PaginationControls';

const statusBadge = {
  in_progress: 'bg-[#E6F6FD] text-[#0B8ED0]',
  completed: 'bg-emerald-50 text-emerald-700',
  overdue: 'bg-red-50 text-red-700',
  pending: 'bg-slate-100 text-slate-500',
};

function capitalize(s) {
  return s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '-';
}

export default function TasksPage({ initialTab = 'board' }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [tasks, setTasks] = useState([]);
  const [officers, setOfficers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [form, setForm] = useState({ title: '', description: '', assigned_to: '', deadline: '', status: 'pending' });
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([getTasks(), getUsers()])
      .then(([taskRes, userRes]) => {
        setTasks(Array.isArray(taskRes.data) ? taskRes.data : []);
        const allUsers = Array.isArray(userRes) ? userRes : (Array.isArray(userRes.data) ? userRes.data : []);
        setOfficers(allUsers.filter((u) => u.role === 'officer'));
      })
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title || !form.deadline) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      await createTask({
        title: form.title,
        description: form.description,
        assigned_to: form.assigned_to || null,
        deadline: form.deadline,
        status: form.status,
      });
      setShowForm(false);
      setForm({ title: '', description: '', assigned_to: '', deadline: '', status: 'pending' });
      load();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to create task.');
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      const res = await updateTaskStatus(id, newStatus);
      setTasks((prev) => prev.map((t) => (t.id === id ? res.data : t)));
    } catch {
      alert('Failed to update task status.');
    }
  }

  const counts = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

  const filteredTasks = tasks.filter((t) =>
    t.title?.toLowerCase().includes(search.toLowerCase())
  );
  const pagedTasks = filteredTasks.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, tasks.length]);

  const workloadByAssignee = tasks.reduce((acc, t) => {
    if (!t.assignee) return acc;
    const key = t.assignee.id;
    if (!acc[key]) acc[key] = { user: t.assignee, total: 0, completed: 0 };
    acc[key].total += 1;
    if (t.status === 'completed') acc[key].completed += 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Tasks', value: tasks.length, helper: 'All time', icon: ListChecks },
          { label: 'In Progress', value: counts.in_progress || 0, helper: 'Active assignments', icon: Clock },
          { label: 'Completed', value: counts.completed || 0, helper: 'Successfully done', icon: CheckCircle2 },
          { label: 'Overdue', value: counts.overdue || 0, helper: 'Past deadline', icon: AlertCircle },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>

      <div className="flex flex-wrap gap-2">
        {['board', 'progress', 'ai'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${
              activeTab === tab
                ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
                : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
            }`}
          >
            {tab === 'board' ? 'Task Board' : tab === 'progress' ? 'Track Progress' : 'AI Delegation'}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'board' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">All Tasks</h2>
              <p className="text-sm font-medium text-slate-500">Create and manage officer tasks</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                <Search size={15} className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="Search tasks..."
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]"
                />
              </div>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Create Task</span>
              </button>
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
              <table className="w-full min-w-[580px] sm:min-w-[780px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Task</th>
                    <th className="hidden sm:table-cell px-5 py-3">Assignee</th>
                    <th className="px-5 py-3">Deadline</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {pagedTasks.map((t) => (
                    <tr key={t.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="px-5 py-4 font-bold text-[#0F172A]">{t.title}</td>
                      <td className="hidden sm:table-cell px-5 py-4 font-medium text-slate-600">
                        {t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '-'}
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-600">{t.deadline ?? '-'}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[t.status] || 'bg-slate-100 text-slate-500'}`}>
                          {capitalize(t.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {t.status === 'pending' && (
                          <button
                            onClick={() => handleStatusChange(t.id, 'in_progress')}
                            className="rounded-md bg-[#E6F6FD] px-2.5 py-1 text-xs font-bold text-[#0B8ED0] hover:bg-[#d2eef9] transition"
                          >
                            Start
                          </button>
                        )}
                        {t.status === 'in_progress' && (
                          <button
                            onClick={() => handleStatusChange(t.id, 'completed')}
                            className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition"
                          >
                            Complete
                          </button>
                        )}
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
                <div key={entry.user.id} className="flex items-center gap-4 rounded-lg bg-[#F8FBFD] p-4">
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
                <p className="text-sm font-medium text-slate-500">Smart delegation based on officer workload</p>
              </div>
            </div>
            {Object.values(workloadByAssignee).length === 0 ? (
              <p className="text-sm text-slate-400">Assign tasks to officers to see delegation suggestions.</p>
            ) : (
              <div className="space-y-3">
                {Object.values(workloadByAssignee)
                  .sort((a, b) => a.total - b.total)
                  .slice(0, 3)
                  .map((entry) => (
                    <div key={entry.user.id} className="rounded-lg border border-violet-100 bg-violet-50/50 p-4">
                      <p className="text-sm font-bold text-[#0F172A]">Next task suggestion</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        <span className="font-bold text-violet-600">→ {entry.user.first_name} {entry.user.last_name}</span>
                        {' '}· {entry.total} tasks assigned, {entry.completed} completed
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-[#0F172A]">How AI Delegation Works</h3>
            <div className="mt-4 space-y-3">
              {[
                'Analyzes each officer\'s current workload and active tasks',
                'Considers past performance on similar task types',
                'Balances distribution to prevent officer burnout',
                'Prioritizes by deadline urgency and task dependencies',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-violet-600" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
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
              <div className="grid grid-cols-2 gap-4">
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
