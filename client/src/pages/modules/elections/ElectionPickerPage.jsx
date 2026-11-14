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
import StatusToggleSwitch from '../../../components/ui/StatusToggleSwitch';
import Textarea from '../../../components/ui/Textarea';
import { isReturned, withApprovalState } from '../../../components/elections/electionFlow';
import { electionLifecycle } from '../../../lib/lifecycle';
import { canViewElectionResults } from '../../../utils/electionAccess';
import FeedbackToast from '../../../components/FeedbackToast';
import { createElection, deleteElection, getElectionPositions, getElections, submitElection, updateElection } from '../../../services/electionService';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import { closedPeriodParams } from '../../../utils/academicPeriodStore';
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

// The titles are spelled as SboPositionSeeder spells them (an en dash in the Vice President titles).
const EXECUTIVE_POSITIONS = ['President', 'Vice President \u2013 Internal', 'Vice President \u2013 External', 'Secretary', 'Treasurer', 'Auditor', 'Public Information Officer'];
const EXECUTIVE_POSITIONS_HINT = `Adds ${EXECUTIVE_POSITIONS.slice(0, -1).join(', ')} and ${EXECUTIVE_POSITIONS.at(-1)}.`;
const YEAR_LEVELS = [[1, '1st year'], [2, '2nd year'], [3, '3rd year'], [4, '4th year']];

// Every date of a filing election, in the order each must follow the one before it.
const SCHEDULE_FIELDS = [
  ['filing_starts_at', 'Filing opens'],
  ['filing_ends_at', 'Filing closes'],
  ['screening_starts_at', 'Screening starts'],
  ['screening_ends_at', 'Screening ends'],
  ['campaign_starts_at', 'Campaign starts'],
  ['campaign_ends_at', 'Campaign ends'],
  ['start_time', 'Voting starts'],
  ['end_time', 'Voting ends'],
  ['results_publish_at', 'Results published'],
];

const ALERT = 'rounded-control border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-strong';

// vote_limit null means the voter may choose up to the seats.
const blankPosition = (patch = {}) => ({
  title: '', max_winners: 1, description: '', is_executive: false, vote_limit: null, eligible_year_levels: [], other_qualifications: '', is_active: true, ...patch,
});

// A position as the server holds it, in the shape the form edits.
const positionToForm = (position) => blankPosition({
  title: position.title || '', max_winners: position.max_winners ?? 1, description: position.description || '', is_executive: Boolean(position.is_executive), vote_limit: position.vote_limit ?? null, eligible_year_levels: Array.isArray(position.eligible_year_levels) ? position.eligible_year_levels.map(Number) : [], other_qualifications: position.other_qualifications || '', is_active: position.is_active !== false,
});

const blankElection = () => ({
  title: '', room: '', start_time: '', end_time: '', status: 'pending_approval', imageFile: null, informativeLetterFile: null,
  filing: true, draft: false, description: '', filing_starts_at: '', filing_ends_at: '', screening_starts_at: '', screening_ends_at: '', campaign_starts_at: '', campaign_ends_at: '', results_publish_at: '',
  rules: '', tie_break_rule: '', min_units: '10', min_gpa: '',
  positions: [blankPosition()],
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

// Each date must be at or after the one before it; the voting end must be after the voting start.
function scheduleOrderErrors(values) {
  const errors = {};
  SCHEDULE_FIELDS.forEach(([key, label], index) => {
    if (index === 0) return;
    const [previousKey, previousLabel] = SCHEDULE_FIELDS[index - 1];
    if (!values[key] || !values[previousKey]) return;
    const current = new Date(values[key]).getTime();
    const previous = new Date(values[previousKey]).getTime();
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return;
    if (key === 'end_time') {
      if (current <= previous) errors[key] = 'Voting end time must be after the start time.';
    } else if (current < previous) {
      errors[key] = `${label} must be at or after ${previousLabel.toLowerCase()}.`;
    }
  });
  return errors;
}

// Everything a filing election needs before it goes to the Department Head. Keys are the field the
// message sits under; schedule and positions are the two group messages.
function filingSubmitErrors(values, includePositions) {
  const errors = scheduleOrderErrors(values);
  if (SCHEDULE_FIELDS.some(([key]) => !values[key])) errors.schedule = 'Set every date in the schedule.';
  const units = String(values.min_units ?? '').trim();
  if (units !== '' && !(Number.isInteger(Number(units)) && Number(units) >= 0 && Number(units) <= 255)) errors.min_units = 'Minimum enrolled units must be a whole number from 0 to 255.';
  const gpa = String(values.min_gpa ?? '').trim();
  if (gpa !== '' && !(Number.isFinite(Number(gpa)) && Number(gpa) >= 0 && Number(gpa) < 10)) errors.min_gpa = 'Minimum GPA must be a number from 0 to 9.99.';
  if (!String(values.rules ?? '').trim()) errors.rules = 'Enter the official rules.';
  if (!String(values.tie_break_rule ?? '').trim()) errors.tie_break_rule = 'Enter the tie-break rule.';
  if (includePositions) {
    const titles = values.positions.map((item) => item.title.trim()).filter(Boolean);
    if (!titles.length) errors.positions = 'Add at least one election position.';
    else if (new Set(titles.map((title) => title.toLowerCase())).size !== titles.length) errors.positions = 'Election position titles must be unique.';
    else if (values.positions.some((item) => item.title.trim() && !(Number.isInteger(Number(item.max_winners)) && Number(item.max_winners) >= 1 && Number(item.max_winners) <= 20))) errors.positions = 'Each position needs between 1 and 20 seats.';
  }
  return errors;
}

function filingPositionPayload(position) {
  const seats = Number(position.max_winners);
  return {
    title: position.title.trim(),
    max_winners: seats,
    description: position.description.trim(),
    is_executive: Boolean(position.is_executive),
    vote_limit: Math.min(Number(position.vote_limit ?? seats), seats),
    eligible_year_levels: [...position.eligible_year_levels].sort(),
    other_qualifications: position.other_qualifications.trim(),
    is_active: position.is_active !== false,
  };
}

// A draft keeps only what has been filled in, so a draft with just a title is valid.
function filingPayload(values, { draft, includePositions }) {
  const text = (value) => String(value ?? '').trim();
  const payload = { title: values.title.trim(), imageFile: values.imageFile, informativeLetterFile: values.informativeLetterFile };
  if (values.remove_image) payload.remove_image = 1;
  if (draft) payload.draft = true;
  if (text(values.room) || !draft) payload.room = text(values.room);
  if (text(values.description) || !draft) payload.description = text(values.description);
  SCHEDULE_FIELDS.forEach(([key]) => { if (values[key]) payload[key] = localDateTimeToIso(values[key]); });
  if (text(values.rules)) payload.rules = text(values.rules);
  if (text(values.tie_break_rule)) payload.tie_break_rule = text(values.tie_break_rule);
  if (text(values.min_units) !== '') payload.min_units = Number(values.min_units);
  if (text(values.min_gpa) !== '') payload.min_gpa = Number(values.min_gpa);
  if (includePositions) {
    const positions = values.positions.filter((item) => item.title.trim()).map(filingPositionPayload);
    if (positions.length || !draft) payload.positions = positions;
  }
  return payload;
}

// A draft was saved but never submitted: submitted_at is null (older payloads carry no such field).
const isDraftElection = (election) => election?.submitted_at === null && election?.status === 'pending_approval' && !election?.declined_at;

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

function CheckField({ label, hint, className = '', ...props }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-2.5 text-sm font-medium text-ink ${className}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-700" {...props} />
      <span>{label}{hint && <span className="block text-xs font-normal text-ink-muted">{hint}</span>}</span>
    </label>
  );
}

function FilingPositionRow({ position, index, onChange, onRemove, removeDisabled }) {
  const label = `Position ${index + 1}`;
  const seats = Number(position.max_winners) || 1;
  const changeSeats = (value) => {
    const patch = { max_winners: value };
    const next = Number(value);
    if (position.vote_limit != null && next >= 1 && Number(position.vote_limit) > next) patch.vote_limit = next;
    onChange(patch);
  };
  const changeLimit = (value) => {
    if (value === '') { onChange({ vote_limit: null }); return; }
    onChange({ vote_limit: Math.max(1, Math.min(Number(value), seats)) });
  };
  const toggleYear = (year) => onChange({
    eligible_year_levels: position.eligible_year_levels.includes(year) ? position.eligible_year_levels.filter((item) => item !== year) : [...position.eligible_year_levels, year],
  });

  return (
    <div className="space-y-3 rounded-control border border-line p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-end gap-2">
        <Field label="Position title">
          <Input value={position.title} maxLength={100} onChange={(event) => onChange({ title: event.target.value })} aria-label={`${label} title`} placeholder={index === 0 ? 'e.g. President' : 'Position title'} />
        </Field>
        <button type="button" aria-label={`Remove position ${index + 1}`} disabled={removeDisabled} onClick={onRemove} className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
      </div>
      <Field label="Description" optional>
        <Input value={position.description} maxLength={255} onChange={(event) => onChange({ description: event.target.value })} aria-label={`${label} description`} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Seats">
          <Input type="number" min="1" max="20" value={position.max_winners} onChange={(event) => changeSeats(event.target.value)} aria-label={`${label} seats`} />
        </Field>
        <Field label="Voter may choose up to">
          <Input type="number" min="1" max={seats} value={position.vote_limit ?? position.max_winners} onChange={(event) => changeLimit(event.target.value)} aria-label={`${label} voter may choose up to`} />
        </Field>
      </div>
      <fieldset>
        <legend className="text-[13px] font-medium text-ink">Eligible year levels</legend>
        <p className="text-xs text-ink-muted">Tick none to let every year level run.</p>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {YEAR_LEVELS.map(([year, yearLabel]) => (
            <CheckField key={year} label={yearLabel} checked={position.eligible_year_levels.includes(year)} onChange={() => toggleYear(year)} aria-label={`${label} ${yearLabel}`} />
          ))}
        </div>
      </fieldset>
      <Field label="Other qualifications" optional>
        <Input value={position.other_qualifications} maxLength={500} onChange={(event) => onChange({ other_qualifications: event.target.value })} aria-label={`${label} other qualifications`} />
      </Field>
      <div className="flex flex-wrap gap-x-6">
        <CheckField label="Executive" hint="Fourth year students cannot run" checked={position.is_executive} onChange={(event) => onChange({ is_executive: event.target.checked })} aria-label={`${label} executive`} />
        <CheckField label="Active" checked={position.is_active} onChange={(event) => onChange({ is_active: event.target.checked })} aria-label={`${label} active`} />
      </div>
    </div>
  );
}

// `errors` holds the messages to show: the live schedule order errors, and after a submit attempt
// everything that is missing. Messages sit under the field they are about.
function ElectionFormFields({ form, setForm, editing = false, errors = {} }) {
  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const updatePosition = (index, patch) => setForm((current) => ({ ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const filing = Boolean(form.filing);
  // Before submission an election can still change kind and gets its letter and ballot from this form; the ballot of one
  // that is waiting for approval or was returned is edited here too, once its positions have loaded.
  const showLetter = !editing || form.draft;
  const showPositions = !editing || (form.positionsEditable && form.positionsReady);
  const dateField = (key, label, extra = {}) => (
    <Field key={key} label={label} required={key === 'start_time' || key === 'end_time'} error={errors[key]} {...extra}>
      <Input type="datetime-local" value={form[key]} onChange={(event) => update({ [key]: event.target.value })} />
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <StatusToggleSwitch checked={filing} disabled={editing && !form.draft} onChange={(checked) => update({ filing: checked })} label="Students file their own candidacy" showText={false} />
        <div className="min-w-0 pt-1">
          <p className="text-[13px] font-medium text-ink">Students file their own candidacy</p>
          <p className="text-xs text-ink-muted">{filing ? 'Members file candidacies and you screen them.' : 'Off: you add the candidates yourself.'}</p>
        </div>
      </div>
      <ElectionArtworkField
        id={editing ? 'edit-election-artwork' : 'create-election-artwork'}
        file={form.imageFile}
        existingUrl={form.remove_image ? '' : form.image_url}
        onChange={(imageFile) => setForm((current) => ({ ...current, imageFile, remove_image: false }))}
        onRemove={editing ? () => setForm((current) => ({ ...current, imageFile: null, image_url: '', remove_image: true })) : undefined}
      />
      {showLetter && (
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

      {filing ? (
        <>
          <Field label="Description" optional>
            <Textarea rows={3} value={form.description} maxLength={2000} onChange={(event) => update({ description: event.target.value })} />
          </Field>
          <fieldset className="border-t border-line pt-4">
            <legend className="text-[13px] font-medium text-ink">Schedule</legend>
            <p className="mt-0.5 text-xs text-ink-muted">{editing && form.approved_at ? "Times use this device's local timezone. Changing the schedule sends this election back for approval and un-finalizes the ballot, so it must be approved and finalized again." : "Times use this device's local timezone."}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {SCHEDULE_FIELDS.map(([key, label]) => dateField(key, label))}
            </div>
            {errors.schedule && <p role="alert" className="mt-2 text-xs font-semibold text-danger-strong">{errors.schedule}</p>}
          </fieldset>
          <fieldset className="border-t border-line pt-4">
            <legend className="text-[13px] font-medium text-ink">Qualifications</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Minimum enrolled units" error={errors.min_units}>
                <Input type="number" min="0" max="255" value={form.min_units} onChange={(event) => update({ min_units: event.target.value })} />
              </Field>
              <Field label="Minimum GPA" optional error={errors.min_gpa}>
                <Input type="number" min="0" step="0.01" value={form.min_gpa} onChange={(event) => update({ min_gpa: event.target.value })} />
              </Field>
            </div>
          </fieldset>
          <Field label="Official rules" required error={errors.rules}>
            <Textarea rows={6} value={form.rules} onChange={(event) => update({ rules: event.target.value })} />
          </Field>
          <Field label="Tie-break rule" required hint="How the Department Head decides a tie that remains after the runoff" error={errors.tie_break_rule}>
            <Input value={form.tie_break_rule} maxLength={500} onChange={(event) => update({ tie_break_rule: event.target.value })} />
          </Field>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voting starts" required>
            <Input type="datetime-local" value={form.start_time} onChange={(event) => update({ start_time: event.target.value })} />
          </Field>
          <Field label="Voting ends" required hint={editing && form.approved_at ? "Times use this device's local timezone. Changing the schedule sends this election back for approval and un-finalizes the ballot, so it must be approved and finalized again." : "Times use this device's local timezone."}>
            <Input type="datetime-local" value={form.end_time} onChange={(event) => update({ end_time: event.target.value })} />
          </Field>
        </div>
      )}

      {showPositions && (
        <fieldset className="border-t border-line pt-4">
          <legend className="text-[13px] font-medium text-ink">Ballot positions</legend>
          <div className="mt-3 space-y-2">
            {form.positions.map((position, index) => (filing ? (
              <FilingPositionRow
                key={`${index}-${form.positions.length}`}
                position={position}
                index={index}
                onChange={(patch) => updatePosition(index, patch)}
                onRemove={() => setForm((current) => ({ ...current, positions: current.positions.filter((_, itemIndex) => itemIndex !== index) }))}
                removeDisabled={form.positions.length === 1}
              />
            ) : (
              <div key={`${index}-${form.positions.length}`} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-2">
                <Input value={position.title} maxLength={100} onChange={(event) => updatePosition(index, { title: event.target.value })} aria-label={`Position ${index + 1} title`} placeholder={index === 0 ? 'e.g. President' : 'Position title'} />
                <Input type="number" min="1" max="20" value={position.max_winners} onChange={(event) => updatePosition(index, { max_winners: event.target.value })} aria-label={`Position ${index + 1} maximum winners`} />
                <button type="button" aria-label={`Remove position ${index + 1}`} disabled={form.positions.length === 1} onClick={() => setForm((current) => ({ ...current, positions: current.positions.filter((_, itemIndex) => itemIndex !== index) }))} className="grid h-11 w-11 place-items-center rounded-control border border-line text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            )))}
          </div>
          {errors.positions && <p role="alert" className="mt-2 text-xs font-semibold text-danger-strong">{errors.positions}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={Plus} onClick={() => setForm((current) => ({ ...current, positions: [...current.positions, blankPosition()] }))}>Add position</Button>
            <Button
              variant="secondary"
              leftIcon={Plus}
              onClick={() => setForm((current) => ({
                ...current,
                positions: [
                  ...current.positions.filter((position) => position.title.trim()),
                  ...EXECUTIVE_POSITIONS.filter((title) => !current.positions.some((position) => position.title.trim().toLowerCase() === title.toLowerCase())).map((title) => blankPosition({ title, is_executive: true })),
                ],
              }))}
            >
              Add executive positions
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{EXECUTIVE_POSITIONS_HINT}</p>
        </fieldset>
      )}
    </div>
  );
}

export default function ElectionPickerPage({ onSelect, startCreate = false, editElectionId = null, onEditClosed = null, mode = 'manage' }) {
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const userRole = currentUser?.role;
  const canManageElections = userRole === 'ADMIN';
  const managing = mode === 'manage';
  const showingResults = mode === 'results';
  const [elections, setElections] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(blankElection);
  const [editForm, setEditForm] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [closeTarget, setCloseTarget] = useState(null);
  const [statusBusy, setStatusBusy] = useState({ id: null, target: '' });
  const [feedback, setFeedback] = useState({ open: false, type: 'success', message: '' });
  const [now, setNow] = useState(() => Date.now());
  const editRequestHandled = useRef(false);

  const loadElections = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { const data = await getElections(closedPeriodParams(userRole)); setElections(Array.isArray(data) ? data : []); }
    catch { setLoadError('Unable to load elections.'); }
    finally { setLoading(false); }
  }, [userRole]);

  useEffect(() => { loadElections(); }, [loadElections]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (startCreate && canManageElections) {
      setForm(blankElection());
      setFormError('');
      setAttempted(false);
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

  const startCreateFlow = () => { setForm(blankElection()); setFormError(''); setAttempted(false); setShowCreate(true); };

  // A filing election shows the schedule order live and everything that is missing after a submit attempt.
  const formErrors = (values, includePositions) => {
    if (!values.filing) return {};
    return attempted ? filingSubmitErrors(values, includePositions) : scheduleOrderErrors(values);
  };

  // Saves a filing election: a draft keeps what is filled in, a submit needs everything. A draft that
  // already exists is saved and then submitted. Resolves with the saved election, or null when it
  // stopped on a validation message or a request error.
  const saveFiling = async (values, { draft, existingId = null }) => {
    const includePositions = !existingId || Boolean(values.positionsEditable && values.positionsReady);
    if (!draft) {
      setAttempted(true);
      const firstError = Object.values(filingSubmitErrors(values, includePositions))[0];
      if (firstError) { notify.error(firstError); return null; }
    }
    setSubmitting(true); setFormError('');
    try {
      const payload = filingPayload(values, { draft, includePositions });
      if (!existingId) return await createElection(payload);
      let saved = await updateElection(existingId, payload);
      if (!draft && values.draft) {
        const submittedElection = await submitElection(existingId);
        saved = { ...saved, ...(submittedElection && typeof submittedElection === 'object' ? submittedElection : {}) };
      }
      return saved;
    } catch (requestError) {
      const message = getApiErrorMessage(requestError, existingId ? 'Unable to update election.' : 'Unable to create election.');
      setFormError(message); notify.error(message);
      return null;
    } finally { setSubmitting(false); }
  };

  const finishCreate = (created, draft) => {
    setElections((current) => [created, ...current]); setForm(blankElection()); setAttempted(false); setShowCreate(false);
    setFeedback({ open: true, type: 'success', message: draft ? 'Draft saved.' : 'Election submitted for approval.' });
  };

  const handleSaveDraft = async () => {
    if (!form.title.trim()) return;
    const created = await saveFiling(form, { draft: true });
    if (created) finishCreate(created, true);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (form.filing) {
      const created = await saveFiling(form, { draft: false });
      if (created) finishCreate(created, false);
      return;
    }
    const validationError = validateForm(form, true);
    if (validationError) { setFormError(validationError); notify.error(validationError); return; }
    setSubmitting(true); setFormError('');
    try {
      const created = await createElection({ status: form.status, imageFile: form.imageFile, informativeLetterFile: form.informativeLetterFile, title: form.title.trim(), room: form.room.trim(), start_time: localDateTimeToIso(form.start_time), end_time: localDateTimeToIso(form.end_time), positions: form.positions.filter((item) => item.title.trim()).map((item) => ({ title: item.title.trim(), max_winners: Number(item.max_winners) })) });
      finishCreate(created, false);
    } catch (requestError) { const message = getApiErrorMessage(requestError, 'Unable to create election.'); setFormError(message); notify.error(message); }
    finally { setSubmitting(false); }
  };

  const openEdit = (election) => {
    setFormError(''); setAttempted(false);
    if (election.declined_at) {
      setEditForm({ id: election.id, title: election.title, declined: true, remarks: election.approval_remarks || '' });
      setShowEdit(true);
      return;
    }
    const draft = isDraftElection(election);
    // A draft only ever came from the filing form, even before it has a single filing date.
    const filing = Boolean(election.filing_starts_at) || draft;
    const positionsEditable = filing && election.status === 'pending_approval' && !election.approved_at;
    const local = (value) => isoToLocalDateTimeInput(value);
    setEditForm({
      id: election.id, title: election.title, room: election.room || '', image_url: election.image_url || '', imageFile: null, informativeLetterFile: null, remove_image: false, start_time: local(election.start_time), end_time: local(election.end_time), status: election.status, approved_at: election.approved_at,
      filing,
      draft,
      description: election.description || '',
      filing_starts_at: local(election.filing_starts_at), filing_ends_at: local(election.filing_ends_at), screening_starts_at: local(election.screening_starts_at), screening_ends_at: local(election.screening_ends_at), campaign_starts_at: local(election.campaign_starts_at), campaign_ends_at: local(election.campaign_ends_at), results_publish_at: local(election.results_publish_at),
      rules: election.rules || '', tie_break_rule: election.tie_break_rule || '', min_units: String(election.min_units ?? 10), min_gpa: election.min_gpa == null ? '' : String(election.min_gpa),
      positionsEditable,
      positionsReady: positionsEditable && Array.isArray(election.positions),
      positions: positionsEditable && Array.isArray(election.positions) && election.positions.length
        ? election.positions.map(positionToForm)
        : [blankPosition()],
    });
    setShowEdit(true);
    // The list rows carry only a count, so the ballot comes on its own request. Until it has loaded the positions are
    // neither shown nor sent, so saving can never drop a position that was not read.
    if (positionsEditable && !Array.isArray(election.positions)) {
      getElectionPositions(election.id)
        .then((rows) => setEditForm((current) => (current.id === election.id ? { ...current, positionsReady: true, positions: Array.isArray(rows) && rows.length ? rows.map(positionToForm) : current.positions } : current)))
        .catch((error) => notify.error(getApiErrorMessage(error, 'Unable to load the positions.')));
    }
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

  const handleSaveEditDraft = async () => {
    if (!editForm.title.trim()) return;
    const updated = await saveFiling(editForm, { draft: true, existingId: editForm.id });
    if (!updated) return;
    setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); closeEdit(updated);
    setFeedback({ open: true, type: 'success', message: 'Draft saved.' });
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (editForm.declined) return;
    if (editForm.filing) {
      const wasDraft = editForm.draft;
      const wasReturned = isReturned(elections.find((item) => item.id === editForm.id));
      const wasApproved = Boolean(editForm.approved_at);
      const updated = await saveFiling(editForm, { draft: false, existingId: editForm.id });
      if (!updated) return;
      setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); closeEdit(updated);
      setFeedback({ open: true, type: 'success', message: wasDraft ? 'Election submitted for approval.' : wasReturned ? 'Election updated and sent back for approval.' : wasApproved && !updated.approved_at ? 'Election updated and sent back for approval. Finalize the ballot again once it is approved.' : 'Election updated.' });
      return;
    }
    if (editForm.draft) {
      // A draft that was switched to the short form: the voting window and ballot are saved, then it is submitted.
      // The ballot is sent only once it was read, or saving would drop positions that were never loaded.
      if (!editForm.positionsReady) return;
      const draftError = validateForm(editForm, true);
      if (draftError) { setFormError(draftError); notify.error(draftError); return; }
      setSubmitting(true); setFormError('');
      try {
        const saved = await updateElection(editForm.id, { title: editForm.title.trim(), room: editForm.room.trim(), start_time: localDateTimeToIso(editForm.start_time), end_time: localDateTimeToIso(editForm.end_time), filing_starts_at: '', imageFile: editForm.imageFile, informativeLetterFile: editForm.informativeLetterFile, positions: editForm.positions.filter((item) => item.title.trim()).map((item) => ({ title: item.title.trim(), max_winners: Number(item.max_winners) })) });
        const submittedElection = await submitElection(editForm.id);
        const updated = { ...saved, ...(submittedElection && typeof submittedElection === 'object' ? submittedElection : {}) };
        setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); closeEdit(updated);
        setFeedback({ open: true, type: 'success', message: 'Election submitted for approval.' });
      } catch (requestError) { const message = getApiErrorMessage(requestError, 'Unable to update election.'); setFormError(message); notify.error(message); }
      finally { setSubmitting(false); }
      return;
    }
    const validationError = validateForm(editForm, false);
    if (validationError) { setFormError(validationError); notify.error(validationError); return; }
    const wasReturned = isReturned(elections.find((item) => item.id === editForm.id));
    const wasApproved = Boolean(editForm.approved_at);
    setSubmitting(true); setFormError('');
    try {
      const updated = await updateElection(editForm.id, { title: editForm.title.trim(), room: editForm.room.trim(), start_time: localDateTimeToIso(editForm.start_time), end_time: localDateTimeToIso(editForm.end_time), status: editForm.status, imageFile: editForm.imageFile, remove_image: editForm.remove_image ? 1 : undefined });
      setElections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); closeEdit(updated);
      setFeedback({ open: true, type: 'success', message: wasReturned ? 'Election updated and sent back for approval.' : wasApproved && !updated.approved_at ? 'Election updated and sent back for approval. Finalize the ballot again once it is approved.' : 'Election updated.' });
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

  const handleClose = async () => {
    const target = closeTarget;
    setCloseTarget(null);
    await handleStatusChange(target.id, 'closed');
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
      canManageElections && election.status !== 'closed' && !election.declined_at && { label: returned ? 'Edit and resubmit' : 'Edit', icon: PencilLine, onClick: () => openEdit(election) },
      canManageElections && !['active', 'closed'].includes(election.status) && votes === 0 && { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDeleteTarget(election) },
      canManageElections && election.status === 'upcoming' && election.finalized_at && !(Date.parse(election.start_time) > now) && { label: 'Open voting', icon: Power, disabled: Boolean(statusBusy.id), onClick: () => handleStatusChange(election.id, 'active') },
      canManageElections && election.status === 'active' && !election.filing_starts_at && { label: 'Close', icon: PowerOff, disabled: Boolean(statusBusy.id), onClick: () => setCloseTarget(election) },
    ].filter(Boolean);
  };
  const hasRowActions = managing && elections.some((election) => rowActions(election).length > 0);

  const columns = [
    {
      key: 'title',
      header: 'Election',
      render: (election) => {
        const returned = isReturned(election);
        const declined = Boolean(election.declined_at);
        const lifecycle = electionLifecycle(withApprovalState(election), currentUser?.role);
        return (
          <div className="min-w-0 text-left">
            <button type="button" onClick={() => onSelect?.(election.id)} className="min-h-10 rounded-control text-left text-sm font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline">{formatDisplayText(election.title)}</button>
            {managing && !declined && <p className="text-xs text-ink-muted">Next: {isDraftElection(election) ? 'Finish the setup and submit for approval' : lifecycle.nextAction.title}</p>}
            {(returned || declined) && election.approval_remarks && <p className="text-xs text-danger-strong">Reason: {election.approval_remarks}</p>}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (election) => {
        const returned = isReturned(election);
        if (election.declined_at) return <StatusBadge tone="danger" label="Rejected" />;
        if (isDraftElection(election)) return <StatusBadge tone="neutral" label="Draft" />;
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
    votes_count: { key: 'votes_count', header: 'Ballots', align: 'right', render: (election) => election.voters_count ?? 0 },
  };
  const shownCounts = { manage: ['positions_count', 'candidates_count', 'votes_count'], candidates: ['candidates_count'], partylists: [], voters: ['votes_count'], results: ['votes_count'] }[mode] || [];
  columns.push(...shownCounts.map((key) => countColumns[key]));

  const filters = listedElections.length > 0 && (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {listedElections.length > 0 && <Input type="search" className="sm:max-w-xs" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} aria-label="Search elections" placeholder="Search elections" />}
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
  } else if (!managing && canManageElections) {
    firstRunState = <EmptyState icon={Vote} title="No elections yet" description="Create an election first." action={<Button variant="secondary" to="/dashboard/elections/manage-elections">Go to elections</Button>} />;
  } else if (canManageElections) {
    firstRunState = <EmptyState icon={Vote} title="Create your first election" description="Submit an election for Department Head approval, then build its ballot with party lists and candidates." action={<Button leftIcon={Plus} onClick={startCreateFlow}>Create your first election</Button>} />;
  } else if (currentUser?.role === 'STUDENT') {
    firstRunState = <EmptyState icon={Vote} title="No election is currently open" description="Voting opens after the Admin finalizes and opens an election. Turnout is shown during voting, and results appear when the election closes." />;
  } else {
    firstRunState = <EmptyState kind="restricted" title="No elections yet" description="Only the Admin creates elections. It appears here once the Department Head approves it." />;
  }

  // The create form has more than five fields and an upload, so it is a page, not a modal. The list
  // and its Create election button are not rendered while it is open, which leaves one filled button.
  if (showCreate && canManageElections) {
    const createErrors = formErrors(form, true);
    return (
      <div className="space-y-4">
        <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
        <PageHeader title="Create election" />
        <form id="create-election-form" onSubmit={handleCreate} noValidate={form.filing} className="max-w-3xl space-y-4">
          <ElectionFormFields form={form} setForm={setForm} errors={createErrors} />
          {formError && <p role="alert" className={ALERT}>{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={submitting}>Cancel</Button>
            {form.filing && <Button variant="secondary" onClick={handleSaveDraft} disabled={submitting || !form.title.trim()}>Save draft</Button>}
            <Button type="submit" loading={submitting} disabled={!form.title.trim() || (!form.filing && (!form.start_time || !form.end_time))}>Submit for approval</Button>
          </div>
        </form>
      </div>
    );
  }

  let editFooter;
  if (editForm.declined) {
    editFooter = <Button variant="secondary" onClick={() => closeEdit()}>Close</Button>;
  } else if (editForm.filing) {
    editFooter = (
      <>
        <Button variant="secondary" onClick={() => closeEdit()} disabled={submitting}>Cancel</Button>
        {editForm.draft && <Button variant="secondary" onClick={handleSaveEditDraft} disabled={submitting || !editForm.title?.trim()}>Save draft</Button>}
        <Button type="submit" form="edit-election-form" loading={submitting} disabled={!editForm.title?.trim()}>{editForm.draft ? 'Submit for approval' : 'Save changes'}</Button>
      </>
    );
  } else {
    editFooter = <><Button variant="secondary" onClick={() => closeEdit()} disabled={submitting}>Cancel</Button><Button type="submit" form="edit-election-form" loading={submitting} disabled={!editForm.title || !editForm.start_time || !editForm.end_time || (editForm.draft && !editForm.positionsReady)}>{editForm.draft ? 'Submit for approval' : 'Save changes'}</Button></>;
  }

  return (
    <div className="space-y-4">
      <FeedbackToast feedback={feedback} onClose={() => setFeedback({ open: false })} />
      <PageHeader {...MODE_HEADERS[mode]} primary={managing && canManageElections && (loading || elections.length > 0) ? <Button leftIcon={Plus} onClick={startCreateFlow}>Create election</Button> : undefined} />
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

      <Drawer open={showEdit && canManageElections} title="Edit election" description={editForm.declined ? undefined : editForm.filing ? 'Update the schedule, rules and positions.' : 'Update the artwork and schedule.'} onClose={() => !submitting && closeEdit()} width={editForm.filing ? 'max-w-2xl' : 'max-w-xl'} footer={editFooter}>
        {editForm.declined ? (
          <div className="space-y-2">
            <p role="alert" className={ALERT}>The Department Head rejected this election</p>
            {editForm.remarks && <p className="text-sm text-ink">{editForm.remarks}</p>}
          </div>
        ) : (
          <form id="edit-election-form" onSubmit={handleEdit} noValidate={Boolean(editForm.filing)}><ElectionFormFields form={editForm} setForm={setEditForm} editing errors={formErrors(editForm, Boolean(editForm.positionsEditable && editForm.positionsReady))} />{formError && <p role="alert" className={`mt-4 ${ALERT}`}>{formError}</p>}</form>
        )}
      </Drawer>
      <ConfirmModal open={Boolean(closeTarget)} title="Close election" message="Closing ends voting and cannot be undone. Voters can no longer submit ballots. Winners become upcoming officers; their access starts on the officer start date and the outgoing officers keep access until the school year ends." recordName={closeTarget?.title || ''} confirmText="Close election" variant="danger" onCancel={() => setCloseTarget(null)} onConfirm={handleClose} />
      <ConfirmModal open={Boolean(deleteTarget)} title="Delete election" message="This permanently removes the election setup, candidates, and approval request." recordName={deleteTarget?.title || ''} confirmText="Delete" variant="danger" busy={deleting} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}
