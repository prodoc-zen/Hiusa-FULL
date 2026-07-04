import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Award, ChevronDown, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  createElectionCandidate,
  deleteElectionCandidate,
  getPartylists,
  getUsers,
  updateElectionCandidate,
} from '../../services/electionService';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/api\/?$/, '');

function resolveImageUrl(url) {
  if (!url) return null;
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function Avatar({ name, size = 'sm' }) {
  const initials = name
    .split(' ')
    .map((value) => value[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const colors = ['bg-[#0B8ED0]', 'bg-purple-500', 'bg-emerald-500', 'bg-red-500', 'bg-amber-500', 'bg-indigo-500', 'bg-pink-500'];
  const bg = colors[name.charCodeAt(0) % colors.length];
  const sz = size === 'lg' ? 'w-12 h-12 text-base' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';

  return <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${sz} ${bg}`}>{initials}</div>;
}

function ConfirmModal({ open, title, message, confirmText, busy, onCancel, onConfirm }) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-[#0F172A]">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]" disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-50" disabled={busy}>
            {busy ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateForm({
  title,
  submitLabel,
  form,
  setForm,
  positions,
  partylists,
  users,
  imagePreview,
  onImageChange,
  error,
  submitting,
  onSubmit,
  onCancel,
}) {
  return (
    <div className="rounded-xl border border-[#0B8ED0]/30 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>
        <button type="button" onClick={onCancel} className="rounded p-1 text-slate-400 hover:bg-red-50"><X size={16} /></button>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Student *</label>
            <div className="relative">
              <select
                value={form.user_id}
                onChange={(event) => setForm({ ...form, user_id: event.target.value })}
                className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
              >
                <option value="">Select a student...</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.first_name} {user.last_name} ({user.school_id || 'No ID'})</option>
                ))}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Position *</label>
            <div className="relative">
              <select
                value={form.position_id}
                onChange={(event) => setForm({ ...form, position_id: event.target.value })}
                className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
              >
                <option value="">Select a position...</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>{position.title}</option>
                ))}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Party List</label>
            <div className="relative">
              <select
                value={form.partylist_id}
                onChange={(event) => setForm({ ...form, partylist_id: event.target.value })}
                className="h-11 w-full appearance-none rounded-lg border border-[#DDE7EF] bg-white px-3 pr-9 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
              >
                <option value="">Independent</option>
                {partylists.map((partylist) => (
                  <option key={partylist.id} value={partylist.id}>{partylist.name}{partylist.acronym ? ` (${partylist.acronym})` : ''}</option>
                ))}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Candidate Photo</label>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 transition hover:border-[#0B8ED0]/50 hover:bg-[#EEF6FB]">
              {imagePreview
                ? <img src={resolveImageUrl(imagePreview)} alt="Preview" className="h-9 w-9 rounded-full object-cover border border-[#DDE7EF]" />
                : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E6F6FD]"><ImagePlus size={16} className="text-[#0B8ED0]" /></div>
              }
              <span className="text-[13px] font-medium text-slate-400">{imagePreview ? 'Change photo' : 'Upload photo'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onImageChange} />
            </label>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Platform Statement</label>
            <textarea
              value={form.platform}
              onChange={(event) => setForm({ ...form, platform: event.target.value })}
              rows={3}
              placeholder="Candidate's platform and vision..."
              className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={submitting || !form.user_id || !form.position_id} className="h-10 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-40">
            {submitting ? 'Saving...' : submitLabel}
          </button>
          <button type="button" onClick={onCancel} className="h-10 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function ManageCandidatesPage() {
  const { election, refreshElection } = useOutletContext();

  const [users, setUsers] = useState([]);
  const [partylists, setPartylists] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [posFilter, setPosFilter] = useState('All');
  const [form, setForm] = useState({ user_id: '', position_id: '', partylist_id: '', platform: '' });
  const [editForm, setEditForm] = useState({ user_id: '', position_id: '', partylist_id: '', platform: '' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState(null);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [workingId, setWorkingId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [userData, partylistData] = await Promise.all([getUsers(), getPartylists()]);
        if (!cancelled) {
          const allUsers = Array.isArray(userData) ? userData : [];
          setUsers(allUsers.filter((user) => user.role === 'student'));
          setPartylists(Array.isArray(partylistData) ? partylistData : []);
        }
      } catch {
        if (!cancelled) {
          setUsers([]);
          setPartylists([]);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!election) {
    return <div className="py-20 text-center text-sm text-slate-500">Election not found.</div>;
  }

  const positions = election.positions || [];
  const candidates = election.candidates || [];

  const assignedUserIds = useMemo(() => new Set(candidates.map((candidate) => candidate.user_id)), [candidates]);

  const filtered = useMemo(() => (
    posFilter === 'All' ? candidates : candidates.filter((candidate) => candidate.position_id === Number(posFilter))
  ), [candidates, posFilter]);

  const availableAddUsers = users.filter((user) => !assignedUserIds.has(user.id));
  const availableEditUsers = users.filter((user) => user.id === Number(editForm.user_id) || !assignedUserIds.has(user.id));

  const resetAddForm = () => {
    setForm({ user_id: '', position_id: '', partylist_id: '', platform: '' });
    setImageFile(null);
    setImagePreview(null);
    setShowAdd(false);
  };

  const resetEditForm = () => {
    setEditId(null);
    setEditForm({ user_id: '', position_id: '', partylist_id: '', platform: '' });
    setEditImageFile(null);
    setEditImagePreview(null);
  };

  const openEdit = (candidate) => {
    setEditId(candidate.id);
    setEditForm({
      user_id: candidate.user_id ? String(candidate.user_id) : '',
      position_id: candidate.position_id ? String(candidate.position_id) : '',
      partylist_id: candidate.partylist_id ? String(candidate.partylist_id) : '',
      platform: candidate.platform || '',
    });
    setEditImageFile(null);
    setEditImagePreview(candidate.image_url || null);
    setError('');
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    const payload = {
      user_id: Number(form.user_id),
      position_id: Number(form.position_id),
      partylist_id: form.partylist_id ? Number(form.partylist_id) : null,
      platform: form.platform || null,
      imageFile: imageFile || null,
    };

    try {
      await createElectionCandidate(election.id, payload);
      await refreshElection();
      resetAddForm();
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to add candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!editId) {
      return;
    }

    setError('');
    setSubmitting(true);

    const payload = {
      user_id: Number(editForm.user_id),
      position_id: Number(editForm.position_id),
      partylist_id: editForm.partylist_id ? Number(editForm.partylist_id) : null,
      platform: editForm.platform || null,
      imageFile: editImageFile || null,
    };

    try {
      await updateElectionCandidate(election.id, editId, payload);
      await refreshElection();
      resetEditForm();
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (candidateId) => {
    setError('');
    setWorkingId(candidateId);

    try {
      await deleteElectionCandidate(election.id, candidateId);
      await refreshElection();
      setConfirmDeleteId(null);
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || 'Unable to remove candidate.');
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-[#64748B]">{candidates.length} candidates - {election.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button onClick={() => setPosFilter('All')} className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition ${posFilter === 'All' ? 'bg-[#0B1831] text-white' : 'bg-[#F8FBFD] border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]'}`}>All</button>
            {positions.map((position) => (
              <button key={position.id} onClick={() => setPosFilter(String(position.id))} className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition ${posFilter === String(position.id) ? 'bg-[#0B1831] text-white' : 'bg-[#F8FBFD] border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]'}`}>
                {position.title}
              </button>
            ))}
          </div>
        </div>
        {election.status !== 'closed' && (
          <button onClick={() => { setError(''); setShowAdd(true); resetEditForm(); }} className="flex items-center gap-1.5 bg-[#0B8ED0] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-[#0878B7] transition-colors">
            <Plus size={15} />
            Add Candidate
          </button>
        )}
      </div>

      {showAdd && (
        <CandidateForm
          title="Add Candidate"
          submitLabel="Add Candidate"
          form={form}
          setForm={setForm}
          positions={positions}
          partylists={partylists}
          users={availableAddUsers}
          imagePreview={imagePreview}
          onImageChange={(event) => {
            const file = event.target.files[0];
            if (!file) return;
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
          }}
          error={error}
          submitting={submitting}
          onSubmit={handleAdd}
          onCancel={resetAddForm}
        />
      )}

      {editId && (
        <CandidateForm
          title="Edit Candidate"
          submitLabel="Save Changes"
          form={editForm}
          setForm={setEditForm}
          positions={positions}
          partylists={partylists}
          users={availableEditUsers}
          imagePreview={editImagePreview}
          onImageChange={(event) => {
            const file = event.target.files[0];
            if (!file) return;
            setEditImageFile(file);
            setEditImagePreview(URL.createObjectURL(file));
          }}
          error={error}
          submitting={submitting}
          onSubmit={handleEdit}
          onCancel={resetEditForm}
        />
      )}

      {error && !showAdd && !editId && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-10 text-center">
          <Award size={36} className="text-[#DDE7EF] mx-auto mb-3" />
          <p className="text-sm text-[#64748B]">No candidates yet for this election.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtered.map((candidate) => {
            const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim();
            const position = positions.find((value) => value.id === candidate.position_id)?.title || 'Unknown';
            const partylist = candidate.partylist?.name || 'Independent';

            return (
              <div key={candidate.id} className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm overflow-hidden">
                <div className="h-2 bg-[#0B8ED0]" />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {candidate.image_url
                        ? <img src={resolveImageUrl(candidate.image_url)} alt={name} className="h-9 w-9 shrink-0 rounded-full border border-[#DDE7EF] object-cover" />
                        : <Avatar name={name || 'Candidate'} size="md" />
                      }
                      <div className="min-w-0">
                        <p className="font-bold text-[#0F172A]">{name || 'Unknown Candidate'}</p>
                        <p className="text-xs text-[#64748B]">{position}</p>
                        <span className="inline-block mt-1 px-2 py-0.5 bg-[#EEF6FB] text-[#0B8ED0] text-[10px] font-bold rounded-full">{partylist}</span>
                        {candidate.platform && <p className="mt-2 text-sm text-slate-600">{candidate.platform}</p>}
                      </div>
                    </div>
                    {election.status !== 'closed' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(candidate)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-[#EEF6FB] px-3 py-1.5 text-xs font-bold text-[#0B8ED0] transition hover:bg-[#E0F0FA]"
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(candidate.id)}
                          disabled={workingId === candidate.id}
                          className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDeleteId)}
        title="Remove Candidate"
        message="Are you sure you want to remove this candidate from the election?"
        confirmText="Remove"
        busy={workingId === confirmDeleteId}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (!confirmDeleteId) return;
          handleRemove(confirmDeleteId);
        }}
      />
    </div>
  );
}
