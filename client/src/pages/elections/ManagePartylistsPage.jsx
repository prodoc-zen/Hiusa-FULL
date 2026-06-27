import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Flag, Plus, X, Edit2, Trash2 } from 'lucide-react';
import { createPartylist, deletePartylist, getPartylists, updatePartylist } from '../../services/electionService';

export default function ManagePartylistsPage() {
  const { election, refreshElection } = useOutletContext();
  const [partylistRows, setPartylistRows] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', acronym: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const partylistData = await getPartylists();
        if (!cancelled) {
          const partylists = Array.isArray(partylistData) ? partylistData : [];
          setPartylistRows(partylists);
        }
      } catch (error) {
        if (!cancelled) {
          setPartylistRows([]);
        }
      }
    }

    if (election?.id) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [election?.id]);

  if (!election) {
    return <div className="py-20 text-center text-sm text-slate-500">Election not found.</div>;
  }

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const created = await createPartylist(form);
      setPartylistRows((current) => [...current, created]);
      setForm({ name: '', acronym: '', description: '' });
      setShowAdd(false);
    } catch (createError) {
      setError(createError?.response?.data?.message || 'Unable to add partylist.');
    }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!editing?.id) return;

    setError('');

    try {
      const updated = await updatePartylist(editing.id, {
        name: editing.name,
        acronym: editing.acronym || null,
        description: editing.description || null,
      });

      setPartylistRows((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
      setEditing(null);
    } catch (updateError) {
      setError(updateError?.response?.data?.message || 'Unable to update partylist.');
    }
  };

  const handleDelete = async (id) => {
    setError('');
    setWorkingId(id);

    try {
      await deletePartylist(id);
      setPartylistRows((current) => current.filter((row) => row.id !== id));
      await refreshElection();
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || 'Unable to delete partylist.');
    } finally {
      setWorkingId(null);
    }
  };

  const candidates = election.candidates || [];

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <p className="text-sm font-medium text-[#64748B]">{partylistRows.length} partylist{partylistRows.length !== 1 ? 's' : ''} - {election.title}</p>
        {election.status !== 'closed' && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-[#0B8ED0] text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-[#0878B7] transition-colors">
            <Plus size={15} />
            Add Partylist
          </button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-xl border border-[#0B8ED0]/30 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[#0F172A] text-sm">Register Partylist</h3>
            <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-red-50 rounded text-slate-400"><X size={16} /></button>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Partylist Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Alab" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 transition" />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Acronym</label>
                <input value={form.acronym} onChange={(e) => setForm({ ...form, acronym: e.target.value })} placeholder="e.g. ALAB" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] transition" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Party description or tagline..." className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 transition resize-none" />
              </div>
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={!form.name.trim()} className="h-10 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-40">Register Partylist</button>
              <button type="button" onClick={() => setShowAdd(false)} className="h-10 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-[#0F172A] text-sm">Edit Partylist</h3>
            <button type="button" onClick={() => setEditing(null)} className="p-1 hover:bg-red-50 rounded text-slate-400"><X size={16} /></button>
          </div>
          <form onSubmit={handleUpdate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Partylist Name *</label>
              <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
            </div>
            <div>
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Acronym</label>
              <input value={editing.acronym || ''} onChange={(event) => setEditing({ ...editing, acronym: event.target.value })} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[13px] font-semibold text-[#0F172A] block mb-1.5">Description</label>
              <textarea value={editing.description || ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} rows={3} className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] resize-none" />
            </div>
            {error && (
              <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={!editing.name?.trim()} className="h-10 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-40">Save Changes</button>
              <button type="button" onClick={() => setEditing(null)} className="h-10 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {error && !showAdd && !editing && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {partylistRows.length === 0 ? (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-10 text-center">
          <Flag size={36} className="text-[#DDE7EF] mx-auto mb-3" />
          <p className="text-sm text-[#64748B]">No partylists registered for this election.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {partylistRows.map((partylist) => {
            const partylistCandidates = candidates.filter((candidate) => candidate.partylist_id === partylist.id);
            return (
              <div key={partylist.id} className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm overflow-hidden">
                <div className="h-2 bg-[#0B8ED0]" />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-black text-[#0F172A]">{partylist.name}</h3>
                      {partylist.acronym && <span className="inline-block mt-0.5 px-2 py-0.5 bg-[#EEF6FB] text-[#0B8ED0] text-[10px] font-bold rounded-full">{partylist.acronym}</span>}
                      {partylist.description && <p className="text-xs text-[#64748B] mt-1">{partylist.description}</p>}
                    </div>
                    <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-[#EEF6FB] text-[#0B8ED0] shrink-0">{partylistCandidates.length} candidate{partylistCandidates.length !== 1 ? 's' : ''}</span>
                  </div>

                  {partylistCandidates.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {partylistCandidates.map((candidate) => {
                        const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim();
                        const position = candidate.position?.title || 'Unknown';
                        return (
                          <div key={candidate.id} className="flex items-center gap-2 text-xs text-slate-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#0B8ED0]" />
                            <span className="font-medium">{name}</span>
                            <span className="text-[#94A3B8]">/ {position}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {election.status !== 'closed' && (
                    <div className="flex gap-2 pt-3 border-t border-[#E5EDF3]">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: partylist.id, name: partylist.name || '', acronym: partylist.acronym || '', description: partylist.description || '' })}
                        className="flex items-center gap-1 text-[#0B8ED0] text-xs font-semibold hover:bg-[#EEF6FB] px-2 py-1 rounded transition"
                      >
                        <Edit2 size={11} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(partylist.id)}
                        disabled={workingId === partylist.id}
                        className="flex items-center gap-1 text-red-500 text-xs font-semibold hover:bg-red-50 px-2 py-1 rounded transition disabled:opacity-50"
                      >
                        <Trash2 size={11} />
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
