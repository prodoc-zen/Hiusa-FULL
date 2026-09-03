import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
  PencilLine,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
  Upload,
  Vote,
} from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import FeedbackToast from '../../../components/FeedbackToast';
import Modal from '../../../components/Modal';
import PaginationControls from '../../../components/PaginationControls';
import { createElection, deleteElection, getElections, updateElection } from '../../../services/electionService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { getApiErrorMessage } from '../../../utils/apiError';
import { isoToLocalDateTimeInput, localDateTimeToIso } from '../../../utils/dateTime';

const statusStyles = {
  pending_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  upcoming: 'border-blue-200 bg-blue-50 text-[#0B8ED0]',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-slate-200 bg-slate-100 text-slate-600',
};

const statusLabels = {
  pending_approval: 'Pending Approval',
  upcoming: 'Upcoming',
  active: 'Live',
  closed: 'Closed',
};

const blankElection = () => ({
  title: '', start_time: '', end_time: '', status: 'pending_approval', imageFile: null,
  positions: [{ title: '', max_winners: 1 }],
});

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatTimeline(election) {
  if (election.status === 'pending_approval') return 'Awaiting Department Head review';
  const now = Date.now();
  const start = new Date(election.start_time).getTime();
  const end = new Date(election.end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Schedule unavailable';
  const hours = Math.max(1, Math.ceil(((election.status === 'active' ? end - now : start - now) / 3_600_000)));
  if (election.status === 'active') return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
  if (election.status === 'upcoming') return `Starts in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `Ended ${new Date(end).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
}

function getVotingPeriodError(startTime, endTime) {
  if (!startTime || !endTime) return 'Set both the voting start and end time.';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Use a valid voting start and end time.';
  if (end <= start) return 'Voting end time must be after the start time.';
  return '';
}

function getElectionVoteCount(election) {
  const count = Number(election?.votes_count ?? election?.votes?.length ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function ElectionArtworkField({ id, file, existingUrl = '', onChange, onRemove }) {
  const [preview, setPreview] = useState(existingUrl ? resolveAssetUrl(existingUrl) : '');

  useEffect(() => {
    if (!file) {
      setPreview(existingUrl ? resolveAssetUrl(existingUrl) : '');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, existingUrl]);

  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Election artwork</span>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
        <div className="relative aspect-video overflow-hidden rounded-lg border border-[#DDE7EF] bg-[#0F2F62]">
          {preview ? <img src={preview} alt="Election artwork preview" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-white/75"><Vote size={36} /></div>}
        </div>
        <div>
          <label htmlFor={id} className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-[#0F172A] hover:bg-[#F8FBFD]">
            <Upload size={16} /> {preview ? 'Replace image' : 'Choose image'}
          </label>
          <input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] || null)} />
          <p className="mt-2 text-xs leading-5 text-[#64748B]">Use a wide JPG, PNG, or WebP image up to 5 MB. A 16:9 image works best.</p>
          {preview && onRemove && <button type="button" onClick={onRemove} className="mt-1 text-xs font-bold text-red-600 hover:underline">Remove artwork</button>}
        </div>
      </div>
    </div>
  );
}

function ElectionFormFields({ form, setForm, editing = false }) {
  return (
    <div className="space-y-5">
      <ElectionArtworkField
        id={editing ? 'edit-election-artwork' : 'create-election-artwork'}
        file={form.imageFile}
        existingUrl={form.remove_image ? '' : form.image_url}
        onChange={(imageFile) => setForm((current) => ({ ...current, imageFile, remove_image: false }))}
        onRemove={editing ? () => setForm((current) => ({ ...current, imageFile: null, image_url: '', remove_image: true })) : undefined}
      />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Election title *</span>
        <input data-autofocus value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. HIUSA General Elections 2026" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none placeholder:text-[#94A3B8] focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Voting starts *</span>
          <input type="datetime-local" value={form.start_time} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-[#0F172A]">Voting ends *</span>
          <input type="datetime-local" value={form.end_time} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
        </label>
      </div>
      <p className="-mt-3 text-xs text-[#64748B]">Times use this device’s local timezone.</p>

      {!editing && (
        <fieldset className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><legend className="text-[13px] font-bold text-[#0F172A]">Ballot positions *</legend><p className="mt-0.5 text-xs text-[#64748B]">Add every position voters will see.</p></div>
            <button type="button" onClick={() => setForm((current) => ({ ...current, positions: [...current.positions, { title: '', max_winners: 1 }] }))} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[#0B8ED0]/30 bg-white px-3 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]"><Plus size={14} /> Add position</button>
          </div>
          <div className="mt-3 space-y-3">
            {form.positions.map((position, index) => (
              <div key={`${index}-${form.positions.length}`} className="grid gap-2 rounded-lg border border-[#DDE7EF] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_110px_42px] sm:border-0 sm:bg-transparent sm:p-0">
                <label><span className="mb-1 block text-[11px] font-bold text-[#64748B] sm:sr-only">Position title</span><input value={position.title} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} aria-label={`Position ${index + 1} title`} placeholder={index === 0 ? 'e.g. President' : 'Position title'} className="h-10 w-full min-w-0 rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" /></label>
                <label><span className="mb-1 block text-[11px] font-bold text-[#64748B] sm:sr-only">Maximum winners</span><input type="number" min="1" max="20" value={position.max_winners} onChange={(event) => setForm((current) => ({ ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { ...item, max_winners: event.target.value } : item) }))} aria-label={`Position ${index + 1} maximum winners`} className="h-10 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" /></label>
                <button type="button" aria-label={`Remove position ${index + 1}`} disabled={form.positions.length === 1} onClick={() => setForm((current) => ({ ...current, positions: current.positions.filter((_, itemIndex) => itemIndex !== index) }))} className="grid h-10 w-full place-items-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-30 sm:w-10"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export default function ElectionPickerPage({ onSelect }) {
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const canManageElections = currentUser?.role === 'ADMIN';
  const [elections, setElections] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(blankElection);
  const [editForm, setEditForm] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [statusBusy, setStatusBusy] = useState({ id: null, target: '' });
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const pageSize = 6;

  const loadElections = async () => {
    setLoading(true); setError('');
    try { const data = await getElections(); setElections(Array.isArray(data) ? data : []); }
    catch { setError('Unable to load elections.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadElections(); }, []);

  const filteredElections = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return elections.filter((election) => (statusFilter === 'all' || election.status === statusFilter) && (!query || String(election.title || '').toLowerCase().includes(query)));
  }, [elections, searchTerm, statusFilter]);
  useEffect(() => { setPage(1); }, [searchTerm, statusFilter]);
  const pagedElections = filteredElections.slice((page - 1) * pageSize, page * pageSize);

  const validateForm = (values, includePositions) => {
    const periodError = getVotingPeriodError(values.start_time, values.end_time);
    if (periodError) return periodError;
    if (!includePositions) return '';
    const positions = values.positions.map((item) => item.title.trim()).filter(Boolean);
    if (!positions.length) return 'Add at least one election position.';
    if (new Set(positions.map((title) => title.toLowerCase())).size !== positions.length) return 'Election position titles must be unique.';
    return '';
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    const validationError = validateForm(form, true);
    if (validationError) return setFormError(validationError);
    setSubmitting(true); setFormError('');
    try {
      const created = await createElection({ ...form, title: form.title.trim(), start_time: localDateTimeToIso(form.start_time), end_time: localDateTimeToIso(form.end_time), positions: form.positions.filter((item) => item.title.trim()).map((item) => ({ title: item.title.trim(), max_winners: Number(item.max_winners) })) });
      setElections((current) => [created, ...current]); setForm(blankElection()); setShowCreate(false);
      setFeedback({ open: true, type: 'success', message: 'Election submitted for approval.' });
    } catch (requestError) { setFormError(getApiErrorMessage(requestError, 'Unable to create election.')); }
    finally { setSubmitting(false); }
  };

  const openEdit = (election) => {
    setFormError('');
    setEditForm({ id: election.id, title: election.title, image_url: election.image_url || '', imageFile: null, remove_image: false, start_time: isoToLocalDateTimeInput(election.start_time), end_time: isoToLocalDateTimeInput(election.end_time), status: election.status });
    setShowEdit(true);
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    const validationError = validateForm(editForm, false);
    if (validationError) return setFormError(validationError);
    setSubmitting(true); setFormError('');
    try {
      const updated = await updateElection(editForm.id, { title: editForm.title.trim(), start_time: localDateTimeToIso(editForm.start_time), end_time: localDateTimeToIso(editForm.end_time), status: editForm.status, imageFile: editForm.imageFile, remove_image: editForm.remove_image ? 1 : undefined });
      setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); setShowEdit(false);
      setFeedback({ open: true, type: 'success', message: 'Election updated.' });
    } catch (requestError) { setFormError(getApiErrorMessage(requestError, 'Unable to update election.')); }
    finally { setSubmitting(false); }
  };

  const handleStatusChange = async (id, status) => {
    if (statusBusy.id) return;
    setStatusBusy({ id, target: status }); setError('');
    try {
      const updated = await updateElection(id, { status });
      setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setFeedback({ open: true, type: 'success', message: status === 'active' ? 'Election opened for voting.' : 'Election closed.' });
    } catch (requestError) { setError(getApiErrorMessage(requestError, 'Unable to update election status.')); }
    finally { setStatusBusy({ id: null, target: '' }); }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try { await deleteElection(deleteTarget.id, { confirmed: 1 }); setElections((current) => current.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null); setFeedback({ open: true, type: 'success', message: 'Election deleted.' }); }
    catch (requestError) { setDeleteTarget(null); setError(getApiErrorMessage(requestError, 'Unable to delete election.')); }
    finally { setDeleting(false); }
  };

  return (
    <div className="space-y-5">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
      <section className="rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><Vote size={20} /></div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#0B8ED0]">Election workspace</p>
            <h1 className="mt-1 text-2xl font-black text-[#0F172A] sm:text-3xl">Choose an election first</h1>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">Select one election to open its candidates, ballot setup, voters, and results in a focused workspace.</p>
          </div>
          {canManageElections && <button type="button" onClick={() => { setForm(blankElection()); setFormError(''); setShowCreate(true); }} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] sm:w-auto"><Plus size={16} /> Create election</button>}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative"><span className="sr-only">Search elections</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by election title..." className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0B8ED0]" /></label>
          <select aria-label="Filter elections by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm font-semibold text-[#0F172A] outline-none focus:border-[#0B8ED0]"><option value="all">All statuses</option><option value="pending_approval">Pending approval</option><option value="upcoming">Upcoming</option><option value="active">Live</option><option value="closed">Closed</option></select>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
      {loading && <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading elections">{[1, 2, 3, 4].map((item) => <div key={item} className="h-96 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />)}<span className="sr-only">Loading elections...</span></div>}
      {!loading && filteredElections.length === 0 && <section className="rounded-xl border border-dashed border-[#DDE7EF] bg-white p-10 text-center"><Vote size={36} className="mx-auto text-[#94A3B8]" /><h2 className="mt-3 text-base font-bold text-[#0F172A]">No elections found</h2><p className="mt-1 text-sm text-[#64748B]">Try another search or create the first election.</p></section>}

      {!loading && pagedElections.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {pagedElections.map((election) => {
            const votes = getElectionVoteCount(election);
            const isBusy = statusBusy.id === election.id;
            return (
              <article key={election.id} className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm transition hover:border-[#0B8ED0]/40">
                <div className="relative aspect-[16/7] overflow-hidden bg-[#0F2F62]">
                  {election.image_url ? <img src={resolveAssetUrl(election.image_url)} alt="" className="h-full w-full object-cover transition duration-300 hover:scale-[1.02]" /> : <div className="grid h-full place-items-center text-white/70"><Vote size={46} /></div>}
                  <div className="absolute inset-0 bg-[#0B1831]/20" />
                  <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusStyles[election.status] || statusStyles.closed}`}>{election.status === 'active' && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}{statusLabels[election.status] || election.status}</span>
                </div>
                <div className="p-4 sm:p-5">
                  <h2 className="text-xl font-black leading-tight text-[#0F172A]">{election.title}</h2>
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#64748B]"><Clock3 size={13} /> {formatTimeline(election)}</p>
                  <div className="mt-4 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-3"><div className="flex items-start gap-2 text-xs text-[#64748B]"><CalendarDays size={14} className="mt-0.5 shrink-0 text-[#0B8ED0]" /><span>{formatDateTime(election.start_time)}<br />{formatDateTime(election.end_time)}</span></div></div>
                  <div className="mt-4 grid grid-cols-3 divide-x divide-[#DDE7EF] border-y border-[#DDE7EF] py-3 text-center"><div><p className="text-lg font-black text-[#0F172A]">{election.positions_count ?? 0}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Positions</p></div><div><p className="text-lg font-black text-[#0F172A]">{election.candidates_count ?? 0}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Candidates</p></div><div><p className="text-lg font-black text-[#0F172A]">{votes}</p><p className="text-[10px] font-bold uppercase text-[#64748B]">Votes</p></div></div>
                  <button type="button" onClick={() => onSelect?.(election.id)} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7]">Select election <ChevronRight size={16} /></button>
                  {canManageElections && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEF6FB] pt-3">
                      <button type="button" onClick={() => openEdit(election)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#DDE7EF] px-3 text-xs font-bold text-[#0F172A] hover:bg-[#F8FBFD]"><PencilLine size={14} /> Edit</button>
                      <button type="button" onClick={() => setDeleteTarget(election)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-bold text-red-600 hover:bg-red-50"><Trash2 size={14} /> Delete</button>
                      {election.status === 'pending_approval' && <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700"><CheckCircle2 size={14} /> In review</span>}
                      {election.status !== 'pending_approval' && election.status !== 'active' && <button type="button" disabled={Boolean(statusBusy.id)} onClick={() => handleStatusChange(election.id, 'active')} className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{isBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Power size={14} />} Open</button>}
                      {election.status === 'active' && <button type="button" disabled={Boolean(statusBusy.id)} onClick={() => handleStatusChange(election.id, 'closed')} className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">{isBusy ? <LoaderCircle size={14} className="animate-spin" /> : <PowerOff size={14} />} Close</button>}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {!loading && filteredElections.length > pageSize && <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm"><PaginationControls currentPage={page} totalItems={filteredElections.length} pageSize={pageSize} onPageChange={setPage} label="elections" /></div>}

      <Modal open={showCreate && canManageElections} title="Create election" description="Build the ballot and submit it for Department Head approval." onClose={() => !submitting && setShowCreate(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-3xl" footer={<div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowCreate(false)} disabled={submitting} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-[#64748B] hover:bg-[#F8FBFD]">Cancel</button><button type="submit" form="create-election-form" disabled={submitting || !form.title.trim() || !form.start_time || !form.end_time} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-40">{submitting ? 'Submitting...' : 'Submit for approval'}</button></div>}>
        <form id="create-election-form" onSubmit={handleCreate}><ElectionFormFields form={form} setForm={setForm} />{formError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</div>}</form>
      </Modal>
      <Modal open={showEdit && canManageElections} title="Edit election" description="Update election branding and schedule." onClose={() => !submitting && setShowEdit(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-3xl" footer={<div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowEdit(false)} disabled={submitting} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-[#64748B] hover:bg-[#F8FBFD]">Cancel</button><button type="submit" form="edit-election-form" disabled={submitting || !editForm.title || !editForm.start_time || !editForm.end_time} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-40">{submitting ? 'Saving...' : 'Save changes'}</button></div>}>
        <form id="edit-election-form" onSubmit={handleEdit}><ElectionFormFields form={editForm} setForm={setEditForm} editing />{formError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</div>}</form>
      </Modal>
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete Election" message={getElectionVoteCount(deleteTarget) > 0 ? `This permanently removes the election and ${getElectionVoteCount(deleteTarget)} cast vote${getElectionVoteCount(deleteTarget) === 1 ? '' : 's'}.` : 'This permanently removes the election setup, candidates, and approval request.'} recordName={deleteTarget?.title || ''} confirmText={getElectionVoteCount(deleteTarget) > 0 ? 'Delete Anyway' : 'Delete'} variant="danger" busy={deleting} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}
