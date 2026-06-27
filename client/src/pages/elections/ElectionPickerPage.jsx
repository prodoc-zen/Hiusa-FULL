import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Vote, Plus, X, Clock, ChevronRight } from 'lucide-react';
import { createElection, getElections, updateElection } from '../../services/electionService';

const statusStyles = {
  upcoming: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

function formatDate(dt) {
  return new Date(dt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ElectionPickerPage({ onSelect }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  const canManageElections = currentUser?.role === 'admin' || currentUser?.role === 'officer';
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [elections, setElections] = useState([]);
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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Elections</h2>
          <p className="text-sm font-medium text-[#64748B] mt-0.5">
            Select an election to manage its candidates, voters, and results.
          </p>
        </div>
        {canManageElections && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 bg-[#0B8ED0] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-[#0878B7] transition-colors"
          >
            <Plus size={15} />
            New Election
          </button>
        )}
      </div>

      {/* Create Form */}
      {showCreate && canManageElections && (
        <div className="rounded-xl border border-[#0B8ED0]/30 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[#0F172A]">Create New Election</h3>
            <button
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
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 transition"
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
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] transition"
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
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] transition"
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
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] transition"
              >
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={!form.title || !form.start_time || !form.end_time}
                className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-40"
              >
                Create Election
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Election Cards */}
      <div className="space-y-3">
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

        {!loading && elections.map((el) => {
          const positions = el.positions_count ?? 0;
          const candidates = el.candidates_count ?? 0;
          const votes = el.votes_count ?? 0;

          return (
            <div
              key={el.id}
              className="w-full rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm hover:border-[#0B8ED0]/40 hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {el.status === 'active' && (
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    )}
                    <h3 className="text-sm font-bold text-[#0F172A] group-hover:text-[#0B8ED0] transition-colors">
                      {el.title}
                    </h3>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold capitalize ${
                        statusStyles[el.status]
                      }`}
                    >
                      {el.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-[#94A3B8] flex-wrap mb-2.5">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatDate(el.start_time)} — {formatDate(el.end_time)}
                    </span>
                    <span>{positions} positions</span>
                    <span>{candidates} candidates</span>
                    <span>{votes} votes cast</span>
                  </div>
                  {positions > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 bg-[#EEF6FB] text-[#0B8ED0] text-[10px] font-semibold rounded-full border border-[#0B8ED0]/15">
                        Election ready
                      </span>

                      {canManageElections && el.status !== 'active' && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(el.id, 'active')}
                          className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded-full border border-emerald-200"
                        >
                          Open
                        </button>
                      )}

                      {canManageElections && el.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(el.id, 'closed')}
                          className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-semibold rounded-full border border-slate-200"
                        >
                          Close
                        </button>
                      )}

                      {canManageElections && (
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(el)}
                          className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-semibold rounded-full border border-amber-200"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 flex flex-col items-end">
                  {el.status === 'active' ? (
                    <div>
                      <p className="text-lg font-black text-[#0B8ED0]">
                        {votes}
                      </p>
                      <p className="text-[10px] text-[#94A3B8]">votes cast</p>
                    </div>
                  ) : el.status === 'closed' ? (
                    <p className="text-xs font-bold text-[#64748B]">
                      {votes} total votes
                    </p>
                  ) : (
                    <p className="text-xs font-bold text-amber-600">
                      Scheduled
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelect) {
                        onSelect(el.id);
                      } else {
                        navigate('/dashboard/elections/manage-elections');
                      }
                    }}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-[#DDE7EF] px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-[#EEF6FB]"
                  >
                    Open
                    <ChevronRight size={14} className="text-slate-400 group-hover:text-[#0B8ED0] transition-colors" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showEdit && canManageElections && (
        <div className="rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-[#0F172A]">Edit Election</h3>
            <button onClick={() => setShowEdit(false)} className="rounded p-1 text-slate-400 hover:bg-red-50">
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
              <select
                value={editForm.status}
                onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
              >
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
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
        </div>
      )}
    </div>
  );
}
