import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Flag, ImagePlus, X, Edit2, Trash2, Search, CirclePlus, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { createPartylist, deletePartylist, getPartylists, updatePartylist } from '../../services/electionService';

const CARD_ACCENTS = ['#0B8ED0', '#16A34A', '#0F2F62', '#0878B7'];

function getInitials(name) {
  return String(name || '')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function ManagePartylistsPage() {
  const { election, refreshElection } = useOutletContext();
  const [partylistRows, setPartylistRows] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', acronym: '', description: '' });
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editBannerFile, setEditBannerFile] = useState(null);
  const [editBannerPreview, setEditBannerPreview] = useState(null);
  const [editTab, setEditTab] = useState('general');
  const [searchTerm, setSearchTerm] = useState('');
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

  const candidates = election.candidates || [];
  const electionPositions = election.positions || [];
  const resolvePositionTitle = (candidate) => {
    if (candidate?.position?.title) {
      return candidate.position.title;
    }

    const match = electionPositions.find((position) => position.id === candidate?.position_id);
    return match?.title || 'Unassigned';
  };
  const filteredPartylists = partylistRows.filter((partylist) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const name = String(partylist.name || '').toLowerCase();
    const acronym = String(partylist.acronym || '').toLowerCase();
    const description = String(partylist.description || '').toLowerCase();
    return name.includes(query) || acronym.includes(query) || description.includes(query);
  });

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const created = await createPartylist({ ...form, bannerFile: bannerFile || null });
      setPartylistRows((current) => [...current, created]);
      setForm({ name: '', acronym: '', description: '' });
      setBannerFile(null);
      setBannerPreview(null);
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
        bannerFile: editBannerFile || null,
      });

      setPartylistRows((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
      setEditBannerFile(null);
      setEditBannerPreview(null);
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

  const getPartylistCandidates = (partylistId) =>
    candidates.filter((candidate) => candidate.partylist_id === partylistId);

  const getRosterStatus = (partylistId) => {
    const roster = getPartylistCandidates(partylistId);
    const hasVicePresident = roster.some((candidate) =>
      String(candidate.position?.title || '').toLowerCase().includes('vice')
    );

    return {
      rosterCount: roster.length,
      hasVicePresident,
    };
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#DDE7EF] bg-white px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Elections · Manage Party Lists</p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-[#0F172A]">Party Rosters</h2>
            <p className="mt-1 max-w-2xl text-sm font-medium text-[#64748B]">
              Review and manage the official candidate line-ups for {election.title}. Ensure all documentation is complete before final ratification.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search party roster"
                className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-sm font-medium text-[#0F172A] outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0]"
              />
            </div>
            {election.status !== 'closed' && (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white transition-colors hover:bg-[#0878B7]"
              >
                <CirclePlus size={15} />
                Register New Party
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-[#64748B]">
          {filteredPartylists.length} roster{filteredPartylists.length !== 1 ? 's' : ''} shown
        </p>
        <p className="text-xs font-semibold text-[#94A3B8]">
          {partylistRows.length} total partylist{partylistRows.length !== 1 ? 's' : ''}
        </p>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#0F172A]">Register Partylist</h3>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded p-1 text-slate-400 hover:bg-red-50"><X size={16} /></button>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Partylist Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Alab" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Acronym</label>
                <input value={form.acronym} onChange={(e) => setForm({ ...form, acronym: e.target.value })} placeholder="e.g. ALAB" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] transition focus:border-[#0B8ED0]" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Party description or tagline..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none placeholder:text-[#94A3B8] transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Party Banner</label>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2.5 transition hover:border-[#0B8ED0]/50 hover:bg-[#EEF6FB]">
                  {bannerPreview
                    ? <img src={bannerPreview} alt="Banner preview" className="h-10 w-20 rounded object-cover border border-[#DDE7EF]" />
                    : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD]"><ImagePlus size={16} className="text-[#0B8ED0]" /></div>
                  }
                  <div>
                    <p className="text-[13px] font-medium text-slate-500">{bannerPreview ? 'Change banner' : 'Upload banner image'}</p>
                    <p className="text-[11px] text-slate-400">JPEG, PNG or WebP (max 2MB)</p>
                  </div>
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files[0];
                      if (!f) return;
                      setBannerFile(f);
                      setBannerPreview(URL.createObjectURL(f));
                    }}
                  />
                </label>
              </div>
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={!form.name.trim()} className="h-10 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white transition hover:bg-[#0878B7] disabled:opacity-40">Register Partylist</button>
              <button type="button" onClick={() => setShowAdd(false)} className="h-10 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 transition hover:bg-[#F8FBFD]">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <section className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#64748B] hover:text-[#0F172A]"
                >
                  <ArrowLeft size={13} />
                  Manage Party Lists
                </button>
                <h3 className="mt-2 text-[30px] leading-tight font-black text-[#0F172A]">
                  {editing.name || 'Edit Partylist'}
                </h3>
                <p className="mt-1 text-xs font-medium text-[#64748B]">Edit list</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="h-10 rounded-lg border border-[#DDE7EF] px-4 text-sm font-bold text-[#0F172A] hover:bg-[#F8FBFD]"
                >
                  Discard Draft
                </button>
                <button
                  type="button"
                  onClick={(event) => handleUpdate(event)}
                  disabled={!editing.name?.trim()}
                  className="h-10 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-40"
                >
                  Save Changes
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-[#DDE7EF]">
              <button
                type="button"
                onClick={() => setEditTab('general')}
                className={`pb-2 text-xs font-bold uppercase tracking-wide ${editTab === 'general' ? 'border-b-2 border-[#0B8ED0] text-[#0F172A]' : 'text-[#64748B]'}`}
              >
                General Information
              </button>
              <button
                type="button"
                onClick={() => setEditTab('roster')}
                className={`pb-2 text-xs font-bold uppercase tracking-wide ${editTab === 'roster' ? 'border-b-2 border-[#0B8ED0] text-[#0F172A]' : 'text-[#64748B]'}`}
              >
                Roster Management
              </button>
              <button
                type="button"
                onClick={() => setEditTab('docs')}
                className={`pb-2 text-xs font-bold uppercase tracking-wide ${editTab === 'docs' ? 'border-b-2 border-[#0B8ED0] text-[#0F172A]' : 'text-[#64748B]'}`}
              >
                Platform & Documents
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[1fr_260px]">
            <div className="space-y-4">
              {editTab === 'general' && (
                <form onSubmit={handleUpdate} className="rounded-xl border border-[#DDE7EF] bg-white p-4">
                  <h4 className="text-lg font-bold text-[#0F172A]">Party Identity</h4>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Official Party Name</label>
                      <input
                        value={editing.name}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Acronym / Abbreviation</label>
                      <input
                        value={editing.acronym || ''}
                        onChange={(event) => setEditing({ ...editing, acronym: event.target.value })}
                        className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Mission Statement</label>
                      <textarea
                        value={editing.description || ''}
                        onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                        rows={4}
                        className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0]"
                      />
                      <p className="mt-1 text-xs text-[#94A3B8]">
                        This statement appears in candidate pages and election records.
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Party Banner</label>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2.5 transition hover:border-[#0B8ED0]/50 hover:bg-[#EEF6FB]">
                        {editBannerPreview
                          ? <img src={editBannerPreview} alt="Banner preview" className="h-10 w-20 rounded object-cover border border-[#DDE7EF]" />
                          : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD]"><ImagePlus size={16} className="text-[#0B8ED0]" /></div>
                        }
                        <div>
                          <p className="text-[13px] font-medium text-slate-500">{editBannerPreview ? 'Change banner' : 'Upload banner image'}</p>
                          <p className="text-[11px] text-slate-400">JPEG, PNG or WebP (max 2MB)</p>
                        </div>
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files[0];
                            if (!f) return;
                            setEditBannerFile(f);
                            setEditBannerPreview(URL.createObjectURL(f));
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  {error && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                      {error}
                    </div>
                  )}
                </form>
              )}

              {editTab === 'roster' && (
                <div className="rounded-xl border border-[#DDE7EF] bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-lg font-bold text-[#0F172A]">Roster Overview</h4>
                    <span className="text-xs font-semibold text-[#64748B]">
                      {getPartylistCandidates(editing.id).length} candidate{getPartylistCandidates(editing.id).length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {getPartylistCandidates(editing.id).map((candidate) => {
                      const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() || 'Unknown Candidate';
                      const position = candidate.position?.title || 'Unassigned';

                      return (
                        <div key={candidate.id} className="flex items-center justify-between rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 py-2">
                          <span className="text-sm font-semibold text-[#0F172A]">{name}</span>
                          <span className="text-xs font-medium text-[#64748B]">{position}</span>
                        </div>
                      );
                    })}
                    {getPartylistCandidates(editing.id).length === 0 && (
                      <p className="text-sm font-medium text-[#94A3B8]">No candidates currently assigned.</p>
                    )}
                  </div>
                </div>
              )}

              {editTab === 'docs' && (
                <div className="rounded-xl border border-[#DDE7EF] bg-white p-4">
                  <h4 className="text-lg font-bold text-[#0F172A]">Platform & Documents</h4>
                  <p className="mt-2 text-sm text-[#64748B]">
                    Document upload is managed in the current release outside this editor. Save identity and roster updates here first.
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-3">
              <div className="rounded-xl border border-[#DDE7EF] bg-white p-4">
                <h4 className="text-sm font-bold text-[#0F172A]">Filing Status</h4>
                <div className="mt-3 rounded-lg bg-[#EEF6FB] px-3 py-2 text-xs font-semibold text-[#0B8ED0]">
                  Draft Mode
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[#0F172A]"><CheckCircle2 size={12} className="text-[#16A34A]" />General Info</span>
                    <span className="font-semibold text-[#16A34A]">{editing.name?.trim() ? '100%' : 'Missing'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[#0F172A]"><AlertCircle size={12} className={getRosterStatus(editing.id).hasVicePresident ? 'text-[#16A34A]' : 'text-[#DC2626]'} />Roster Req.</span>
                    <span className={`font-semibold ${getRosterStatus(editing.id).hasVicePresident ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                      {getRosterStatus(editing.id).hasVicePresident ? 'Complete' : 'Missing VP'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[#0F172A]"><AlertCircle size={12} className="text-[#F59E0B]" />Platform Docs</span>
                    <span className="font-semibold text-[#F59E0B]">Pending</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled
                  className="mt-3 h-10 w-full rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] text-xs font-bold text-[#94A3B8]"
                >
                  Submit to Electoral Board
                </button>
              </div>

              <div className="rounded-xl border border-[#DDE7EF] bg-white p-4">
                <h4 className="text-sm font-bold text-[#0F172A]">Recent Activity</h4>
                <ul className="mt-3 space-y-2 text-xs text-[#64748B]">
                  <li>Partylist record loaded</li>
                  <li>Roster count: {getPartylistCandidates(editing.id).length}</li>
                  <li>Editing active tab: {editTab}</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>
      )}

      {error && !showAdd && !editing && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {partylistRows.length === 0 ? (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-10 text-center">
          <Flag size={36} className="mx-auto mb-3 text-[#DDE7EF]" />
          <p className="text-sm text-[#64748B]">No partylists registered for this election.</p>
        </div>
      ) : filteredPartylists.length === 0 ? (
        <div className="rounded-xl border border-[#DDE7EF] bg-white p-10 text-center">
          <Search size={30} className="mx-auto mb-3 text-[#DDE7EF]" />
          <p className="text-sm text-[#64748B]">No partylist matches your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {filteredPartylists.map((partylist, index) => {
            const partylistCandidates = candidates.filter((candidate) => candidate.partylist_id === partylist.id);
            const featured = partylistCandidates.slice(0, 2);
            const slate = partylistCandidates.slice(2);

            return (
              <article key={partylist.id} className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
                {partylist.banner_url
                  ? <img src={partylist.banner_url} alt={`${partylist.name} banner`} className="h-24 w-full object-cover" />
                  : <div className="h-2" style={{ backgroundColor: CARD_ACCENTS[index % CARD_ACCENTS.length] }} />
                }
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-lg font-extrabold text-[#0F172A]">{partylist.name}</h3>
                        {partylist.acronym && <span className="rounded-md bg-[#EEF6FB] px-2 py-0.5 text-[10px] font-bold text-[#0B8ED0]">{partylist.acronym}</span>}
                      </div>
                      <p className="mt-1 text-sm text-[#64748B]">{partylist.description || 'No party description provided yet.'}</p>
                    </div>
                    {election.status !== 'closed' && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditTab('general');
                            setEditBannerFile(null);
                            setEditBannerPreview(partylist.banner_url || null);
                            setEditing({ id: partylist.id, name: partylist.name || '', acronym: partylist.acronym || '', description: partylist.description || '' });
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#0B8ED0] transition hover:bg-[#EEF6FB]"
                        >
                          <Edit2 size={12} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(partylist.id)}
                          disabled={workingId === partylist.id}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          Remove
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-[#DDE7EF] bg-[#F8FBFD] p-4">
                    {featured.length === 0 ? (
                      <p className="text-sm font-medium text-[#94A3B8]">No assigned candidates yet.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {featured.map((candidate) => {
                          const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() || 'Unknown Candidate';
                          const position = resolvePositionTitle(candidate);
                          return (
                            <div key={candidate.id} className="text-center">
                              {candidate.image_url
                                ? <img src={candidate.image_url} alt={name} className="mx-auto h-16 w-16 rounded-full object-cover border border-[#DDE7EF]" />
                                : <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-[#DDE7EF] bg-white text-sm font-bold text-[#0F2F62]">{getInitials(name)}</div>
                              }
                              <p className="mt-2 truncate text-sm font-semibold text-[#0F172A]">{name}</p>
                              <span className="mt-1 inline-flex rounded-full bg-[#EEF6FB] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0B8ED0]">
                                {position}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-[#E5EDF3] pt-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
                      Complete Slate ({partylistCandidates.length} candidate{partylistCandidates.length !== 1 ? 's' : ''})
                    </p>
                    {slate.length > 0 && (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {slate.map((candidate) => {
                          const name = `${candidate.user?.first_name || ''} ${candidate.user?.last_name || ''}`.trim() || 'Unknown Candidate';
                          const position = resolvePositionTitle(candidate);

                          return (
                            <div key={candidate.id} className="flex items-center justify-between gap-2 rounded-md bg-[#F8FBFD] px-2.5 py-2">
                              <span className="truncate text-sm font-semibold text-[#0F172A]">{name}</span>
                              <span className="text-xs font-medium text-[#64748B]">{position}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
