import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Eye,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { getTasks, createTask, deleteTask, previewTaskRecommendation, updateTask, updateTaskStatus } from '../../../services/taskService';
import { Button, Drawer, EmptyState, ErrorState, Field, FlowStepper, Input, NextStep, PageHeader, SegmentedControl, Select, SkeletonTable, StatusBadge } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getUsers } from '../../../services/userService';
import { getEvents } from '../../../services/eventService';
import { getAcademicPeriods } from '../../../services/systemAdministrationService';
import PaginationControls from '../../../components/PaginationControls';
import EngineBadge from '../../../components/ai/EngineBadge';
import { fetchAllPages, listMeta, unwrapList } from '../../../services/pagination';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import TableFilterBar from '../../../components/TableFilterBar';
import TableRowActions from '../../../components/TableRowActions';
import { taskLifecycle, toNextStepProps } from '../../../lib/lifecycle';
import { getBreadcrumbs, getPageMeta } from '../../../lib/pageMeta';
import useRecordParam from '../../../lib/useRecordParam';

function getDelegationDetail(source) {
  if (!source || typeof source !== 'object') return null;
  const container = source.delegation && typeof source.delegation === 'object'
    ? source.delegation
    : source.delegation_snapshot && typeof source.delegation_snapshot === 'object'
      ? source.delegation_snapshot
      : source;
  const rankings = Array.isArray(container.rankings) ? container.rankings : null;
  const evaluations = Array.isArray(container.evaluations) ? container.evaluations : null;
  const weights = container.weights && typeof container.weights === 'object' ? container.weights : null;
  const eligibilityRules = Array.isArray(container.eligibility_rules) ? container.eligibility_rules : null;
  const taskArea = container.task_area ?? container.inferred_task_area ?? null;
  const engine = container.engine ?? container.delegation_engine ?? null;
  const recommendedOfficerId = container.recommended_officer_id ?? null;

  if (!rankings && !weights && !eligibilityRules && !taskArea && !engine) return null;

  return { rankings, evaluations, weights, eligibilityRules, taskArea, engine, recommendedOfficerId };
}

function formatWeightLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function capitalize(s) {
  return s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '-';
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A task nobody has started is the normal state, so it reads as plain text and only the others get a badge.
function TaskStatus({ task }) {
  const status = task.workflow_status || task.status;
  if (status === 'pending') return <span className="text-xs text-ink-muted">Pending</span>;
  return <StatusBadge status={status} label={capitalize(status)} />;
}

export default function TasksPage({ initialTab = 'board' }) {
  const navigate = useNavigate();
  const { pathname, search: locationSearch } = useLocation();
  const [recordId, setRecordId] = useRecordParam();
  const [tasks, setTasks] = useState([]);
  const [tasksMeta, setTasksMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 10 });
  const [allTasks, setAllTasks] = useState([]);
  const [statusTotals, setStatusTotals] = useState({ pending: 0, in_progress: 0, overdue: 0 });
  const [officers, setOfficers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [taskFilters, setTaskFilters] = useState({ status: '', assignee: '', event: '', type: '', priority: '', deadline: '' });
  const [academicPeriods, setAcademicPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [page, setPage] = useState(1);
  const [detailTask, setDetailTask] = useState(null);
  const [totalsLoaded, setTotalsLoaded] = useState(false);
  const [progressForm, setProgressForm] = useState({ progress_percent: 0, progress_note: '' });
  const [progressSaving, setProgressSaving] = useState(false);
  const [completionTask, setCompletionTask] = useState(null);
  const [lastDelegation, setLastDelegation] = useState(null);
  const [rankingOpen, setRankingOpen] = useState(true);
  const pageSize = 10;

  const [form, setForm] = useState({ title: '', description: '', task_kind: 'standalone', category: 'coordination', preferred_role: '', priority: 'medium', assigned_to: '', event_id: '', deadline: '', status: 'pending' });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [formError, setFormError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState(null);
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const editFormRef = useRef(null);
  const [editSaving, setEditSaving] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const currentUserRole = (() => {
    try { return JSON.parse(localStorage.getItem('user') ?? '{}')?.role ?? ''; }
    catch { return ''; }
  })();
  const canManageTasks = currentUserRole === 'ADMIN';
  const canUpdateAssignedTasks = currentUserRole === 'SBO_OFFICER';
  const viewingHistory = Boolean(selectedPeriodId) && Number(selectedPeriodId) !== academicPeriods.find((period) => period.status === 'active')?.id;
  const canEditTasks = (canManageTasks || canUpdateAssignedTasks) && !viewingHistory;
  const query = new URLSearchParams(locationSearch);
  const activeTab = initialTab === 'ai' ? 'ai'
    : canManageTasks && (initialTab === 'create' || query.get('new') === '1') ? 'create'
      : canManageTasks && (initialTab === 'progress' || query.get('view') === 'progress') ? 'progress'
        : 'board';
  const listedTask = recordId ? [...tasks, ...allTasks].find((task) => String(task.id) === recordId) ?? null : null;
  const selectedTask = recordId ? (detailTask && String(detailTask.id) === recordId ? detailTask : listedTask) : null;
  const selectedTaskPeriod = academicPeriods.find((period) => period.id === selectedTask?.academic_semester_id);

  function showView(view) {
    const next = new URLSearchParams();
    if (view === 'create') next.set('new', '1');
    if (view === 'progress') next.set('view', 'progress');
    const search = next.toString();
    navigate({ pathname: initialTab === 'board' ? pathname : '/dashboard/tasks/task-board', search: search ? `?${search}` : '' });
  }

  function closeDetails() {
    setDetailTask(null);
    setRecordId(null);
  }

  useEffect(() => { getAcademicPeriods().then(setAcademicPeriods).catch(() => setAcademicPeriods([])); }, []);

  // Memoised so it is a stable dependency for the load effect below; a fresh object
  // each render would refire the effect on every render.
  const serverFilters = useMemo(() => ({
    ...(taskFilters.status ? { status: taskFilters.status } : {}),
    ...(taskFilters.assignee ? { assigned_to: taskFilters.assignee } : {}),
    ...(taskFilters.event ? { event_id: taskFilters.event } : {}),
    ...(taskFilters.type ? { task_kind: taskFilters.type } : {}),
    ...(taskFilters.priority ? { priority: taskFilters.priority } : {}),
    ...(taskFilters.deadline ? { deadline_from: taskFilters.deadline, deadline_to: taskFilters.deadline } : {}),
    ...(selectedPeriodId ? { academic_semester_id: selectedPeriodId } : {}),
  }), [taskFilters, selectedPeriodId]);

  function load() {
    setLoading(true);
    setError(null);
    const usersRequest = canManageTasks ? fetchAllPages(getUsers, { role: 'SBO_OFFICER', account_status: 'active' }) : Promise.resolve([]);
    const eventsRequest = canManageTasks ? fetchAllPages((p) => getEvents({ ...p, academic_semester_id: selectedPeriodId || undefined }).then((r) => r.data)) : Promise.resolve([]);
    // Summaries use the same filters but refresh independently of board pagination.
    Promise.all([
      getTasks({ page, per_page: pageSize, ...serverFilters }),
      usersRequest,
      eventsRequest,
    ])
      .then(([taskRes, allUsers, eventList]) => {
        setTasks(unwrapList(taskRes.data));
        setTasksMeta(listMeta(taskRes.data));
        setOfficers(allUsers.filter((u) => u.role === 'SBO_OFFICER' && u.position_title?.trim()));
        setEvents(eventList);
      })
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }

  function loadTotals() {
    let current = true;
    const totalFor = (field, value) => serverFilters[field] && serverFilters[field] !== value
      ? Promise.resolve({ data: { data: [], current_page: 1, total: 0 } })
      : getTasks({ ...serverFilters, [field]: value, per_page: 1 });
    Promise.all([
      totalFor('status', 'pending'),
      totalFor('status', 'in_progress'),
      totalFor('status', 'overdue'),
      fetchAllPages((p) => getTasks(p).then((r) => r.data), serverFilters),
    ])
      .then(([pendingRes, inProgressRes, overdueRes, fullTasks]) => {
        if (!current) return;
        setStatusTotals({
          pending: listMeta(pendingRes.data).total,
          in_progress: listMeta(inProgressRes.data).total,
          overdue: listMeta(overdueRes.data).total,
        });
        setAllTasks(fullTasks);
        setTotalsLoaded(true);
      })
      .catch(() => { if (current) setError('Failed to load task summaries.'); });
    return () => { current = false; };
  }

  useEffect(load, [canManageTasks, page, serverFilters, selectedPeriodId]);
  useEffect(loadTotals, [canManageTasks, serverFilters]);

  useEffect(() => {
    if (!recordId) {
      setDetailTask(null);
      return;
    }
    if (listedTask) {
      if (!detailTask || String(detailTask.id) !== recordId) {
        setDetailTask(listedTask);
        setProgressForm({ progress_percent: listedTask.progress_percent ?? 0, progress_note: '' });
      }
    } else if (totalsLoaded && !loading && !(detailTask && String(detailTask.id) === recordId)) {
      notify.error('That task is not in this list.');
      setRecordId(null);
    }
  }, [recordId, listedTask, detailTask, totalsLoaded, loading, setRecordId]);

  useEffect(() => {
    if (Object.keys(editFieldErrors).length) editFormRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [editFieldErrors]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title || !form.deadline || !form.assigned_to || (form.task_kind === 'event_related' && !form.event_id)) return;
    setFormSubmitting(true);
    setFormError(null);
    setCreateSuccess('');
    try {
      const res = await createTask({
        title: form.title,
        description: form.description,
        task_kind: form.task_kind,
        category: form.category,
        preferred_role: form.preferred_role || null,
        priority: form.priority,
        assigned_to: form.assigned_to,
        event_id: form.task_kind === 'event_related' ? form.event_id : null,
        deadline: form.deadline,
        status: form.status,
      });
      const detail = getDelegationDetail(res.data);
      if (detail) setLastDelegation({ taskId: res.data.id, ...detail });
      setCreateSuccess(`Task “${res.data.title}” was created${res.data.assignee ? ` and assigned to ${res.data.assignee.first_name} ${res.data.assignee.last_name}` : ''}.`);
      setForm({ title: '', description: '', task_kind: 'standalone', category: 'coordination', preferred_role: '', priority: 'medium', assigned_to: '', event_id: '', deadline: '', status: 'pending' });
      setPreview(null);
      load();
      loadTotals();
    } catch (err) {
      setFormError(err.response?.data?.message ?? 'Failed to create task.');
    } finally {
      setFormSubmitting(false);
    }
  }

  function openEditTask(task) {
    setEditError(null);
    setEditFieldErrors({});
    setEditingTask(task);
    setEditForm({
      title: task.title || '',
      description: task.description || '',
      task_kind: task.event_id ? 'event_related' : 'standalone',
      category: task.category || 'coordination',
      priority: task.priority || 'medium',
      assigned_to: task.assigned_to ? String(task.assigned_to) : '',
      event_id: task.event_id ? String(task.event_id) : '',
      deadline: String(task.deadline || '').slice(0, 10),
    });
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    const missing = {};
    if (!editForm.title.trim()) missing.title = 'Enter a task title.';
    if (editForm.task_kind === 'event_related' && !editForm.event_id) missing.event_id = 'Pick the event this task belongs to.';
    if (!editForm.assigned_to) missing.assigned_to = 'Choose who is assigned.';
    if (!editForm.deadline) missing.deadline = 'Pick a deadline.';
    setEditFieldErrors(missing);
    if (Object.keys(missing).length) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateTask(editingTask.id, {
        title: editForm.title.trim(),
        description: editForm.description,
        task_kind: editForm.task_kind,
        category: editForm.category,
        priority: editForm.priority,
        event_id: editForm.task_kind === 'event_related' ? editForm.event_id : null,
        deadline: editForm.deadline,
        ...(editForm.assigned_to !== String(editingTask.assigned_to ?? '') ? { assigned_to: editForm.assigned_to } : {}),
      });
      notify.success(`"${editForm.title.trim()}" updated.`);
      setEditingTask(null);
      closeDetails();
      load();
      loadTotals();
    } catch (err) {
      const serverErrors = err?.response?.data?.errors || {};
      const mapped = Object.fromEntries(['title', 'event_id', 'assigned_to', 'deadline']
        .filter((key) => serverErrors[key]?.[0])
        .map((key) => [key, serverErrors[key][0]]));
      if (Object.keys(mapped).length) setEditFieldErrors(mapped);
      else setEditError(getApiErrorMessage(err, 'Could not save this task.'));
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmDeleteTask() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteTask(taskToDelete.id);
      notify.success(`"${taskToDelete.title}" deleted.`);
      if (String(taskToDelete.id) === recordId) closeDetails();
      setTaskToDelete(null);
      load();
      loadTotals();
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, 'Could not delete this task.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function loadRecommendation() {
    if (!form.title.trim()) return;
    setPreviewLoading(true);
    setFormError(null);
    try {
      const response = await previewTaskRecommendation({ title: form.title, task_type: 'regular', category: form.category, preferred_role: form.preferred_role || null });
      setPreview(response.data.delegation);
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || 'Unable to evaluate officers.');
    } finally {
      setPreviewLoading(false);
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
      load();
      loadTotals();
      setDetailTask((current) => (current?.id === id ? res.data : current));
      return res.data;
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to update task status.');
      throw err;
    }
  }

  function openTaskDetails(task) {
    setDetailTask(task);
    setProgressForm({ progress_percent: task.progress_percent ?? 0, progress_note: '' });
    setRecordId(task.id);
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

  // Stat cards read the exact per-status totals fetched by loadTotals(), never
  // the loaded board page or a truncated walk of the whole table.
  const matchesTaskQuery = (t) => { const q = search.trim().toLowerCase(); return !q || [t.title, t.description, t.assignee?.first_name, t.assignee?.last_name, t.assignee?.position_title, t.event?.title].filter(Boolean).join(' ').toLowerCase().includes(q); };
  const matchingAllTasks = (allTasks.length ? allTasks : tasks).filter(matchesTaskQuery);
  const counts = search.trim() ? matchingAllTasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), { pending: 0, in_progress: 0, overdue: 0 }) : statusTotals;
  const activeDelegation = lastDelegation ?? (() => { const latest = [...allTasks, ...tasks].sort((a, b) => Number(b.id) - Number(a.id)).find((t) => getDelegationDetail(t)); return latest ? { taskId: latest.id, ...getDelegationDetail(latest) } : null; })();

  // /tasks has no text-search filter, so search narrows only the page on screen;
  // status/assignee/event/type are applied server-side in load().
  const filteredTasks = tasks.filter((t) => {
    const query = search.toLowerCase();
    const searchable = [t.title, t.description, t.assignee?.first_name, t.assignee?.last_name, t.assignee?.position_title, t.event?.title].filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(query);
  });

  useEffect(() => {
    setPage(1);
  }, [taskFilters]);

  async function exportVisibleTasks() {
    // Export every task matching the active filters, not just the page on screen.
    const exportRows = await fetchAllPages((p) => getTasks(p).then((r) => r.data), serverFilters);
    const header = ['Task ID', 'Title', 'Description', 'Type', 'Assignee', 'Role', 'Position', 'Department', 'Program', 'Year Level', 'Section', 'Related Event', 'Status', 'Progress Percent', 'Deadline', 'Completed At', 'Assigned By', 'Created At', 'Updated At'];
    const rows = exportRows.map((task) => [task.id, task.title, task.description, task.task_type, task.assignee ? `${task.assignee.first_name} ${task.assignee.last_name}` : '', task.assignee?.role, task.assignee?.position_title, task.assignee?.department, task.assignee?.program, task.assignee?.year_level, task.assignee?.section, task.event?.title, task.status, task.progress_percent, task.deadline, task.completed_at, task.creator ? `${task.creator.first_name} ${task.creator.last_name}` : '', task.created_at, task.updated_at]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  const workloadByAssignee = allTasks.reduce((acc, t) => {
    if (!t.assignee) return acc;
    const key = t.assignee.school_id ?? t.assignee.id;
    if (!acc[key]) acc[key] = { user: t.assignee, total: 0, completed: 0, tasks: [] };
    acc[key].total += 1;
    if (t.status === 'completed') acc[key].completed += 1;
    acc[key].tasks.push(t);
    return acc;
  }, {});
  const scoredAssignments = allTasks
    .filter((task) => task.assignee && Number.isFinite(Number(task.final_score)))
    .sort((a, b) => Number(b.final_score) - Number(a.final_score))
    .slice(0, 5);
  const activeTaskFilters = [
    search.trim() && `Search: ${search.trim()}`,
    taskFilters.status && `Status: ${capitalize(taskFilters.status)}`,
    taskFilters.assignee && `Assignee: ${officers.find((officer) => String(officer.school_id) === String(taskFilters.assignee))?.first_name || taskFilters.assignee}`,
    taskFilters.event && `Event: ${events.find((event) => String(event.id) === String(taskFilters.event))?.title || taskFilters.event}`,
    taskFilters.type && `Type: ${taskFilters.type === 'standalone' ? 'Standalone' : 'Event-related'}`,
    taskFilters.priority && `Priority: ${capitalize(taskFilters.priority)}`,
    taskFilters.deadline && `Deadline: ${taskFilters.deadline}`,
  ].filter(Boolean);

  const clearTaskFilters = () => {
    setSearch('');
    setTaskFilters({ status: '', assignee: '', event: '', type: '', priority: '', deadline: '' });
    setPage(1);
  };

  const viewTitle = activeTab === 'create' ? 'New task' : activeTab === 'progress' ? 'Task progress' : null;
  const routeMeta = getPageMeta(pathname, currentUserRole);
  const headerBreadcrumbs = viewTitle && viewTitle !== routeMeta.title
    ? [...getBreadcrumbs(pathname, currentUserRole).slice(0, -1), { label: routeMeta.title, to: pathname }, { label: viewTitle }]
    : undefined;

  function startTask(task) {
    handleStatusChange(task.id, 'in_progress', 'Task work started.', Math.max(1, task.progress_percent ?? 0))
      .catch((err) => notify.error(getApiErrorMessage(err, 'Failed to update task status.')));
  }

  function taskNextStep(task) {
    const props = toNextStepProps(taskLifecycle(task, currentUserRole));
    if (props.tone !== 'action' || !props.primary) return props;
    if (!canEditTasks) return { ...props, primary: undefined };
    const action = (run) => () => run().catch((err) => notify.error(getApiErrorMessage(err, 'Failed to update task status.')));
    if (task.status === 'pending') {
      if (task.workflow_status === 'blocked') {
        return { ...props, primary: { label: props.primary.label, disabledReason: task.dependency ? `Blocked by ${formatDisplayText(task.dependency.title)}. Finish that task first.` : 'This task is blocked by another task.' } };
      }
      return { ...props, primary: { label: props.primary.label, onClick: action(() => handleStatusChange(task.id, 'in_progress', 'Task work started.', Math.max(1, task.progress_percent ?? 0))) } };
    }
    return { ...props, primary: { label: props.primary.label, onClick: () => setCompletionTask(task) } };
  }

  function taskStepper(task) {
    const lifecycle = taskLifecycle(task, currentUserRole);
    return <FlowStepper variant="compact" steps={lifecycle.steps} summary={lifecycle.nextAction.title} ariaLabel={`Stage of ${formatDisplayText(task.title)}`} className="mt-2" />;
  }

  const firstRunTasks = tasksMeta.total === 0 && activeTaskFilters.length === 0;

  const periodSelect = academicPeriods.length > 0 && activeTab !== 'create' && (
    <Field label="Academic period" className="max-w-xs">
      <Select filter value={selectedPeriodId} onChange={(event) => { setSelectedPeriodId(event.target.value); closeDetails(); setPage(1); }}>
        <option value="">Active period</option>
        {academicPeriods.map((period) => <option key={period.id} value={period.id}>AY {period.academic_year.label} · {period.number === 1 ? '1st' : '2nd'} Semester · {period.status}</option>)}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={viewTitle ?? undefined}
        breadcrumbs={headerBreadcrumbs}
        meta={canManageTasks && (activeTab === 'board' || activeTab === 'progress') ? (
          <div role="group" aria-label="Task view">
            <SegmentedControl options={[{ value: 'board', label: 'Board' }, { value: 'progress', label: 'Progress' }]} value={activeTab} onChange={showView} />
          </div>
        ) : undefined}
        actions={activeTab === 'create' ? <Button variant="secondary" onClick={() => showView('board')}>Back to tasks</Button> : undefined}
        primary={canManageTasks && !viewingHistory && (activeTab === 'board' || activeTab === 'progress') ? <Button leftIcon={Plus} onClick={() => showView('create')}>New task</Button> : undefined}
      />
      {periodSelect}
      {viewingHistory && <p className="text-sm text-ink-muted">Completed semester tasks are available for viewing only.</p>}

      {activeTab === 'board' && (
        <section aria-label="Task counts" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[['Pending', 'pending'], ['In progress', 'in_progress'], ['Overdue', 'overdue']].map(([label, status]) => {
            const active = taskFilters.status === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => setTaskFilters({ ...taskFilters, status: active ? '' : status })}
                className={`min-h-11 rounded-card border p-4 text-left transition-colors duration-150 hover:bg-subtle ${active ? 'border-brand-600 bg-brand-600/10' : 'border-line bg-surface'}`}
              >
                <p className="text-xs font-medium text-ink-muted">{label}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-ink">{counts[status] || 0}</p>
              </button>
            );
          })}
        </section>
      )}

      {error && <ErrorState title="Tasks did not load" description={error} onRetry={load} />}

      {activeTab === 'create' && canManageTasks && (
        <section className="max-w-3xl">
          {createSuccess && <p role="status" className="mb-5 rounded-control border border-success/30 bg-success-tint px-3 py-2 text-sm font-medium text-success-strong">{createSuccess}</p>}
          {officers.length === 0 && <div className="mb-5 rounded-control border border-warning/40 bg-warning-tint p-3 text-sm text-warning-strong"><p className="font-semibold">Officer positions must be configured first.</p><p className="mt-1">Add SBO positions under Users &amp; Positions, then assign a position to an active SBO officer before creating a task.</p></div>}
          <form className="space-y-5" onSubmit={handleCreate} noValidate>
            <fieldset className="space-y-2"><legend className="text-[13px] font-medium text-ink">Task type</legend><div className="flex flex-wrap gap-3">{[['standalone', 'Standalone task'], ['event_related', 'Event-related task']].map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-control border border-line px-3 text-sm"><input type="radio" name="task-kind" checked={form.task_kind === value} onChange={() => setForm({ ...form, task_kind: value, event_id: '' })} />{label}</label>)}</div></fieldset>
            <Field label="Task title" required>
              <Input type="text" value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value, assigned_to: '' }); setPreview(null); }} placeholder="e.g. Prepare election materials" />
            </Field>
            <Field label="Description" optional>
              <RichTextEditor rows={5} value={form.description} onChange={(description) => setForm({ ...form, description })} placeholder="Describe the expected result, required materials, and completion criteria" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Assigned category" optional>
                <Select value={form.category} onChange={(event) => { setForm({ ...form, category: event.target.value, assigned_to: '' }); setPreview(null); }}>{['coordination', 'finance', 'publicity', 'documentation', 'logistics'].map((category) => <option key={category} value={category}>{capitalize(category)}</option>)}</Select>
              </Field>
              <Field label="Required position" optional>
                <Select value={form.preferred_role} onChange={(event) => { setForm({ ...form, preferred_role: event.target.value, assigned_to: '' }); setPreview(null); }}><option value="">Any eligible position</option>{[...new Set(officers.map((officer) => officer.position_title).filter(Boolean))].map((position) => <option key={position} value={position}>{position}</option>)}</Select>
              </Field>
              <Field label="Priority" optional>
                <Select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{['low', 'medium', 'high', 'critical'].map((priority) => <option key={priority} value={priority}>{capitalize(priority)}</option>)}</Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assign to" required>
                <Select disabled={!preview?.rankings?.length} value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}><option value="">Review recommendation first</option>{(preview?.rankings || []).map((officer) => <option key={officer.officer_id} value={officer.officer_id}>{formatDisplayText(officer.name)}{officer.position_title ? ` · ${formatDisplayText(officer.position_title)}` : ''}</option>)}</Select>
              </Field>
              {form.task_kind === 'event_related' && (
                <Field label="Related event" required>
                  <Select value={form.event_id} onChange={(e) => setForm({ ...form, event_id: e.target.value })}><option value="">Select an event</option>{events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}</Select>
                </Field>
              )}
              <Field label="Deadline" required>
                <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </Field>
              <Field label="Initial status">
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="pending">Pending</option><option value="in_progress">In Progress</option></Select>
              </Field>
            </div>
            <div className="border-t border-line pt-5">
              <Button variant="secondary" disabled={previewLoading || !form.title.trim()} onClick={loadRecommendation}>{previewLoading ? 'Evaluating...' : 'Review officer recommendation'}</Button>
              {preview?.rankings?.length ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-ink-muted">Admin chooses the final assignee.</p>
                  {preview.rankings.map((officer) => (
                    <button key={officer.officer_id} type="button" aria-pressed={String(form.assigned_to) === String(officer.officer_id)} onClick={() => setForm({ ...form, assigned_to: String(officer.officer_id) })} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-control border px-3 text-left text-sm hover:bg-subtle ${String(form.assigned_to) === String(officer.officer_id) ? 'border-brand-600 bg-brand-600/10' : 'border-line bg-surface'}`}>
                      <span>{formatDisplayText(officer.name)} · {formatDisplayText(officer.position_title)}{officer.rank === 1 ? ' · Recommended' : ''}</span>
                      <span className="font-semibold tabular-nums">{officer.final_score}</span>
                    </button>
                  ))}
                </div>
              ) : preview && <p className="mt-2 text-sm text-warning-strong">No eligible officers are available.</p>}
            </div>
            {formError && <p role="alert" className="text-sm font-medium text-danger-strong">{formError}</p>}
            <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5">
              <Button variant="secondary" onClick={() => { setForm({ title: '', description: '', task_kind: 'standalone', category: 'coordination', preferred_role: '', priority: 'medium', assigned_to: '', event_id: '', deadline: '', status: 'pending' }); setPreview(null); setFormError(null); setCreateSuccess(''); }}>Clear form</Button>
              <Button type="submit" leftIcon={Plus} loading={formSubmitting} disabled={officers.length === 0 || !form.title || !form.deadline || !form.assigned_to || (form.task_kind === 'event_related' && !form.event_id)}>Create task</Button>
            </div>
          </form>
        </section>
      )}

      {activeTab === 'board' && (
        <section>
          <TableFilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search tasks, assignees, or events"
            activeFilters={activeTaskFilters}
            onClear={clearTaskFilters}
            resultCount={search.trim() ? matchingAllTasks.length : tasksMeta.total}
            resultLabel={tasksMeta.total === 1 ? 'task' : 'tasks'}
            secondaryClassName="grid gap-3 sm:grid-cols-3"
            actions={<Button variant="secondary" leftIcon={Download} onClick={exportVisibleTasks}>Export</Button>}
          >
            <Select filter aria-label="Filter tasks by status" value={taskFilters.status} onChange={(event) => setTaskFilters({ ...taskFilters, status: event.target.value })}><option value="">All statuses</option>{['pending', 'in_progress', 'completed', 'overdue'].map((value) => <option key={value} value={value}>{capitalize(value)}</option>)}</Select>
            {canManageTasks && <Select filter aria-label="Filter tasks by assignee" value={taskFilters.assignee} onChange={(event) => setTaskFilters({ ...taskFilters, assignee: event.target.value })}><option value="">All assignees</option>{officers.map((officer) => <option key={officer.school_id} value={officer.school_id}>{formatDisplayText(officer.first_name)} {formatDisplayText(officer.last_name)}</option>)}</Select>}
            <Select filter aria-label="Filter tasks by event" value={taskFilters.event} onChange={(event) => setTaskFilters({ ...taskFilters, event: event.target.value })}><option value="">All events</option>{events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}</Select>
            <Select filter aria-label="Filter tasks by type" value={taskFilters.type} onChange={(event) => setTaskFilters({ ...taskFilters, type: event.target.value })}><option value="">All task types</option><option value="event_related">Event-related</option><option value="standalone">Standalone</option></Select>
            <Select filter aria-label="Filter tasks by priority" value={taskFilters.priority} onChange={(event) => setTaskFilters({ ...taskFilters, priority: event.target.value })}><option value="">All priorities</option>{['low', 'medium', 'high', 'critical'].map((priority) => <option key={priority} value={priority}>{capitalize(priority)}</option>)}</Select>
            <Input type="date" aria-label="Filter tasks by deadline" value={taskFilters.deadline} onChange={(event) => setTaskFilters({ ...taskFilters, deadline: event.target.value })} />
          </TableFilterBar>

          {loading ? (
            <SkeletonTable rows={5} columns={6} className="mt-4" />
          ) : filteredTasks.length === 0 ? (
            firstRunTasks ? (
              canManageTasks ? (
                <EmptyState
                  title="No tasks yet"
                  description={viewingHistory ? 'No tasks were recorded in this period.' : 'Create a task to give an officer something to do and a deadline to meet.'}
                  action={viewingHistory ? undefined : <Button variant="secondary" leftIcon={Plus} onClick={() => showView('create')}>Create your first task</Button>}
                />
              ) : (
                <EmptyState title="Nothing assigned to you yet" description="Your Admin delegates tasks here." />
              )
            ) : (
              <EmptyState
                kind="filtered"
                title={tasksMeta.total === 0 ? 'No tasks match these filters' : search.trim() ? 'No tasks on this page match your search' : 'No tasks on this page'}
                onClearFilters={activeTaskFilters.length > 0 ? clearTaskFilters : undefined}
              />
            )
          ) : (
            <>
            <ul className="divide-y divide-line lg:hidden" aria-label="Tasks">
              {filteredTasks.map((t) => <li key={t.id} className="min-w-0 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-semibold text-ink">{formatDisplayText(t.title)}</h3><TaskStatus task={t} /></div>
                {taskStepper(t)}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="min-w-0"><dt className="text-ink-muted">Assignee</dt><dd className="break-words font-medium text-ink">{t.assignee ? `${formatDisplayText(t.assignee.first_name)} ${formatDisplayText(t.assignee.last_name)}` : ''}</dd></div><div><dt className="text-ink-muted">Deadline</dt><dd className="font-medium text-ink">{formatDate(t.deadline)}</dd></div><div className="col-span-2 min-w-0"><dt className="text-ink-muted">Related event</dt><dd className="break-words font-medium text-ink">{formatDisplayText(t.event?.title) || 'General organization task'}</dd></div></dl>
                <div className="mt-3 h-1.5 overflow-hidden rounded bg-line" role="progressbar" aria-label="Task progress" aria-valuenow={Number(t.progress_percent || 0)} aria-valuemin="0" aria-valuemax="100"><div className="h-full rounded bg-brand-700" style={{ width: `${Math.min(100, Number(t.progress_percent || 0))}%` }} /></div><p className="mt-1 text-xs tabular-nums text-ink-muted">{t.progress_percent || 0}% complete</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => openTaskDetails(t)}>View details</Button>{canEditTasks && t.status === 'pending' && t.workflow_status !== 'blocked' && <Button variant="secondary" onClick={() => handleStatusChange(t.id, 'in_progress', 'Task work started.', Math.max(1, t.progress_percent ?? 0))}>Start</Button>}{canEditTasks && ['in_progress', 'overdue'].includes(t.status) && <Button variant="secondary" onClick={() => setCompletionTask(t)}>Complete</Button>}{canManageTasks && !viewingHistory && t.status === 'completed' && <Button variant="secondary" onClick={() => handleStatusChange(t.id, 'pending', 'Task reopened by an administrator.', 0)}>Reopen</Button>}{canManageTasks && !viewingHistory && <Button variant="secondary" onClick={() => openEditTask(t)}>Edit</Button>}{canManageTasks && !viewingHistory && <Button variant="secondary" className="text-danger-strong" onClick={() => { setDeleteError(null); setTaskToDelete(t); }}>Delete</Button>}</div>
              </li>)}
            </ul>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[960px] text-left">
                <caption className="sr-only">Tasks</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Task</th>
                    <th scope="col" className="px-4 py-2.5">Assignee</th>
                    <th scope="col" className="px-4 py-2.5">Related event</th>
                    <th scope="col" className="px-4 py-2.5">Deadline</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Progress</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {filteredTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-subtle">
                      <td className="max-w-[260px] px-4 py-2.5"><p className="font-medium text-ink">{formatDisplayText(t.title)}</p><RichTextBody value={t.description || ''} className="mt-0.5 line-clamp-1 text-xs text-ink-muted" /></td>
                      <td className="px-4 py-2.5 text-ink">{t.assignee ? `${formatDisplayText(t.assignee.first_name)} ${formatDisplayText(t.assignee.last_name)}` : ''}<p className="text-xs text-ink-muted">{formatDisplayText(t.assignee?.position_title) || t.assignee?.role?.replaceAll('_', ' ') || ''}</p></td>
                      <td className="px-4 py-2.5 text-ink">{formatDisplayText(t.event?.title) || ''}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink">{formatDate(t.deadline)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink">{t.progress_percent || 0}%</td>
                      <td className="px-4 py-2.5">
                        <TaskStatus task={t} />
                        <div className="w-44">{taskStepper(t)}</div>
                      </td>
                      <td className="px-4 py-2.5"><div className="flex items-center justify-end gap-2">
                        {canUpdateAssignedTasks && !viewingHistory && t.status === 'pending' && t.workflow_status !== 'blocked' && (
                          <Button variant="secondary" size="sm" onClick={() => startTask(t)}>Start</Button>
                        )}
                        {canUpdateAssignedTasks && !viewingHistory && ['in_progress', 'overdue'].includes(t.status) && (
                          <Button variant="secondary" size="sm" onClick={() => setCompletionTask(t)}>Complete</Button>
                        )}
                        <TableRowActions subject={t.title} label="Task actions" actions={[
                          { label: 'View task', icon: Eye, onClick: () => openTaskDetails(t) },
                          canUpdateAssignedTasks && !viewingHistory && t.status === 'pending' && t.workflow_status !== 'blocked' && { label: 'Start', icon: CheckCircle2, onClick: () => startTask(t) },
                          canUpdateAssignedTasks && !viewingHistory && ['in_progress', 'overdue'].includes(t.status) && { label: 'Complete', icon: CheckCircle2, onClick: () => setCompletionTask(t) },
                          canManageTasks && !viewingHistory && t.status === 'completed' && { label: 'Reopen task', icon: Clock, onClick: () => handleStatusChange(t.id, 'pending', 'Task reopened by an administrator.', 0) },
                          canManageTasks && !viewingHistory && { label: 'Edit task', icon: Pencil, onClick: () => openEditTask(t) },
                          canManageTasks && !viewingHistory && { label: 'Delete task', icon: Trash2, danger: true, onClick: () => { setDeleteError(null); setTaskToDelete(t); } },
                        ]} />
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          <PaginationControls
            currentPage={tasksMeta.currentPage}
            totalItems={tasksMeta.total}
            pageSize={tasksMeta.perPage}
            onPageChange={setPage}
            label="tasks"
          />
        </section>
      )}

      {activeTab === 'progress' && (
        <section>
          <h2 className="text-base font-semibold text-ink">Officer Workload</h2>
          <p className="mb-4 text-sm text-ink-muted">Completed and total tasks for each officer.</p>
          {loading || !totalsLoaded ? (
            <SkeletonTable rows={3} columns={3} />
          ) : Object.keys(workloadByAssignee).length === 0 ? (
            <EmptyState
              title="No assigned tasks yet"
              description="Progress per officer appears here once a task is assigned."
              action={viewingHistory ? undefined : <Button variant="secondary" leftIcon={Plus} onClick={() => showView('create')}>Create your first task</Button>}
            />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {Object.values(workloadByAssignee).map((entry) => (
                <li key={entry.user.school_id ?? entry.user.id} className="flex items-start gap-4 py-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                    {entry.user.first_name?.[0]}{entry.user.last_name?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-ink">
                        {formatDisplayText(entry.user.first_name)} {formatDisplayText(entry.user.last_name)}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-ink">{entry.completed}/{entry.total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-line">
                      <div
                        className="h-full rounded bg-brand-600"
                        style={{ width: `${entry.total > 0 ? (entry.completed / entry.total) * 100 : 0}%` }}
                      />
                    </div>
                    <details className="mt-3 text-xs">
                      <summary className="min-h-11 cursor-pointer py-2 font-medium text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600">Show {entry.total} task{entry.total === 1 ? '' : 's'} and progress</summary>
                      <ul className="pt-1">
                        {entry.tasks.map((task) => <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft py-2"><span className="min-w-0 font-medium text-ink">{formatDisplayText(task.title)}</span><span className="tabular-nums text-ink-muted">{capitalize(task.status)} · {Number(task.progress_percent || 0)}%</span><Button variant="secondary" size="sm" onClick={() => openTaskDetails(task)}>View details</Button></li>)}
                      </ul>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'ai' && (
        <section className="grid gap-8 xl:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="text-base font-semibold text-ink">AI Task Suggestions</h2>
            <p className="mb-4 text-sm text-ink-muted">How well each officer fits a task.</p>

            {activeDelegation?.rankings?.length > 0 && (
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => setRankingOpen((current) => !current)}
                  aria-expanded={rankingOpen}
                  className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-brand-700">
                    <ChevronDown size={14} className={`transition-transform duration-150 ${rankingOpen ? 'rotate-180' : ''}`} />
                    Full officer ranking
                  </span>
                  <EngineBadge engine={activeDelegation.engine} />
                </button>
                {rankingOpen && (
                  <div className="mt-3">
                    {activeDelegation.taskArea && (
                      <>
                        <p className="text-xs text-ink-muted-strong">Inferred task area: <span className="text-ink">{activeDelegation.taskArea}</span></p>
                        {(activeDelegation.evaluations || []).some((ev) => ev.eligibility_result && ev.eligibility_result !== 'eligible') && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(activeDelegation.evaluations || []).filter((ev) => ev.eligibility_result && ev.eligibility_result !== 'eligible').map((ev) => (
                              <StatusBadge key={`ineligible-${ev.officer_id}`} tone="warning" label={`${formatDisplayText(ev.name)} (${String(ev.eligibility_result).replaceAll('_', ' ')})`} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <div className="mt-3 divide-y divide-line">
                      {activeDelegation.rankings.map((ranking) => {
                        const isRecommended = activeDelegation.recommendedOfficerId != null
                          && String(ranking.officer_id) === String(activeDelegation.recommendedOfficerId);
                        const positionScore = ranking.position_score ?? ranking.role_score;
                        const positionTier = ranking.position_tier ?? ranking.position_relevance_tier ?? ranking.relevance_tier ?? null;
                        return (
                          <div key={ranking.officer_id} className="py-3 first:pt-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-ink">
                                {formatDisplayText(ranking.name)}
                                {isRecommended && <StatusBadge tone="active" label="Recommended" className="ml-2" />}
                                {positionTier && <StatusBadge tone="neutral" label={positionTier} className="ml-2" />}
                              </p>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-muted sm:grid-cols-4">
                              {positionScore != null && (
                                <span>Position <strong className="block font-semibold tabular-nums text-ink">{Number(positionScore).toFixed(2)}{activeDelegation.weights?.role != null && ` (×${(activeDelegation.weights.role * 100).toFixed(0)}%)`}{activeDelegation.weights?.position != null && ` (×${(activeDelegation.weights.position * 100).toFixed(0)}%)`}</strong></span>
                              )}
                              {ranking.workload_score != null && (
                                <span>Workload <strong className="block font-semibold tabular-nums text-ink">{Number(ranking.workload_score).toFixed(2)}{activeDelegation.weights?.workload != null && ` (×${(activeDelegation.weights.workload * 100).toFixed(0)}%)`}</strong></span>
                              )}
                              {ranking.performance_score != null && (
                                <span>Performance <strong className="block font-semibold tabular-nums text-ink">{Number(ranking.performance_score).toFixed(2)}{activeDelegation.weights?.performance != null && ` (×${(activeDelegation.weights.performance * 100).toFixed(0)}%)`}</strong></span>
                              )}
                              {ranking.recency_score != null && (
                                <span>Recency <strong className="block font-semibold tabular-nums text-ink">{Number(ranking.recency_score).toFixed(2)}{activeDelegation.weights?.recency != null && ` (×${(activeDelegation.weights.recency * 100).toFixed(0)}%)`}</strong></span>
                              )}
                            </div>
                            {ranking.explanation && <p className="mt-2 text-xs text-ink-muted">{ranking.explanation}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {scoredAssignments.length === 0 ? (
              <EmptyState title="No suggestions yet" description="Create a task to see the officer recommendation and its score breakdown." />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {scoredAssignments.map((task) => (
                  <li key={task.id} className="py-4">
                    <p className="text-sm font-semibold text-ink">{formatDisplayText(task.title)}</p>
                    <p className="mt-1 text-xs text-ink-muted-strong">
                      Recommended: {formatDisplayText(task.assignee.first_name)} {formatDisplayText(task.assignee.last_name)}
                    </p>
                    <div className="mt-2">
                      <EngineBadge engine={(task.id === activeDelegation?.taskId ? activeDelegation.engine : null) || getDelegationDetail(task)?.engine || null} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-muted sm:grid-cols-4">
                      <span>Role <strong className="block font-semibold tabular-nums text-ink">{Number(task.role_score).toFixed(2)}</strong></span>
                      <span>Workload <strong className="block font-semibold tabular-nums text-ink">{Number(task.workload_score).toFixed(2)}</strong></span>
                      <span>Performance <strong className="block font-semibold tabular-nums text-ink">{Number(task.performance_score).toFixed(2)}</strong></span>
                      {task.recency_score != null && <span>Recency <strong className="block font-semibold tabular-nums text-ink">{Number(task.recency_score).toFixed(2)}</strong></span>}
                    </div>
                    {task.ai_recommendation_note && <p className="mt-3 text-xs text-ink-muted">{task.ai_recommendation_note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-base font-semibold text-ink">How officers are ranked</h3>
            <ul className="mt-3 space-y-2">
              {(activeDelegation?.weights
                ? [
                  'Filters candidates to active, policy-eligible SBO Officers',
                  ...Object.entries(activeDelegation.weights).map(([key, value]) => `Weighs ${formatWeightLabel(key)} at ${(Number(value) * 100).toFixed(0)}%`),
                ]
                : [
                  'Filters candidates to active, policy-eligible SBO Officers',
                  'Scores by position fit, current workload, and completed-versus-overdue performance',
                  'Recommends the officer with the highest weighted fit score',
                ]
              ).map((item, i) => (
                <li key={i} className="text-sm text-ink-muted-strong">{item}</li>
              ))}
            </ul>
            {activeDelegation?.eligibilityRules?.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-semibold text-ink-muted">Eligibility rules for the latest request</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-ink-muted-strong">
                  {activeDelegation.eligibilityRules.map((rule, i) => <li key={i}>{rule}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {selectedTask && (
        <AccessibleOverlay label="Task details" onClose={closeDetails} closeOnBackdrop className="fixed inset-0 z-50 flex justify-end bg-navy-950/50">
          <div className="drawer-slide-in flex h-full w-full max-w-xl flex-col gap-5 overflow-y-auto border-l border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink">{formatDisplayText(selectedTask.title)}</h2>
                <p className="mt-1 text-sm text-ink-muted">{selectedTask.event_id ? 'Event task' : 'Standalone task'} · Due {formatDate(selectedTask.deadline)}</p>
                <div className="mt-2"><TaskStatus task={selectedTask} /></div>
                {selectedTask.workflow_status === 'blocked' && selectedTask.dependency && <p className="mt-1 text-xs font-medium text-warning-strong">Blocked by {formatDisplayText(selectedTask.dependency.title)}</p>}
              </div>
              <button type="button" aria-label="Close task details" onClick={closeDetails} className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-subtle"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              <FlowStepper variant="full" steps={taskLifecycle(selectedTask, currentUserRole).steps} ariaLabel="Task stages" />
              <NextStep {...taskNextStep(selectedTask)} />
            </div>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-ink">Description</h3>
              <RichTextBody value={selectedTask.description || 'No description provided.'} className="mt-2 text-sm text-ink-muted-strong" />
            </section>
            {selectedTask.event_id && <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-ink">Related event</h3>
              <p className="mt-2 text-sm text-ink">{formatDisplayText(selectedTask.event?.title) || 'No linked event'}</p>
              {selectedTask.event?.start_time && <p className="mt-1 text-xs text-ink-muted">Event date: {formatDate(selectedTask.event.start_time)}</p>}
              {selectedTask.task_type === 'workflow' && <p className="mt-1 text-xs text-ink-muted">Workflow: {capitalize(selectedTask.phase || 'Event workflow')}</p>}
              {selectedTask.ai_recommendation_note && <p className="mt-3 text-xs text-ink-muted">{selectedTask.ai_recommendation_note}</p>}
            </section>}

            <dl className="grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-ink-muted">Assigned officer</dt><dd className="mt-0.5 font-medium text-ink">{selectedTask.assignee ? `${formatDisplayText(selectedTask.assignee.first_name)} ${formatDisplayText(selectedTask.assignee.last_name)}` : 'Unassigned'}</dd></div>
              <div><dt className="text-xs text-ink-muted">Assigned by</dt><dd className="mt-0.5 font-medium text-ink">{selectedTask.creator ? `${formatDisplayText(selectedTask.creator.first_name)} ${formatDisplayText(selectedTask.creator.last_name)}` : ''}</dd></div>
              <div><dt className="text-xs text-ink-muted">Priority</dt><dd className="mt-0.5 font-medium text-ink">{capitalize(selectedTask.priority || 'medium')}</dd></div>
              <div><dt className="text-xs text-ink-muted">Category</dt><dd className="mt-0.5 font-medium text-ink">{capitalize(selectedTask.category || 'coordination')}</dd></div>
              <div><dt className="text-xs text-ink-muted">Required position</dt><dd className="mt-0.5 font-medium text-ink">{selectedTask.preferred_role || 'Any eligible position'}</dd></div>
              <div><dt className="text-xs text-ink-muted">Progress</dt><dd className="mt-0.5 font-medium tabular-nums text-ink">{selectedTask.progress_percent || 0}%</dd></div>
              <div><dt className="text-xs text-ink-muted">Academic period</dt><dd className="mt-0.5 font-medium text-ink">{selectedTaskPeriod ? `AY ${selectedTaskPeriod.academic_year?.label} · ${selectedTaskPeriod.number === 1 ? '1st' : '2nd'} Semester` : ''}</dd></div>
              <div><dt className="text-xs text-ink-muted">Created</dt><dd className="mt-0.5 font-medium text-ink">{formatDate(selectedTask.created_at)}</dd></div>
              {selectedTask.completed_at && <div><dt className="text-xs text-ink-muted">Completed</dt><dd className="mt-0.5 font-medium text-ink">{formatDate(selectedTask.completed_at)}</dd></div>}
            </dl>
            {!selectedTask.event_id && selectedTask.ai_recommendation_note && <p className="border-t border-line pt-4 text-xs text-ink-muted-strong">{selectedTask.ai_recommendation_note}</p>}

            {canEditTasks && selectedTask.status !== 'completed' && (
              <section className="border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-ink">Add progress update</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
                  <Field label="Progress (%)">
                    <Input type="number" min="0" max="99" value={progressForm.progress_percent} onChange={(e) => setProgressForm((current) => ({ ...current, progress_percent: e.target.value }))} />
                  </Field>
                  <Field label="Update note">
                    <Input value={progressForm.progress_note} onChange={(e) => setProgressForm((current) => ({ ...current, progress_note: e.target.value }))} placeholder="Describe what changed" />
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" loading={progressSaving} disabled={!progressForm.progress_note.trim()} onClick={saveProgressUpdate}>Save progress update</Button>
                  {canManageTasks && selectedTask.status === 'pending' && selectedTask.workflow_status !== 'blocked' && (
                    <Button variant="secondary" onClick={() => startTask(selectedTask)}>Mark in progress</Button>
                  )}
                  {canManageTasks && ['pending', 'in_progress', 'overdue'].includes(selectedTask.status) && selectedTask.workflow_status !== 'blocked' && (
                    <Button variant="secondary" onClick={() => setCompletionTask(selectedTask)}>Mark completed</Button>
                  )}
                </div>
              </section>
            )}
            {canManageTasks && !viewingHistory && selectedTask.status === 'completed' && (
              <section className="border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-ink">Reopen task</h3>
                <p className="mt-1 text-sm text-ink-muted">Reset this completed task to Not Started and clear its completion progress.</p>
                <Button variant="secondary" className="mt-3" onClick={() => handleStatusChange(selectedTask.id, 'pending', 'Task reopened by an administrator.', 0)}>Set to Not Started</Button>
              </section>
            )}

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-ink">Progress history</h3>
              {selectedTask.progress_updates?.length ? (
                <ul className="mt-3 divide-y divide-line-soft">
                  {selectedTask.progress_updates.map((update) => (
                    <li key={update.id} className="py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold tabular-nums text-ink">{capitalize(update.status)} · {update.progress_percent}%</p>
                        <p className="text-xs text-ink-muted">{new Date(update.created_at).toLocaleString('en-PH')}</p>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted-strong">{update.note || 'Status updated.'}</p>
                      {update.author && <p className="mt-1 text-xs text-ink-muted">By {formatDisplayText(update.author.first_name)} {formatDisplayText(update.author.last_name)}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-ink-muted">No progress updates yet.</p>}
            </section>
          </div>
        </AccessibleOverlay>
      )}

      <Drawer
        open={Boolean(editingTask)}
        title="Edit task"
        width="max-w-lg"
        onClose={editSaving ? undefined : () => setEditingTask(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditingTask(null)} disabled={editSaving}>Cancel</Button>
            <Button onClick={handleEditSubmit} loading={editSaving}>Save changes</Button>
          </>
        )}
      >
        {editForm && (
          <form ref={editFormRef} onSubmit={handleEditSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
            {editError && <p role="alert" className="text-sm font-semibold text-danger-strong sm:col-span-2">{editError}</p>}
            <Field label="Task title" required error={editFieldErrors.title} className="sm:col-span-2">
              <Input data-autofocus value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} />
            </Field>
            <Field label="Description" optional className="sm:col-span-2">
              <RichTextEditor rows={4} value={editForm.description} onChange={(description) => setEditForm({ ...editForm, description })} />
            </Field>
            <Field label="Task type">
              <Select value={editForm.task_kind} onChange={(event) => setEditForm({ ...editForm, task_kind: event.target.value, event_id: '' })}>
                <option value="standalone">Standalone task</option>
                <option value="event_related">Event-related task</option>
              </Select>
            </Field>
            {editForm.task_kind === 'event_related' && (
              <Field label="Related event" required error={editFieldErrors.event_id}>
                <Select value={editForm.event_id} onChange={(event) => setEditForm({ ...editForm, event_id: event.target.value })}>
                  <option value="">Select an event</option>
                  {events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Assigned category" optional>
              <Select value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}>
                {['coordination', 'finance', 'publicity', 'documentation', 'logistics'].map((category) => <option key={category} value={category}>{capitalize(category)}</option>)}
              </Select>
            </Field>
            <Field label="Priority" optional>
              <Select value={editForm.priority} onChange={(event) => setEditForm({ ...editForm, priority: event.target.value })}>
                {['low', 'medium', 'high', 'critical'].map((priority) => <option key={priority} value={priority}>{capitalize(priority)}</option>)}
              </Select>
            </Field>
            <Field label="Assigned officer" required error={editFieldErrors.assigned_to}>
              <Select value={editForm.assigned_to} onChange={(event) => setEditForm({ ...editForm, assigned_to: event.target.value })}>
                {!officers.some((officer) => String(officer.school_id) === editForm.assigned_to) && editForm.assigned_to && <option value={editForm.assigned_to}>{editingTask?.assignee ? `${formatDisplayText(editingTask.assignee.first_name)} ${formatDisplayText(editingTask.assignee.last_name)}` : editForm.assigned_to}</option>}
                {officers.map((officer) => <option key={officer.school_id} value={officer.school_id}>{formatDisplayText(officer.first_name)} {formatDisplayText(officer.last_name)} · {formatDisplayText(officer.position_title)}</option>)}
              </Select>
            </Field>
            <Field label="Deadline" required error={editFieldErrors.deadline}>
              <Input type="date" value={editForm.deadline} onChange={(event) => setEditForm({ ...editForm, deadline: event.target.value })} />
            </Field>
          </form>
        )}
      </Drawer>

      <ConfirmModal
        open={Boolean(taskToDelete)}
        title="Delete this task?"
        message="The task and its progress history are deleted. This cannot be undone."
        recordName={taskToDelete?.title}
        confirmText="Delete task"
        variant="danger"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => setTaskToDelete(null)}
        onConfirm={confirmDeleteTask}
      />

      <ConfirmModal
        open={Boolean(completionTask)}
        title="Confirm task completion"
        message={completionTask ? `Mark “${formatDisplayText(completionTask.title)}” as completed? Progress will be saved at 100% and the Admin will be notified.` : ''}
        confirmText="Confirm completion"
        variant="primary"
        onCancel={() => setCompletionTask(null)}
        onConfirm={async () => { await handleStatusChange(completionTask.id, 'completed', 'Task marked as completed.', 100); setCompletionTask(null); }}
      />
    </div>
  );
}
