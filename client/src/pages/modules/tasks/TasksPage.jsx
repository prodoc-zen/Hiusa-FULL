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
  Zap
} from 'lucide-react';

const stats = [
  { label: 'Total Tasks', value: '47', helper: 'All time', icon: ListChecks },
  { label: 'In Progress', value: '12', helper: 'Active assignments', icon: Clock },
  { label: 'Completed', value: '32', helper: 'Successfully done', icon: CheckCircle2 },
  { label: 'Overdue', value: '3', helper: 'Past deadline', icon: AlertCircle },
];

const tasks = [
  { title: 'Prepare election ballot template', assignee: 'Maria Santos', due: '2026-06-25', priority: 'High', status: 'In Progress', aiSuggested: true },
  { title: 'Update membership database', assignee: 'Daniel Reyes', due: '2026-06-28', priority: 'Medium', status: 'In Progress', aiSuggested: false },
  { title: 'Design event poster — Assembly', assignee: 'Alyssa Mariano', due: '2026-06-24', priority: 'High', status: 'Overdue', aiSuggested: false },
  { title: 'Review financial report draft', assignee: 'Carlo Lim', due: '2026-06-30', priority: 'Medium', status: 'Not Started', aiSuggested: true },
  { title: 'Coordinate with venue management', assignee: 'Mika Santos', due: '2026-07-01', priority: 'Low', status: 'Not Started', aiSuggested: false },
  { title: 'Send voting reminder notifications', assignee: 'John Carlo', due: '2026-06-23', priority: 'High', status: 'Completed', aiSuggested: true },
  { title: 'Collect merchandise pre-orders', assignee: 'Maria Santos', due: '2026-06-22', priority: 'Medium', status: 'Completed', aiSuggested: false },
];

const statusBadge = {
  'In Progress': 'bg-[#E6F6FD] text-[#0B8ED0]',
  Completed: 'bg-emerald-50 text-emerald-700',
  Overdue: 'bg-red-50 text-red-700',
  'Not Started': 'bg-slate-100 text-slate-500',
};

const priorityBadge = {
  High: 'bg-red-50 text-red-600 border-red-200',
  Medium: 'bg-amber-50 text-amber-600 border-amber-200',
  Low: 'bg-slate-50 text-slate-500 border-slate-200',
};

const officerWorkloads = [
  { name: 'Maria Santos', role: 'Secretary', tasks: 8, completed: 5 },
  { name: 'Daniel Reyes', role: 'Treasurer', tasks: 6, completed: 4 },
  { name: 'Alyssa Mariano', role: 'VP External', tasks: 7, completed: 3 },
  { name: 'Carlo Lim', role: 'PRO', tasks: 5, completed: 2 },
  { name: 'John Carlo', role: 'President', tasks: 10, completed: 8 },
  { name: 'Mika Santos', role: 'VP Internal', tasks: 4, completed: 2 },
];

export default function TasksPage({ initialTab = 'board' }) {
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 flex items-center justify-between">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition">
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
        {['board', 'progress', 'ai'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-4 py-2.5 text-[13px] font-bold capitalize transition-all ${activeTab === tab
              ? 'bg-[#0B8ED0] text-white shadow-lg shadow-[#0B8ED0]/20'
              : 'bg-white text-slate-600 border border-[#DDE7EF] hover:bg-[#EEF6FB]'
              }`}
          >
            {tab === 'board' ? 'Task Board' : tab === 'progress' ? 'Track Progress' : 'AI Delegation'}
          </button>
        ))}
      </div>

      {/* Task board */}
      {activeTab === 'board' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE7EF] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">All Tasks</h2>
              <p className="text-sm font-medium text-slate-500">Create and manage officer tasks</p>
            </div>
            <div className="flex gap-2">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3">
                <Search size={15} className="text-slate-400" />
                <input type="text" placeholder="Search tasks..." className="w-[140px] bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
              </div>
              <button type="button" className="grid h-10 w-10 place-items-center rounded-lg border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB]"><Filter size={16} /></button>
              <button onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                <Plus size={16} />
                <span className="hidden sm:inline">Create Task</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Task</th>
                  <th className="px-5 py-3">Assignee</th>
                  <th className="px-5 py-3">Due Date</th>
                  <th className="px-5 py-3">Priority</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5EDF3] text-sm">
                {tasks.map((t, i) => (
                  <tr key={i} className="transition hover:bg-[#F8FBFD]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#0F172A]">{t.title}</span>
                        {t.aiSuggested && (
                          <span className="flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-600">
                            <Bot size={10} /> AI
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-600">{t.assignee}</td>
                    <td className="px-5 py-4 font-medium text-slate-600">{t.due}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${priorityBadge[t.priority]}`}>{t.priority}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[t.status]}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Track progress */}
      {activeTab === 'progress' && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#0F172A]">Officer Workload</h2>
          <p className="mb-5 text-sm font-medium text-slate-500">Task completion progress per officer</p>
          <div className="space-y-4">
            {officerWorkloads.map((officer) => (
              <div key={officer.name} className="flex items-center gap-4 rounded-lg bg-[#F8FBFD] p-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0B8ED0] to-[#16C7F3] text-xs font-black text-white">
                  {officer.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <span className="text-sm font-bold text-[#0F172A]">{officer.name}</span>
                      <span className="ml-2 text-xs font-medium text-slate-400">{officer.role}</span>
                    </div>
                    <span className="text-sm font-bold text-[#0B8ED0]">{officer.completed}/{officer.tasks}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[#EEF6FB] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#0B8ED0] to-[#16C7F3] transition-all duration-500"
                      style={{ width: `${(officer.completed / officer.tasks) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI Delegation */}
      {activeTab === 'ai' && (
        <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600">
                <Bot size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">AI Task Suggestions</h2>
                <p className="text-sm font-medium text-slate-500">Smart delegation based on officer availability & skills</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { task: 'Review merchandise pricing', suggested: 'Daniel Reyes', reason: 'Treasurer — lowest current workload (2 active tasks)' },
                { task: 'Draft event budget proposal', suggested: 'Carlo Lim', reason: 'PRO — experience with past budgets, 3 active tasks' },
                { task: 'Coordinate venue booking', suggested: 'Mika Santos', reason: 'VP Internal — handles logistics, 2 active tasks' },
              ].map((suggestion, i) => (
                <div key={i} className="rounded-lg border border-violet-100 bg-violet-50/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-[#0F172A]">{suggestion.task}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        <span className="text-violet-600 font-bold">→ {suggestion.suggested}</span> · {suggestion.reason}
                      </p>
                    </div>
                    <button className="shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 transition">
                      <Zap size={12} />
                      Assign
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-[#0F172A]">How AI Delegation Works</h3>
            <div className="mt-4 space-y-3">
              {[
                'Analyzes each officer\'s current workload and active tasks',
                'Considers past performance on similar task types',
                'Balances distribution to prevent officer burnout',
                'Prioritizes by deadline urgency and task dependencies',
                'Suggests reassignment when officers are overloaded',
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

      {/* Create Task Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">Create Task</h2>
              <button onClick={() => setShowForm(false)} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setShowForm(false); }}>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Task Title</label>
                <input type="text" placeholder="e.g. Prepare election materials" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea rows={3} placeholder="Task details..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Assign To</label>
                  <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                    <option>Maria Santos</option>
                    <option>Daniel Reyes</option>
                    <option>Alyssa Mariano</option>
                    <option>Carlo Lim</option>
                    <option>Mika Santos</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-[#0F172A]">Due Date</label>
                  <input type="date" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#0F172A]">Priority</label>
                <select className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]">
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button type="submit" className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition">Create Task</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
