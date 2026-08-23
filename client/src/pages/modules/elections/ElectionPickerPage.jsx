import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, CalendarDays, ChevronDown, ChevronRight, LoaderCircle, PencilLine, Power, PowerOff, Trash2 } from 'lucide-react';
import { createElection, deleteElection, getElections, updateElection } from '../../../services/electionService';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import ConfirmModal from '../../../components/ConfirmModal';
import { getApiErrorMessage } from '../../../utils/apiError';
import { isoToLocalDateTimeInput, localDateTimeToIso } from '../../../utils/dateTime';

const statusStyles = {
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  upcoming: 'bg-[#EEF6FB] text-[#0B8ED0] border-[#D5E8F5]',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

const accentByStatus = {
  pending_approval: 'border-l-amber-400',
  upcoming: 'border-l-[#0B8ED0]',
  active: 'border-l-[#16A34A]',
  closed: 'border-l-[#94A3B8]',
};

const statusLabels = {
  pending_approval: 'Pending Approval',
  upcoming: 'Upcoming',
  active: 'Live',
  closed: 'Closed',
};

function formatDateTime(dt) {
  if (!dt) {
    return '-';
  }

  return new Date(dt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatTimeline(status, startTime, endTime) {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return '';
  }

  const dayMs = 1000 * 60 * 60 * 24;

  if (status === 'active') {
    const daysLeft = Math.max(0, Math.ceil((end - now) / dayMs));
    return `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`;
  }

  if (status === 'upcoming') {
    const daysToStart = Math.max(0, Math.ceil((start - now) / dayMs));
    return `Starts in ${daysToStart} day${daysToStart === 1 ? '' : 's'}`;
  }

  const daysSinceEnd = Math.max(0, Math.ceil((now - end) / dayMs));
  return `Ended ${daysSinceEnd} day${daysSinceEnd === 1 ? '' : 's'} ago`;
}

function getVotingPeriodError(startTime, endTime) {
  if (!startTime || !endTime) {
    return 'Set both the voting start and end time.';
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 'Use a valid voting start and end time.';
  }

  if (end <= start) {
    return 'Voting end time must be after the start time.';
  }

  return '';
}

function getElectionVoteCount(election) {
  const count = Number(election?.votes_count ?? election?.votes?.length ?? 0);
  return Number.isFinite(count) ? count : 0;
}

export default function ElectionPickerPage({ onSelect }) {
  const navigate = useNavigate();
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const role = currentUser?.role || 'SBO_OFFICER';
  const canManageElections = currentUser?.role === 'ADMIN';
  const canManageCandidates = currentUser?.role === 'ADMIN' || currentUser?.role === 'SBO_OFFICER';
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [elections, setElections] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [statusBusy, setStatusBusy] = useState({ id: null, target: '' });
  const [form, setForm] = useState({
    title: '',
    start_time: '',
    end_time: '',
    status: 'pending_approval',
    positions: [{ title: '', max_winners: 1 }],
  });
  const [editForm, setEditForm] = useState({
    id: null,
    title: '',
    start_time: '',
    end_time: '',
    status: 'upcoming',
  });

  useEffect(() => {
    let cancelled = false;

    async function loadElections() {
      setLoading(true);
      try {
        const data = await getElections();
        if (!cancelled) {
          setElections(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load elections.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadElections();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const periodError = getVotingPeriodError(form.start_time, form.end_time);
    if (periodError) {
      setFormError(periodError);
      return;
    }

    const normalizedPositions = form.positions
      .map((position) => ({ title: position.title.trim(), max_winners: Number(position.max_winners) }))
      .filter((position) => position.title);
    if (normalizedPositions.length === 0) {
      setFormError('Add at least one election position before submitting for approval.');
      return;
    }

    const uniquePositionTitles = new Set(normalizedPositions.map((position) => position.title.toLowerCase()));
    if (uniquePositionTitles.size !== normalizedPositions.length) {
      setFormError('Election position titles must be unique.');
      return;
    }

    setSubmitting(true);
    setError('');
    setFormError('');
    try {
      const created = await createElection({
        ...form,
        title: form.title.trim(),
        start_time: localDateTimeToIso(form.start_time),
        end_time: localDateTimeToIso(form.end_time),
        positions: normalizedPositions,
      });
      setElections((current) => [created, ...current]);
      setShowCreate(false);
      setForm({ title: '', start_time: '', end_time: '', status: 'pending_approval', positions: [{ title: '', max_winners: 1 }] });
      setError('');
      setFeedback({ open: true, type: 'success', message: 'Election submitted for approval.' });
    } catch (createError) {
      setFormError(getApiErrorMessage(createError, 'Unable to create election.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (election) => {
    setError('');
    setFormError('');
    setEditForm({
      id: election.id,
      title: election.title,
      start_time: isoToLocalDateTimeInput(election.start_time),
      end_time: isoToLocalDateTimeInput(election.end_time),
      status: election.status,
    });
    setShowEdit(true);
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const periodError = getVotingPeriodError(editForm.start_time, editForm.end_time);
    if (periodError) {
      setFormError(periodError);
      return;
    }

    setSubmitting(true);
    setError('');
    setFormError('');
    try {
      const updated = await updateElection(editForm.id, {
        title: editForm.title,
        start_time: localDateTimeToIso(editForm.start_time),
        end_time: localDateTimeToIso(editForm.end_time),
        status: editForm.status,
      });

      setElections((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      setShowEdit(false);
      setError('');
      setFeedback({ open: true, type: 'success', message: 'Election updated.' });
    } catch (updateError) {
      setFormError(getApiErrorMessage(updateError, 'Unable to update election.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    if (statusBusy.id) return;

    setStatusBusy({ id, target: status });
    setError('');
    try {
      const updated = await updateElection(id, { status });
      setElections((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      setFeedback({
        open: true,
        type: 'success',
        message: status === 'active' ? 'Election opened for voting.' : 'Election closed.',
      });
    } catch (updateError) {
      setError(getApiErrorMessage(updateError, 'Unable to update election status.'));
    } finally {
      setStatusBusy({ id: null, target: '' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;

    setDeleting(true);
    setError('');
    try {
      await deleteElection(deleteTarget.id, { confirmed: 1 });
      setElections((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setFeedback({ open: true, type: 'success', message: 'Election deleted.' });
    } catch (deleteError) {
      setDeleteTarget(null);
      setError(getApiErrorMessage(deleteError, 'Unable to delete election.'));
    } finally {
      setDeleting(false);
    }
  };

  const openElectionAndGo = (electionId, destination) => {
    if (onSelect) {
      onSelect(electionId);
      navigate(destination);
      return;
    }

    navigate(destination);
  };

  const filteredElections = elections.filter((item) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const title = String(item.title || '').toLowerCase();
    const status = String(item.status || '').toLowerCase();
    return title.includes(query) || status.includes(query);
  });

  const pagedElections = filteredElections.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, elections.length]);

  return (
    <div className="space-y-4">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />

      <section className="rounded-xl border border-[#DDE7EF] bg-[#EEF6FB] px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-[32px] leading-none font-black text-[#0F172A]">Elections</h2>
            <p className="mt-2 text-sm font-medium text-[#64748B]">
              Select an election to manage its candidates, voters, and results.
            </p>
            <div className="mt-3 relative w-full max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search elections"
                className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-sm font-medium text-[#0F172A] outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0]"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
            <p className="text-xs font-semibold text-[#64748B]">
              {filteredElections.length} election{filteredElections.length === 1 ? '' : 's'}
            </p>
            {canManageElections && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setFormError('');
                  setShowCreate(true);
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0878B7]"
              >
                <Plus size={15} />
                New Election
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <Modal
        open={showCreate && canManageElections}
        title="Create New Election"
        description="Submit a new election setup for approval."
        onClose={() => !submitting && setShowCreate(false)}
        closeOnBackdrop={!submitting}
        closeOnEscape={!submitting}
        maxWidth="max-w-2xl"
        footer={(
          <>
            <button type="button" onClick={() => setShowCreate(false)} disabled={submitting} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-5 text-sm font-bold text-slate-600 transition hover:bg-[#F8FBFD] disabled:opacity-50">Cancel</button>
            <button type="submit" form="create-election-form" disabled={submitting || !form.title.trim() || !form.start_time || !form.end_time || !form.positions.some((position) => position.title.trim())} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-40">{submitting ? 'Submitting...' : 'Submit Election'}</button>
          </>
        )}
      >
          <form id="create-election-form" onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">
                Election Title *
              </label>
              <input
                data-autofocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. HIUSA General Elections 2026"
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">
                  Start Date & Time *
                </label>
                <input
                  type="datetime-local"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm({ ...form, start_time: e.target.value })
                  }
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none transition focus:border-[#0B8ED0]"
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">
                  End Date & Time *
                </label>
                <input
                  type="datetime-local"
                  value={form.end_time}
                  onChange={(e) =>
                    setForm({ ...form, end_time: e.target.value })
                  }
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none transition focus:border-[#0B8ED0]"
                />
              </div>
            </div>
            <p className="text-xs text-[#64748B]">Voting times use this device's local timezone and are saved as an exact instant.</p>

            <fieldset className="rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <legend className="text-[13px] font-bold text-[#0F172A]">Election Positions *</legend>
                  <p className="mt-0.5 text-xs text-[#64748B]">Configure the official ballot before approval.</p>
                </div>
                <button type="button" onClick={() => setForm((current) => ({ ...current, positions: [...current.positions, { title: '', max_winners: 1 }] }))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#0B8ED0]/30 bg-white px-3 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]">
                  <Plus size={13} /> Add Position
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {form.positions.map((position, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_100px_40px] gap-2">
                    <input value={position.title} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} aria-label={`Position ${index + 1} title`} placeholder={index === 0 ? 'e.g. President' : 'Position title'} className="h-10 min-w-0 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                    <input type="number" min="1" max="20" value={position.max_winners} onChange={(event) => setForm((current) => ({ ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { ...item, max_winners: event.target.value } : item) }))} aria-label={`Position ${index + 1} maximum winners`} title="Maximum winners" className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                    <button type="button" aria-label={`Remove position ${index + 1}`} disabled={form.positions.length === 1} onClick={() => setForm((current) => ({ ...current, positions: current.positions.filter((_, itemIndex) => itemIndex !== index) }))} className="grid h-10 w-10 place-items-center rounded-lg border border-red-200 bg-white text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </fieldset>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {formError}
              </div>
            )}
            <div>
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">
                Approval
              </label>
              <div className="relative">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="pending_approval">Submit for Approval</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </form>
      </Modal>

      <section className="space-y-3">
        {loading && (
          <div className="space-y-3" role="status" aria-label="Loading elections">
            {[1, 2, 3].map((item) => (
              <div key={item} className="animate-pulse rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
                <div className="flex justify-between gap-6"><div className="h-7 w-1/2 rounded bg-slate-200" /><div className="h-9 w-16 rounded bg-slate-200" /></div>
                <div className="mt-4 h-16 rounded-lg bg-slate-100" />
                <div className="mt-4 h-10 w-2/3 rounded bg-slate-100" />
              </div>
            ))}
            <span className="sr-only">Loading elections...</span>
          </div>
        )}

        {!loading && elections.length === 0 && (
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 text-sm font-medium text-slate-500 shadow-sm">
            No elections found.
          </div>
        )}

        {!loading && elections.length > 0 && filteredElections.length === 0 && (
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 text-sm font-medium text-slate-500 shadow-sm">
            No elections match your search.
          </div>
        )}

        {!loading && pagedElections.map((el) => {
          const positions = el.positions_count ?? 0;
          const candidates = el.candidates_count ?? 0;
          const votes = getElectionVoteCount(el);
          const turnout = Number(el.turnout_percentage);
          const timeline = formatTimeline(el.status, el.start_time, el.end_time);
          const isStatusBusy = statusBusy.id === el.id;

          return (
            <article
              key={el.id}
              className={`group rounded-xl border border-[#DDE7EF] border-l-4 bg-white px-4 py-4 shadow-sm transition-all hover:border-[#0B8ED0]/35 ${accentByStatus[el.status] || accentByStatus.closed}`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-2xl leading-tight font-black text-[#0F172A] transition-colors group-hover:text-[#0B8ED0] sm:text-[30px]">
                        {el.title}
                      </h3>
                      <span
                        className={`rounded-md border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
                          statusStyles[el.status]
                        }`}
                      >
                        {statusLabels[el.status] || el.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[#64748B]">
                      <span className="flex items-center gap-1">
                        <CalendarDays size={12} />
                        {formatDateTime(el.start_time)} - {formatDateTime(el.end_time)}
                      </span>
                      <span>{timeline}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[36px] leading-none font-black text-[#0B8ED0]">{votes.toLocaleString()}</p>
                    <p className="text-[11px] font-semibold text-[#64748B]">Votes Cast</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 border-y border-[#DDE7EF] py-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Positions</p>
                    <p className="mt-1 text-2xl font-black text-[#0F172A]">{positions}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">Candidates</p>
                    <p className="mt-1 text-2xl font-black text-[#0F172A]">{candidates}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
                      {Number.isFinite(turnout) ? 'Turnout' : 'Status'}
                    </p>
                    <p className="mt-1 text-2xl font-black text-[#0F172A]">
                      {Number.isFinite(turnout) ? `${turnout.toFixed(1)}%` : el.status === 'active' ? 'Live' : 'Closed'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageCandidates && (
                      <button
                        type="button"
                        onClick={() => openElectionAndGo(el.id, '/dashboard/elections/manage-candidates')}
                        className="inline-flex h-10 items-center rounded-md border border-[#DDE7EF] px-3 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FBFD]"
                      >
                        Manage Candidates
                      </button>
                    )}

                    {el.status === 'closed' && (role === 'ADMIN' || el.results_visible) && (
                      <button
                        type="button"
                        onClick={() => openElectionAndGo(el.id, '/dashboard/elections/election-results')}
                        className="inline-flex h-10 items-center rounded-md border border-[#DDE7EF] px-3 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FBFD]"
                      >
                        View Results
                      </button>
                    )}

                    {canManageElections && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(el)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#DDE7EF] text-[#0F172A] hover:bg-[#F8FBFD]"
                        aria-label="Edit election"
                      >
                        <PencilLine size={14} />
                      </button>
                    )}

                    {canManageElections && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(el)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                        aria-label="Delete election"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}

                    {canManageElections && el.status === 'pending_approval' && (
                      <span className="inline-flex h-10 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700">
                        Awaiting Department Head approval
                      </span>
                    )}

                    {canManageElections && el.status !== 'active' && el.status !== 'pending_approval' && (
                      <button
                        type="button"
                        disabled={Boolean(statusBusy.id)}
                        onClick={() => handleStatusChange(el.id, 'active')}
                        className="inline-flex h-10 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-70"
                      >
                        {isStatusBusy && statusBusy.target === 'active' ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          <Power size={13} />
                        )}
                        {isStatusBusy && statusBusy.target === 'active' ? 'Opening...' : 'Open Election'}
                      </button>
                    )}

                    {canManageElections && el.status === 'active' && (
                      <button
                        type="button"
                        disabled={Boolean(statusBusy.id)}
                        onClick={() => handleStatusChange(el.id, 'closed')}
                        className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-slate-800 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-slate-950 disabled:cursor-wait disabled:opacity-70"
                      >
                        {isStatusBusy && statusBusy.target === 'closed' ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          <PowerOff size={13} />
                        )}
                        {isStatusBusy && statusBusy.target === 'closed' ? 'Closing...' : 'Close Election'}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (canManageElections) {
                        openElectionAndGo(el.id, '/dashboard/elections/manage-elections');
                        return;
                      }

                      if (role === 'STUDENT' && el.status === 'active') {
                        openElectionAndGo(el.id, '/dashboard/elections/cast-vote');
                        return;
                      }

                      openElectionAndGo(el.id, '/dashboard/elections/election-results');
                    }}
                    className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm font-semibold text-[#1D4ED8] hover:text-[#0B8ED0]"
                  >
                    Full Details
                    <ChevronRight size={14} className="transition-colors" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!loading && filteredElections.length > 0 && (
          <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <PaginationControls
              currentPage={page}
              totalItems={filteredElections.length}
              pageSize={pageSize}
              onPageChange={setPage}
              label="elections"
            />
          </div>
        )}
      </section>

      <Modal
        open={showEdit && canManageElections}
        title="Edit Election"
        description="Update election schedule and status."
        onClose={() => !submitting && setShowEdit(false)}
        closeOnBackdrop={!submitting}
        closeOnEscape={!submitting}
        maxWidth="max-w-2xl"
        footer={(
          <>
            <button type="button" onClick={() => setShowEdit(false)} disabled={submitting} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">Cancel</button>
            <button type="submit" form="edit-election-form" disabled={submitting || !editForm.title || !editForm.start_time || !editForm.end_time} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-40">{submitting ? 'Saving...' : 'Save Changes'}</button>
          </>
        )}
      >
          <form id="edit-election-form" onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Election Title *</label>
              <input
                data-autofocus
                value={editForm.title}
                onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Start Date & Time *</label>
                <input
                  type="datetime-local"
                  value={editForm.start_time}
                  onChange={(event) => setEditForm({ ...editForm, start_time: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">End Date & Time *</label>
                <input
                  type="datetime-local"
                  value={editForm.end_time}
                  onChange={(event) => setEditForm({ ...editForm, end_time: event.target.value })}
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                />
              </div>
            </div>
            <p className="text-xs text-[#64748B]">Voting times use this device's local timezone and are saved as an exact instant.</p>

            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Status</label>
              <div className="relative">
                <select
                  value={editForm.status}
                  onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                  disabled={editForm.status === 'pending_approval'}
                  className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 disabled:bg-[#F8FBFD] disabled:text-[#64748B]"
                >
                  {editForm.status === 'pending_approval' && (
                    <option value="pending_approval">Pending Approval</option>
                  )}
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {formError}
              </div>
            )}

          </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Election"
        message={getElectionVoteCount(deleteTarget) > 0
          ? `This will permanently delete the election setup, positions, candidates, approval request, and ${getElectionVoteCount(deleteTarget)} cast vote${getElectionVoteCount(deleteTarget) === 1 ? '' : 's'}.`
          : 'This will permanently delete the election setup, positions, candidates, and its approval request.'
        }
        recordName={deleteTarget?.title || ''}
        confirmText={getElectionVoteCount(deleteTarget) > 0 ? 'Delete Anyway' : 'Delete'}
        variant="danger"
        busy={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
