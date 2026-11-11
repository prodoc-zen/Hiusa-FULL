import TableRowActions from '../../../components/TableRowActions';
import { matchesFilter } from '../../../utils/filterValues';
import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import notify from '../../../lib/notify';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  PencilLine,
  Plus,
  Power,
  PowerOff,
  Trash2,
  Vote,
} from 'lucide-react';
import ConfirmModal from '../../../components/ConfirmModal';
import Button from '../../../components/ui/Button';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import EmptyState from '../../../components/ui/EmptyState';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import { isReturned, withApprovalState } from '../../../components/elections/electionFlow';
import { electionLifecycle } from '../../../lib/lifecycle';
import { canViewElectionResults } from '../../../utils/electionAccess';
import FeedbackToast from '../../../components/FeedbackToast';
import { createElection, deleteElection, getElections, updateElection } from '../../../services/electionService';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { getAcademicPeriods } from '../../../services/systemAdministrationService';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { getApiErrorMessage } from '../../../utils/apiError';
import { isoToLocalDateTimeInput, localDateTimeToIso } from '../../../utils/dateTime';

const statusTones = {
  pending_approval: 'warning',
  upcoming: 'info',
  active: 'success',
  closed: 'neutral',
};

const statusLabels = {
  pending_approval: 'Pending approval',
  upcoming: 'Upcoming',
  active: 'Open',
  closed: 'Closed',
};

const EXECUTIVE_POSITIONS = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor', 'Business Manager', 'Public Information Officer'];

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

const blankElection = () => ({
  title: '', room: '', start_time: '', end_time: '', status: 'pending_approval', imageFile: null, informativeLetterFile: null,
  positions: [{ title: '', max_winners: 1 }],
});

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
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

// The Hub passes the screen the Admin or officer came from. Only the Elections screen manages
// elections; the others are a chooser for the screen they asked for.
const MODE_HEADERS = {
  candidates: { title: 'Choose an election', description: 'Pick the election whose candidates you want to manage.' },
  partylists: { title: 'Choose an election', description: 'Pick the election whose party lists you want to manage.' },
  voters: { title: 'Choose an election', description: 'Pick the election whose voters you want to review.' },
  results: { title: 'Election results' },
};

function FileInput({ id, file, buttonLabel, className = '', ...props }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <input id={id} type="file" className="peer sr-only" {...props} />
      <label htmlFor={id} className="inline-flex h-10 cursor-pointer items-center rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-subtle peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600">{file ? 'Choose another file' : buttonLabel}</label>
      <span className="min-w-0 truncate text-sm text-ink-muted">{file ? file.name : 'No file selected'}</span>
    </div>
  );
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
    <div className="space-y-2">
      {preview && <img src={preview} alt="Election artwork preview" className="aspect-video w-48 rounded-control border border-line object-cover" />}
      <Field label="Election artwork" optional hint="A wide JPG, PNG or WebP image up to 5 MB. A 16:9 image works best.">
        <FileInput id={id} file={file} buttonLabel="Choose image" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(event.target.files?.[0] || null)} />
      </Field>
      {preview && onRemove && <button type="button" onClick={onRemove} className="rounded-control text-sm font-medium text-danger-strong underline underline-offset-2 hover:text-danger">Remove artwork</button>}
    </div>
  );
}

function ElectionFormFields({ form, setForm, editing = false }) {
  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const updatePosition = (index, patch) => setForm((current) => ({ ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));

  return (
    <div className="space-y-4">
      <ElectionArtworkField
        id={editing ? 'edit-election-artwork' : 'create-election-artwork'}
        file={form.imageFile}
        existingUrl={form.remove_image ? '' : form.image_url}
        onChange={(imageFile) => setForm((current) => ({ ...current, imageFile, remove_image: false }))}
        onRemove={editing ? () => setForm((current) => ({ ...current, imageFile: null, image_url: '', remove_image: true })) : undefined}
      />
      {!editing && (
        <Field label="Informative letter (PDF)" required hint="Attach it before submitting for approval. Maximum 10 MB.">
          <FileInput file={form.informativeLetterFile} buttonLabel="Choose PDF" accept="application/pdf,.pdf" onChange={(event) => update({ informativeLetterFile: event.target.files?.[0] || null })} />
        </Field>
      )}
      <Field label="Election title" required>
        <Input data-autofocus value={form.title} onChange={(event) => update({ title: event.target.value })} placeholder="e.g. HIUSA General Elections 2026" />
      </Field>
      <Field label="Voting room" optional>
        <Input value={form.room || ''} maxLength={120} onChange={(event) => update({ room: event.target.value })} placeholder="Online ballot or room name" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Voting starts" required>
          <Input type="datetime-local" value={form.start_time} onChange={(event) => update({ start_time: event.target.value })} />
        </Field>
        <Field label="Voting ends" required hint="Times use this device's local timezone.">
          <Input type="datetime-local" value={form.end_time} onChange={(event) => update({ end_time: event.target.value })} />
        </Field>
      </div>

      {!editing && (
        <fieldset className="border-t border-line pt-4">
          <legend className="text-[13px] font-medium text-ink">Ballot positions</legend>
          <p className="mt-0.5 text-xs text-ink-muted">Add every position voters will see.</p>
          <div className="mt-3 space-y-2">
            {form.positions.map((position, index) => (
              <div key={`${index}-${form.positions.length}`} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-2">
                <Input value={position.title} maxLength={100} onChange={(event) => updatePosition(index, { title: event.target.value })} aria-label={`Position ${index + 1} title`} placeholder={index === 0 ? 'e.g. President' : 'Position title'} />
                <Input type="number" min="1" max="20" value={position.max_winners} onChange={(event) => updatePosition(index, { max_winners: event.target.value })} aria-label={`Position ${index + 1} maximum winners`} />
                <button type="button" aria-label={`Remove position ${index + 1}`} disabled={form.positions.length === 1} onClick={() => setForm((current) => ({ ...current, positions: current.positions.filter((_, itemIndex) => itemIndex !== index) }))} className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={Plus} onClick={() => setForm((current) => ({ ...current, positions: [...current.positions, { title: '', max_winners: 1 }] }))}>Add position</Button>
            <Button
              variant="secondary"
              leftIcon={Plus}
              onClick={() => setForm((current) => ({
                ...current,
                positions: [
                  ...current.positions.filter((position) => position.title.trim()),
                  ...EXECUTIVE_POSITIONS.filter((title) => !current.positions.some((position) => position.title.trim().toLowerCase() === title.toLowerCase())).map((title) => ({ title, max_winners: 1 })),
                ],
              }))}
            >
              Add executive positions
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Adds President, Vice President, Secretary, Treasurer, Auditor, Business Manager and Public Information Officer.</p>
        </fieldset>
      )}
    </div>
  );
}

export default function ElectionPickerPage({ onSelect, startCreate = false, editElectionId = null, onEditClosed = null, mode = 'manage' }) {
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const canManageElections = currentUser?.role === 'ADMIN';
  const managing = mode === 'manage';
  const showingResults = mode === 'results';
  const [elections, setElections] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [academicPeriods, setAcademicPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
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
  const editRequestHandled = useRef(false);
  const viewingHistory = Boolean(selectedPeriodId) && Number(selectedPeriodId) !== academicPeriods.find((period) => period.status === 'active')?.id;

  const loadElections = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { const data = await getElections({ academic_semester_id: selectedPeriodId || undefined }); setElections(Array.isArray(data) ? data : []); }
    catch { setLoadError('Unable to load elections.'); }
    finally { setLoading(false); }
  }, [selectedPeriodId]);

  useEffect(() => { loadElections(); }, [loadElections]);
  useEffect(() => { getAcademicPeriods().then(setAcademicPeriods).catch(() => setAcademicPeriods([])); }, []);
  useEffect(() => {
    if (startCreate && canManageElections) {
      setForm(blankElection());
      setFormError('');
      setShowCreate(true);
    }
  }, [canManageElections, startCreate]);

  const listedElections = useMemo(() => (showingResults ? elections.filter((election) => canViewElectionResults(election, currentUser?.role)) : elections), [elections, showingResults, currentUser?.role]);

  const filteredElections = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return listedElections.filter((election) => matchesFilter(statusFilter, election.status) && (!query || String(election.title || '').toLowerCase().includes(query)));
  }, [listedElections, searchTerm, statusFilter]);
  const filtersActive = Boolean(searchTerm.trim()) || statusFilter !== 'all';
  const clearFilters = () => { setSearchTerm(''); setStatusFilter('all'); };

  const validateForm = (values, includePositions) => {
    const periodError = getVotingPeriodError(values.start_time, values.end_time);
    if (periodError) return periodError;
    if (!includePositions) return '';
    const positions = values.positions.map((item) => item.title.trim()).filter(Boolean);
    if (!positions.length) return 'Add at least one election position.';
    if (new Set(positions.map((title) => title.toLowerCase())).size !== positions.length) return 'Election position titles must be unique.';
    return '';
  };

  const startCreateFlow = () => { setForm(blankElection()); setFormError(''); setShowCreate(true); };

  const handleCreate = async (event) => {
    event.preventDefault();
    const validationError = validateForm(form, true);
    if (validationError) { setFormError(validationError); notify.error(validationError); return; }
    setSubmitting(true); setFormError('');
    try {
      const created = await createElection({ ...form, title: form.title.trim(), room: form.room.trim(), start_time: localDateTimeToIso(form.start_time), end_time: localDateTimeToIso(form.end_time), positions: form.positions.filter((item) => item.title.trim()).map((item) => ({ title: item.title.trim(), max_winners: Number(item.max_winners) })) });
      setElections((current) => [created, ...current]); setForm(blankElection()); setShowCreate(false);
      setFeedback({ open: true, type: 'success', message: 'Election submitted for approval.' });
    } catch (requestError) { const message = getApiErrorMessage(requestError, 'Unable to create election.'); setFormError(message); notify.error(message); }
    finally { setSubmitting(false); }
  };

  const openEdit = (election) => {
    setFormError('');
    setEditForm({ id: election.id, title: election.title, room: election.room || '', image_url: election.image_url || '', imageFile: null, remove_image: false, start_time: isoToLocalDateTimeInput(election.start_time), end_time: isoToLocalDateTimeInput(election.end_time), status: election.status });
    setShowEdit(true);
  };

  const closeEdit = (updated = null) => {
    setShowEdit(false);
    if (editElectionId) onEditClosed?.(updated);
  };

  useEffect(() => {
    if (!editElectionId || editRequestHandled.current || loading || !canManageElections) return;
    editRequestHandled.current = true;
    const target = elections.find((item) => String(item.id) === String(editElectionId));
    if (target) openEdit(target);
    else onEditClosed?.(null);
  });

  const handleEdit = async (event) => {
    event.preventDefault();
    const validationError = validateForm(editForm, false);
    if (validationError) { setFormError(validationError); notify.error(validationError); return; }
    const wasReturned = isReturned(elections.find((item) => item.id === editForm.id));
    setSubmitting(true); setFormError('');
    try {
      const updated = await updateElection(editForm.id, { title: editForm.title.trim(), room: editForm.room.trim(), start_time: localDateTimeToIso(editForm.start_time), end_time: localDateTimeToIso(editForm.end_time), status: editForm.status, imageFile: editForm.imageFile, remove_image: editForm.remove_image ? 1 : undefined });
      setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); closeEdit(updated);
      setFeedback({ open: true, type: 'success', message: wasReturned ? 'Election updated and sent back for approval.' : 'Election updated.' });
    } catch (requestError) { const message = getApiErrorMessage(requestError, 'Unable to update election.'); setFormError(message); notify.error(message); }
    finally { setSubmitting(false); }
  };

  const handleStatusChange = async (id, status) => {
    if (statusBusy.id) return;
    setStatusBusy({ id, target: status }); setActionError('');
    try {
      const updated = await updateElection(id, { status });
      setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setFeedback({ open: true, type: 'success', message: status === 'active' ? 'Election opened for voting.' : 'Election closed.' });
    } catch (requestError) { const message = getApiErrorMessage(requestError, 'Unable to update election status.'); setActionError(message); notify.error(message); }
    finally { setStatusBusy({ id: null, target: '' }); }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try { await deleteElection(deleteTarget.id); setElections((current) => current.filter((item) => item.id !== deleteTarget.id)); setDeleteTarget(null); setFeedback({ open: true, type: 'success', message: 'Election deleted.' }); }
    catch (requestError) { const message = getApiErrorMessage(requestError, 'Unable to delete election.'); setDeleteTarget(null); setActionError(message); notify.error(message); }
    finally { setDeleting(false); }
  };

  const rowActions = (election) => {
    const votes = getElectionVoteCount(election);
    const returned = isReturned(election);
    return [
      election.has_informative_letter && currentUser?.role !== 'STUDENT' && { label: 'View informative letter', icon: Eye, onClick: () => openProtectedFile(`/elections/${election.id}/informative-letter`).catch((error) => notify.error(getApiErrorMessage(error, 'Unable to open the letter.'))) },
      canManageElections && !viewingHistory && election.status !== 'closed' && { label: returned ? 'Edit and resubmit' : 'Edit', icon: PencilLine, onClick: () => openEdit(election) },
      canManageElections && !viewingHistory && !['active', 'closed'].includes(election.status) && votes === 0 && { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDeleteTarget(election) },
      canManageElections && !viewingHistory && election.status === 'upcoming' && election.finalized_at && { label: 'Open voting', icon: Power, disabled: Boolean(statusBusy.id), onClick: () => handleStatusChange(election.id, 'active') },
      canManageElections && !viewingHistory && election.status === 'active' && { label: 'Close', icon: PowerOff, disabled: Boolean(statusBusy.id), onClick: () => handleStatusChange(election.id, 'closed') },
    ].filter(Boolean);
  };
  const hasRowActions = managing && elections.some((election) => rowActions(election).length > 0);

  const columns = [
    {
      key: 'title',
      header: 'Election',
      render: (election) => {
        const returned = isReturned(election);
        const lifecycle = electionLifecycle(withApprovalState(election), currentUser?.role);
        return (
          <div className="min-w-0 text-left">
            <button type="button" onClick={() => onSelect?.(election.id)} className="min-h-10 rounded-control text-left text-sm font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline">{formatDisplayText(election.title)}</button>
            {managing && <p className="text-xs text-ink-muted">Next: {lifecycle.nextAction.title}</p>}
            {returned && election.approval_remarks && <p className="text-xs text-danger-strong">Reason: {election.approval_remarks}</p>}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (election) => {
        const returned = isReturned(election);
        return (
          <StatusBadge tone={returned ? 'danger' : statusTones[election.status] || 'neutral'} label={returned ? 'Returned' : statusLabels[election.status] || election.status} />
        );
      },
    },
    {
      key: 'period',
      header: 'Voting period',
      render: (election) => (
        <div className="text-left text-xs text-ink-muted-strong">
          <p>{formatDateTime(election.start_time)}</p>
          <p>{formatDateTime(election.end_time)}</p>
          <p>{election.room || 'Online ballot'}</p>
        </div>
      ),
    },
  ];
  const countColumns = {
    positions_count: { key: 'positions_count', header: 'Positions', align: 'right', render: (election) => election.positions_count ?? 0 },
    candidates_count: { key: 'candidates_count', header: 'Candidates', align: 'right', render: (election) => election.candidates_count ?? 0 },
    votes_count: { key: 'votes_count', header: 'Votes', align: 'right', render: (election) => getElectionVoteCount(election) },
  };
  const shownCounts = { manage: ['positions_count', 'candidates_count', 'votes_count'], candidates: ['candidates_count'], partylists: [], voters: ['votes_count'], results: ['votes_count'] }[mode] || [];
  columns.push(...shownCounts.map((key) => countColumns[key]));

  const filters = (academicPeriods.length > 0 || listedElections.length > 0) && (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {listedElections.length > 0 && <Input type="search" className="sm:max-w-xs" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} aria-label="Search elections" placeholder="Search elections" />}
      {academicPeriods.length > 0 && (
        <HiusaSelect filter className="w-full sm:w-64" aria-label="Academic period" value={selectedPeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)}>
          <option value="">Active period</option>
          {academicPeriods.map((period) => <option key={period.id} value={period.id}>AY {period.academic_year.label}, {period.number === 1 ? '1st' : '2nd'} semester, {period.status}</option>)}
        </HiusaSelect>
      )}
      {listedElections.length > 0 && (
        <HiusaSelect filter className="w-full sm:w-48" aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending_approval">Pending approval</option>
          <option value="upcoming">Upcoming</option>
          <option value="active">Open</option>
          <option value="closed">Closed</option>
        </HiusaSelect>
      )}
      {filtersActive && <button type="button" onClick={clearFilters} className="min-h-10 rounded-control text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
    </div>
  );

  let firstRunState;
  if (showingResults) {
    firstRunState = <EmptyState icon={Vote} title="No results yet" description="Totals appear once an election is open for voting." />;
  } else if (!managing && canManageElections && !viewingHistory) {
    firstRunState = <EmptyState icon={Vote} title="No elections yet" description="Create an election first." action={<Button variant="secondary" to="/dashboard/elections/manage-elections">Go to elections</Button>} />;
  } else if (canManageElections && !viewingHistory) {
    firstRunState = <EmptyState icon={Vote} title="Create your first election" description="Submit an election for Department Head approval, then build its ballot with party lists and candidates." action={<Button leftIcon={Plus} onClick={startCreateFlow}>Create your first election</Button>} />;
  } else if (canManageElections) {
    firstRunState = <EmptyState icon={Vote} title="No elections in this semester" description="Switch the academic period to see other elections." />;
  } else if (currentUser?.role === 'STUDENT') {
    firstRunState = <EmptyState icon={Vote} title="No election is currently open" description="Voting opens after the Admin finalizes and opens an election. Turnout is shown during voting, and results appear when the election closes." />;
  } else {
    firstRunState = <EmptyState kind="restricted" title="No elections yet" description="Only the Admin creates elections. It appears here once the Department Head approves it." />;
  }

  // The create form has more than five fields and an upload, so it is a page, not a modal. The list
  // and its Create election button are not rendered while it is open, which leaves one filled button.
  if (showCreate && canManageElections) {
    return (
      <div className="space-y-4">
        <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
        <PageHeader title="Create election" />
        <form id="create-election-form" onSubmit={handleCreate} className="max-w-3xl space-y-4">
          <ElectionFormFields form={form} setForm={setForm} />
          {formError && <p role="alert" className={ALERT}>{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" loading={submitting} disabled={!form.title.trim() || !form.start_time || !form.end_time}>Submit for approval</Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
      <PageHeader {...MODE_HEADERS[mode]} primary={managing && canManageElections && !viewingHistory && (loading || elections.length > 0) ? <Button leftIcon={Plus} onClick={startCreateFlow}>Create election</Button> : undefined} />
      {viewingHistory && <p className="text-sm text-ink-muted">Completed semester elections are available for viewing only.</p>}
      {actionError && <p role="alert" className={ALERT}>{actionError}</p>}

      <DataTable
        caption="Elections"
        columns={columns}
        rows={filteredElections}
        loading={loading}
        error={loadError || null}
        onRetry={loadElections}
        filters={filters || null}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
        emptyState={listedElections.length > 0 ? <EmptyState kind="filtered" title="No elections match" description="Try another search or status." onClearFilters={clearFilters} /> : firstRunState}
        actions={hasRowActions ? (election) => {
          const actions = rowActions(election);
          return actions.length > 0 ? <TableRowActions subject={formatDisplayText(election.title)} actions={actions} /> : null;
        } : undefined}
      />

      <Drawer open={showEdit && canManageElections} title="Edit election" description="Update the artwork and schedule." onClose={() => !submitting && closeEdit()} width="max-w-xl" footer={<><Button variant="secondary" onClick={() => closeEdit()} disabled={submitting}>Cancel</Button><Button type="submit" form="edit-election-form" loading={submitting} disabled={!editForm.title || !editForm.start_time || !editForm.end_time}>Save changes</Button></>}>
        <form id="edit-election-form" onSubmit={handleEdit}><ElectionFormFields form={editForm} setForm={setEditForm} editing />{formError && <p role="alert" className={`mt-4 ${ALERT}`}>{formError}</p>}</form>
      </Drawer>
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete election" message="This permanently removes the election setup, candidates, and approval request." recordName={deleteTarget?.title || ''} confirmText="Delete" variant="danger" busy={deleting} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}
