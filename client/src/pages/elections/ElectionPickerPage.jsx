import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Search, CalendarDays, ChevronDown, ChevronRight, PencilLine } from 'lucide-react';
import { createElection, getElections, updateElection } from '../../services/electionService';
import PaginationControls from '../../components/PaginationControls';

const statusStyles = {
  upcoming: 'bg-[#EEF6FB] text-[#0B8ED0] border-[#D5E8F5]',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

const accentByStatus = {
  upcoming: 'border-l-[#0B8ED0]',
  active: 'border-l-[#16A34A]',
  closed: 'border-l-[#94A3B8]',
};

function formatDate(dt) {
  if (!dt) {
    return '-';
  }

  return new Date(dt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

export default function ElectionPickerPage({ onSelect }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const canManageElections = currentUser?.role === 'admin' || currentUser?.role === 'officer';
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [elections, setElections] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    start_time: '',
    end_time: '',
    status: 'upcoming',
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
      } catch (loadError) {
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
    try {
      const created = await createElection(form);
      setElections((current) => [created, ...current]);
      setShowCreate(false);
      setForm({ title: '', start_time: '', end_time: '', status: 'upcoming' });
      setError('');
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to create election.');
    }
  };

  const handleOpenEdit = (election) => {
    setEditForm({
      id: election.id,
      title: election.title,
      start_time: election.start_time?.slice(0, 16) || '',
      end_time: election.end_time?.slice(0, 16) || '',
      status: election.status,
    });
    setShowEdit(true);
  };

  const handleEdit = async (event) => {
    event.preventDefault();

    try {
      const updated = await updateElection(editForm.id, {
        title: editForm.title,
        start_time: editForm.start_time,
        end_time: editForm.end_time,
        status: editForm.status,
      });

      setElections((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      setShowEdit(false);
      setError('');
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update election.');
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      const updated = await updateElection(id, { status });
      setElections((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update election status.');
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
                onClick={() => setShowCreate(true)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0878B7]"
              >
                <Plus size={15} />
                New Election
              </button>
            )}
          </div>
        </div>
      </section>

      {showCreate && canManageElections && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[#0F172A]">Create New Election</h3>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="p-1 hover:bg-red-50 rounded text-slate-400"
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">
                Election Title *
              </label>
              <input
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

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <div>
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">
                Initial Status
              </label>
              <div className="relative">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={!form.title || !form.start_time || !form.end_time}
                className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-40"
              >
                Create Election
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 transition hover:bg-[#F8FBFD]"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="space-y-3">
        {loading && (
          <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 text-sm font-medium text-slate-500 shadow-sm">
            Loading elections...
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
          const votes = el.votes_count ?? 0;
          const turnout = Number(el.turnout_percentage);
          const timeline = formatTimeline(el.status, el.start_time, el.end_time);

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
                        {el.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[#64748B]">
                      <span className="flex items-center gap-1">
                        <CalendarDays size={12} />
                        {formatDate(el.start_time)} - {formatDate(el.end_time)}
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
                      {Number.isFinite(turnout) ? `${turnout.toFixed(1)}%` : el.status === 'active' ? 'Live' : 'Ready'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageElections && (
                      <button
                        type="button"
                        onClick={() => openElectionAndGo(el.id, '/dashboard/elections/manage-candidates')}
                        className="inline-flex h-9 items-center rounded-md border border-[#DDE7EF] px-3 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FBFD]"
                      >
                        Manage Candidates
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => openElectionAndGo(el.id, '/dashboard/elections/election-results')}
                      className="inline-flex h-9 items-center rounded-md border border-[#DDE7EF] px-3 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FBFD]"
                    >
                      View Results
                    </button>

                    {canManageElections && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(el)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#DDE7EF] text-[#0F172A] hover:bg-[#F8FBFD]"
                        aria-label="Edit election"
                      >
                        <PencilLine size={14} />
                      </button>
                    )}

                    {canManageElections && el.status !== 'active' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(el.id, 'active')}
                        className="inline-flex h-9 items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700"
                      >
                        Open Election
                      </button>
                    )}

                    {canManageElections && el.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(el.id, 'closed')}
                        className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-slate-100 px-3 text-xs font-semibold text-slate-700"
                      >
                        Close Election
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

                      openElectionAndGo(el.id, '/dashboard/elections/election-results');
                    }}
                    className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-semibold text-[#1D4ED8] hover:text-[#0B8ED0]"
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

      {showEdit && canManageElections && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-[#0F172A]">Edit Election</h3>
            <button type="button" onClick={() => setShowEdit(false)} className="rounded p-1 text-slate-400 hover:bg-red-50">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Election Title *</label>
              <input
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

            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Status</label>
              <div className="relative">
                <select
                  value={editForm.status}
                  onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                  className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={!editForm.title || !editForm.start_time || !editForm.end_time}
                className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-40"
              >
                Save Changes
              </button>
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
