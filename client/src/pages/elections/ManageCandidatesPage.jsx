import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Award, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { createElectionCandidate, deleteElectionCandidate, getPartylists, getUsers } from '../../services/electionService';

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

export default function ManageCandidatesPage() {
  const { election, refreshElection } = useOutletContext();
  const [users, setUsers] = useState([]);
  const [partylists, setPartylists] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [posFilter, setPosFilter] = useState('All');
  const [form, setForm] = useState({ user_id: '', position_id: '', partylist_id: '', platform: '' });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [error, setError] = useState('');
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
      } catch (error) {
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

  const positions = election?.positions || [];
  const candidates = election?.candidates || [];
  const filtered = useMemo(() => (
    posFilter === 'All' ? candidates : candidates.filter((candidate) => candidate.position_id === Number(posFilter))
  ), [candidates, posFilter]);

  if (!election) {
    return <div className="py-20 text-center text-sm text-slate-500">Election not found.</div>;
  }

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');

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
      setForm({ user_id: '', position_id: positions[0]?.id ? String(positions[0].id) : '', partylist_id: '', platform: '' });
      setImageFile(null);
      setImagePreview(null);
      setShowAdd(false);
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to add candidate.');
    }
  };

  const handleRemove = async (candidateId) => {
    setError('');
    setWorkingId(candidateId);

    try {
      await deleteElectionCandidate(election.id, candidateId);
      await refreshElection();
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
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <button onClick={() => setPosFilter('All')} className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition ${posFilter === 'All' ? 'bg-[#0B1831] text-white' : 'bg-[#F8FBFD] border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]'}`}>All</button>
            {positions.map((position) => (
              <button key={position.id} onClick={() => setPosFilter(String(position.id))} className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition ${posFilter === String(position.id) ? 'bg-[#0B1831] text-white' : 'bg-[#F8FBFD] border border-[#DDE7EF] text-slate-600 hover:bg-[#EEF6FB]'}`}>
                {position.title}
              </button>
            ))}
          </div>
        </div>
        {election.status !== 'closed' && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-[#0B8ED0] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-[#0878B7] transition-colors">
            <Plus size={15} />
            Add Candidate
          </button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-xl border border-[#0B8ED0]/30 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[#0F172A] text-sm">Add Candidate</h3>
            <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-red-50 rounded text-slate-400"><X size={16} /></button>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Student *</label>
                <select value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] transition">
                  <option value="">Select a student...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.first_name} {user.last_name} ({user.school_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Position *</label>
                <select value={form.position_id} onChange={(e) => setForm({ ...form, position_id: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] transition">
                  <option value="">Select a position...</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Party List</label>
                <select value={form.partylist_id} onChange={(e) => setForm({ ...form, partylist_id: e.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] transition">
                  <option value="">Independent</option>
                  {partylists.map((partylist) => (
                    <option key={partylist.id} value={partylist.id}>{partylist.name}{partylist.acronym ? ` (${partylist.acronym})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Candidate Photo</label>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2 transition hover:border-[#0B8ED0]/50 hover:bg-[#EEF6FB]">
                  {imagePreview
                    ? <img src={imagePreview} alt="Preview" className="h-9 w-9 rounded-full object-cover border border-[#DDE7EF]" />
                    : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E6F6FD]"><ImagePlus size={16} className="text-[#0B8ED0]" /></div>
                  }
                  <span className="text-[13px] font-medium text-slate-400">{imagePreview ? 'Change photo' : 'Upload photo'}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files[0];
                      if (!f) return;
                      setImageFile(f);
                      setImagePreview(URL.createObjectURL(f));
                    }}
                  />
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Platform Statement</label>
                <textarea value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} rows={3} placeholder="Candidate's platform and vision..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 transition resize-none" />
              </div>
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={!form.user_id || !form.position_id} className="h-10 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-40">Add Candidate</button>
              <button type="button" onClick={() => setShowAdd(false)} className="h-10 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {error && !showAdd && (
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
                        ? <img src={candidate.image_url} alt={name} className="h-9 w-9 shrink-0 rounded-full border border-[#DDE7EF] object-cover" />
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
                      <button
                        type="button"
                        onClick={() => handleRemove(candidate.id)}
                        disabled={workingId === candidate.id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
