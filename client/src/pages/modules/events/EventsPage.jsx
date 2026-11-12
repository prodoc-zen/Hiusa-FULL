import { filterValues, matchesFilter } from '../../../utils/filterValues';
import { peso as formatCurrency } from '../../../lib/format';
import HiusaSelect from '../../../components/ui/Select';
import { formatDisplayText } from '../../../utils/displayText.js';
import { manilaDateStamp } from '../../../utils/dateTime';
import { closedPeriodParams } from '../../../utils/academicPeriodStore';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  Calendar,
  CalendarCheck2,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Fingerprint,
  ImagePlus,
  List,
  Pencil,
  Plus,
  Search,
  UserCheck,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { getEvents, getEvent, createEvent, updateEvent, deleteEvent, getEventRequirements, submitEventRequirements, updateEventStatus, generateEventPlan, getEventWorkflowHistory, confirmEventWorkflow, discardEventWorkflow, getAttendance, recordAttendance } from '../../../services/eventService';
import { getVenues } from '../../../services/venueService';
import { getTasks, previewTaskRecommendation } from '../../../services/taskService';
import { getAcademicStructure, getUsers } from '../../../services/userService';
import PaginationControls from '../../../components/PaginationControls';
import TableRowActions from '../../../components/TableRowActions';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import AccessibleOverlay from '../../../components/AccessibleOverlay';
import { fetchAllPages } from '../../../services/pagination';
import ActivityCalendar from '../../../components/calendar/ActivityCalendar';
import PersonalAttendanceSummary from '../../../components/events/PersonalAttendanceSummary';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import { getApiErrorMessage } from '../../../utils/apiError';
import { resolveAssetUrl } from '../../../utils/assetUrl';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import notify from '../../../lib/notify';
import { formatDateTime, isoToLocalDateTimeInput, localDateTimeToIso, replaceIsoDateTimes } from '../../../utils/dateTime';
import { useFingerprintReader } from '../../../hooks/useFingerprintReader';
import { confirmFingerprintAttendance, identifyAttendanceFingerprint } from '../../../services/fingerprintService';
import ScannerStatus from '../../../components/fingerprint/ScannerStatus';
import EventSubmissionPanel from '../../../components/events/EventSubmissionPanel';
import EventRegistrationPanel from '../../../components/events/EventRegistrationPanel';
import { EventFlowFooter, EventFlowPanel, EventRowProgress } from '../../../components/events/EventFlow';
import { FILE_STAGES, RETURNED_STAGES, eventFlow, stageText } from '../../../components/events/eventStage';
import useRequirementProgress from '../../../components/events/useRequirementProgress';
import { budgetLifecycle } from '../../../lib/lifecycle';
import { Button, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonTable, SkeletonText, StatusBadge, Textarea } from '../../../components/ui';
import PersonPicker from '../../../components/people/PersonPicker';
import useRecordParam from '../../../lib/useRecordParam';
import { buildCsv } from '../../../utils/csv';

const eventStatusTone = {
  planning: 'warning',
  ongoing: 'active',
  completed: 'success',
  cancelled: 'danger',
};

const statusLabel = {
  planning: 'Pending approval',
};

const budgetApprovalTone = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

// An approved event is the normal state, so it reads as plain text and only the others get a badge.
function EventStatus({ event, text }) {
  if (!event?.status) return null;
  const tone = eventStatusTone[event.status];
  if (!tone) return <span className="text-xs text-ink-muted">{text}</span>;
  return <StatusBadge tone={tone} label={text} />;
}

// A task nobody has started is the normal state, so it reads as plain text and only the others get a badge.
function TaskStatus({ task }) {
  const status = task.workflow_status || task.status;
  if (status === 'pending' || status === 'ready') return <span className="text-xs text-ink-muted">{capitalize(status)}</span>;
  return <StatusBadge status={status} label={capitalize(status)} />;
}

function AttendanceStatus({ status }) {
  const value = status || 'present';
  if (value === 'present') return <span className="text-xs text-ink-muted">Present</span>;
  return <StatusBadge status={value} label={capitalize(value)} />;
}

function BudgetApproval({ status }) {
  const value = status || 'pending';
  return <StatusBadge tone={budgetApprovalTone[value] || 'warning'} label={capitalize(value)} />;
}

const allowedStatusTransitions = {
  planning: ['cancelled'],
  approved: ['ongoing', 'completed', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const canCancelEvent = (evt) => allowedStatusTransitions[evt.status]?.includes('cancelled') ?? false;

function capitalize(s) {
  return s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '-';
}

const workflowStatusLabel = {
  pending: 'Needs review',
  accepted: 'Tasks created',
  discarded: 'Removed',
  rejected: 'Could not create',
};

const workflowPhaseLabel = {
  pre_event: 'Before the event',
  event_day: 'During the event',
  post_event: 'After the event',
};

function scoreLabel(value) {
  const score = Number(value);
  return Number.isFinite(score) ? `${Math.round(score)}/100` : 'Not available';
}

// Pending and approved are the ordinary states of a budget, so they read as plain text and only a problem gets a badge.
function getEventBudgetStatus(event) {
  if (!event.budgets?.length) {
    return event.requires_budget
      ? { label: 'Not linked', tone: 'danger' }
      : { label: 'Not required', tone: null };
  }
  if (event.budgets.some((budget) => budget.approval_status === 'rejected')) return { label: 'Rejected', tone: budgetApprovalTone.rejected };
  if (event.budgets.some((budget) => budget.approval_status === 'pending' || !budget.approval_status)) return { label: 'Pending', tone: null };
  return { label: 'Approved', tone: null };
}

function BudgetStatus({ event }) {
  const { label, tone } = getEventBudgetStatus(event);
  if (!tone) return <span className="text-xs text-ink-muted">{label}</span>;
  return <StatusBadge tone={tone} label={label} />;
}

const emptyEventForm = () => ({
  title: '', date: '', startTime: '', endDate: '', endTime: '', venue_type: 'on_campus', venue_id: '', location: '', description: '', imageFile: null,
  requires_budget: false, event_type: '', expected_participants: '', requirements: '', resources: '',
  proposed_budget_amount: '', budget_warning_threshold: '', budget_notes: '', vendor_deadlines: '', logistics_checklist: '',
  proposed_budget_id: null,
});

const REQUEST_SELECTOR_PATH = '/dashboard/approval-requests/new';

const attendanceYearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

// The reader client talks to a local agent, so the page only reaches for it once the operator asks.
// A machine that has connected before reconnects on load.
const READER_FLAG = 'hiusa_fingerprint_reader';

function BiometricCheckIn(props) {
  const [readerOn, setReaderOn] = useState(() => {
    try { return localStorage.getItem(READER_FLAG) === 'on'; } catch { return false; }
  });

  if (readerOn) return <FingerprintScanPanel {...props} />;

  function connect() {
    try { localStorage.setItem(READER_FLAG, 'on'); } catch {}
    setReaderOn(true);
  }

  return (
    <div className="flex flex-col">
      <h4 className="text-sm font-semibold text-ink">Fingerprint check-in / checkout</h4>
      <p className="mt-1 text-sm text-ink-muted">Connect the reader to this computer, then scan. You confirm each match before it is recorded.</p>
      <div className="mt-3">
        <Button variant="secondary" leftIcon={Fingerprint} onClick={connect}>Connect reader</Button>
      </div>
    </div>
  );
}

function FingerprintScanPanel({ eventId, onRecorded, users = [], department = '', academicStructure = null, academicStructureError = '' }) {
  const reader = useFingerprintReader();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [selectedYearLevels, setSelectedYearLevels] = useState([]);
  const [selectedProgram, setSelectedProgram] = useState('');
  const [selectedSection, setSelectedSection] = useState('');

  const scopedUsers = users.filter((user) => user.role === 'STUDENT' && (!department || user.department === department));
  const configuredPrograms = Array.isArray(academicStructure?.programs) ? academicStructure.programs : null;
  const programOptions = configuredPrograms
    ? configuredPrograms.map((program) => program.name).filter(Boolean).sort()
    : [...new Set(scopedUsers.map((user) => user.program).filter(Boolean))].sort();
  const configuredSections = configuredPrograms
    ? configuredPrograms
      .filter((program) => matchesFilter(selectedProgram, program.name))
      .flatMap((program) => program.sections || [])
      .filter((section) => !selectedYearLevels.length || selectedYearLevels.includes(attendanceYearLevels[Number(section.year_level) - 1]))
      .map((section) => section.name)
    : scopedUsers
      .filter((user) => (matchesFilter(selectedProgram, user.program))
        && (!selectedYearLevels.length || selectedYearLevels.includes(user.year_level)))
      .map((user) => user.section);
  const sectionOptions = [...new Set(configuredSections.filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  useEffect(() => {
    if (!Array.isArray(academicStructure?.programs)) return;

    const configuredProgramNames = academicStructure.programs.map((program) => program.name).filter(Boolean);
    if (filterValues(selectedProgram).some((value) => !configuredProgramNames.includes(value))) {
      setSelectedProgram('');
      setSelectedSection('');
      return;
    }

    const validSections = academicStructure.programs
      .filter((program) => matchesFilter(selectedProgram, program.name))
      .flatMap((program) => program.sections || [])
      .filter((section) => !selectedYearLevels.length || selectedYearLevels.includes(attendanceYearLevels[Number(section.year_level) - 1]))
      .map((section) => section.name);
    if (filterValues(selectedSection).some((value) => !validSections.includes(value))) setSelectedSection('');
  }, [academicStructure, selectedProgram, selectedSection, selectedYearLevels]);

  function clearCandidate() {
    setPendingConfirmation(null);
    setResult(null);
  }

  function toggleYearLevel(yearLevel) {
    clearCandidate();
    setSelectedYearLevels((current) => current.includes(yearLevel)
      ? current.filter((value) => value !== yearLevel)
      : [...current, yearLevel]);
    setSelectedSection('');
  }

  async function scan() {
    if (!reader.connected || busy) return;
    setBusy(true);
    setResult(null);
    setPendingConfirmation(null);
    try {
      // Fscanner identification extracts one probe and compares it to every
      // compatible enrollment. No account needs to be selected first.
      const capture = await reader.identifyFingerprint();
      const response = await identifyAttendanceFingerprint(eventId, capture, {
        ...(selectedYearLevels.length ? { year_levels: selectedYearLevels } : {}),
        ...(selectedProgram ? { programs: filterValues(selectedProgram) } : {}),
        ...(selectedSection ? { sections: filterValues(selectedSection) } : {}),
      });
      setPendingConfirmation(response.data);
    } catch (scanError) {
      setResult({
        type: scanError?.response?.status === 409 ? 'warning' : 'error',
        message: getApiErrorMessage(scanError, scanError?.message || 'Fingerprint identification failed.'),
        user: scanError?.response?.data?.user,
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pendingConfirmation?.confirmation_token || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await confirmFingerprintAttendance(eventId, pendingConfirmation.confirmation_token);
      setPendingConfirmation(null);
      setResult({ type: 'success', message: response.data.message, user: response.data.user });
      await onRecorded();
    } catch (confirmationError) {
      setPendingConfirmation(null);
      setResult({
        type: confirmationError?.response?.status === 409 ? 'warning' : 'error',
        message: getApiErrorMessage(confirmationError, 'Fingerprint attendance confirmation failed. Scan again.'),
        user: confirmationError?.response?.data?.user,
      });
    } finally {
      setBusy(false);
    }
  }

  const rejectCandidate = () => {
    setPendingConfirmation(null);
    setResult({ type: 'warning', message: 'Candidate rejected. Scan the correct Student’s finger.' });
  };

  const confirmationAction = pendingConfirmation?.action === 'check_out' ? 'Checkout' : 'Check-In';

  return (
    <>
    <div className="flex flex-col">
      <h4 className="text-sm font-semibold text-ink">Fingerprint check-in / checkout</h4>
      <div className="mt-3"><ScannerStatus reader={reader} /></div>
      <fieldset disabled={busy || Boolean(pendingConfirmation)} className="mt-4 border-t border-line pt-4 disabled:opacity-60">
        <legend className="sr-only">Narrow fingerprint candidates</legend>
        <p className="text-sm text-ink-muted-strong"><span className="font-semibold text-ink">Required scope:</span> active Students in {department || 'this organization’s configured department'} only.</p>
        <p className="mt-3 text-xs font-semibold text-ink-muted">Year level (optional)</p>
        {academicStructureError && <p role="alert" className="mt-2 rounded-control border border-warning/40 bg-warning-tint px-3 py-2 text-xs font-medium text-warning-strong">{academicStructureError}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {attendanceYearLevels.map((yearLevel) => (
            <label key={yearLevel} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-2.5 text-xs font-medium ${selectedYearLevels.includes(yearLevel) ? 'border-brand-600 bg-brand-600/10 text-ink' : 'border-line bg-surface text-ink-muted-strong'}`}>
              <input type="checkbox" checked={selectedYearLevels.includes(yearLevel)} onChange={() => toggleYearLevel(yearLevel)} className="h-4 w-4 accent-brand-600" /> {yearLevel}
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Program" optional>
            <HiusaSelect filter aria-label="Fingerprint program filter" value={selectedProgram} onChange={(event) => { clearCandidate(); setSelectedProgram(event.target.value); setSelectedSection(''); }}>
              <option value="">All programs</option>
              {programOptions.map((program) => <option key={program} value={program}>{program}</option>)}
            </HiusaSelect>
          </Field>
          <Field label="Section" optional>
            <HiusaSelect filter aria-label="Fingerprint section filter" value={selectedSection} onChange={(event) => { clearCandidate(); setSelectedSection(event.target.value); }}>
              <option value="">All sections</option>
              {sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
            </HiusaSelect>
          </Field>
        </div>
      </fieldset>
      {result && <div className={`mt-3 rounded-control border px-3 py-2.5 text-sm ${result.type === 'success' ? 'border-success/30 bg-success-tint text-success-strong' : result.type === 'warning' ? 'border-warning/40 bg-warning-tint text-warning-strong' : 'border-danger/30 bg-danger-tint text-danger-strong'}`}>
        {result.user && <p className="mb-0.5 font-semibold">{formatDisplayText(result.user.first_name)} {formatDisplayText(result.user.last_name)} · {result.user.school_id}</p>}
        <p>{result.message}</p>
      </div>}
      <div className="flex flex-wrap gap-2 pt-4">
        <Button variant="secondary" leftIcon={Fingerprint} onClick={scan} disabled={!reader.connected || busy || Boolean(pendingConfirmation)} className="flex-1">
          {busy ? 'Scanning and identifying...' : 'Scan fingerprint'}
        </Button>
        {busy && !pendingConfirmation && <Button variant="secondary" onClick={reader.cancelCapture}>Cancel</Button>}
      </div>
    </div>

    <Modal
      open={Boolean(pendingConfirmation)}
      title={`Confirm fingerprint ${confirmationAction.toLowerCase()}`}
      description="Verify the matched Student before changing the attendance register."
      onClose={busy ? undefined : rejectCandidate}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={pendingConfirmation ? <>
        <Button variant="secondary" onClick={rejectCandidate} disabled={busy}>No, scan again</Button>
        <Button data-autofocus onClick={confirm} loading={busy}>{`Confirm ${confirmationAction.toLowerCase()}`}</Button>
      </> : null}
    >
      {pendingConfirmation && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-white">{pendingConfirmation.user?.first_name?.[0]}{pendingConfirmation.user?.last_name?.[0]}</span>
            <div className="min-w-0"><p className="text-sm font-semibold text-ink">Is this the correct Student?</p><p className="mt-1 truncate text-base font-semibold text-ink">{formatDisplayText(pendingConfirmation.user?.first_name)} {formatDisplayText(pendingConfirmation.user?.last_name)}</p><p className="text-xs text-ink-muted">School ID {pendingConfirmation.user?.school_id} · {[pendingConfirmation.user?.program, pendingConfirmation.user?.year_level, pendingConfirmation.user?.section].filter(Boolean).join(' · ') || 'Academic profile unavailable'}</p></div>
          </div>
          <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs">
            <div><dt className="text-ink-muted">Action</dt><dd className="mt-1 text-sm font-semibold text-ink">{pendingConfirmation.action === 'check_out' ? 'Check out' : 'Check in'}</dd></div>
            <div><dt className="text-ink-muted">Match score</dt><dd className="mt-1 text-sm font-semibold tabular-nums text-ink">{Number(pendingConfirmation.match?.score ?? 0).toFixed(1)} <span className="font-normal text-ink-muted">/ required {Number(pendingConfirmation.match?.threshold ?? 60).toFixed(0)}</span></dd></div>
          </dl>
          <p className="text-sm text-ink-muted-strong">Only confirm when the Student’s face and School ID match the person at the reader.</p>
        </div>
      )}
    </Modal>
    </>
  );
}

export default function EventsPage({ initialTab = 'events', startEventRequest = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [recordId, setRecordId] = useRecordParam();
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  let currentUser = {};
  try { currentUser = JSON.parse(localStorage.getItem('user') ?? '{}') ?? {}; } catch {}
  const currentUserRole = currentUser?.role ?? '';
  const viewParam = searchParams.get('view');
  const eventsView = ['calendar', 'list'].includes(viewParam)
    ? viewParam
    : (currentUserRole === 'STUDENT' ? 'list' : (location.pathname.endsWith('activity-calendar') ? 'calendar' : 'list'));
  const [events, setEvents] = useState([]);
  const [eventRows, setEventRows] = useState([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventListLoading, setEventListLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [eventStatusFilter, setEventStatusFilter] = useState('');
  const [eventSort, setEventSort] = useState('start_asc');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [submissionVersion, setSubmissionVersion] = useState(0);
  const detailsRequestRef = useRef(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventReload, setEventReload] = useState(0);
  const [campusVenues, setCampusVenues] = useState([]);
  const [activeEventRequirements, setActiveEventRequirements] = useState([]);
  const [attachedEventFiles, setAttachedEventFiles] = useState({});
  const [attachedFileErrors, setAttachedFileErrors] = useState({});
  const [attendancePage, setAttendancePage] = useState(1);
  const pageSize = 20;
  const eventPageSize = 20;

  const [form, setForm] = useState(emptyEventForm);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [planForm, setPlanForm] = useState({ event_id: '', requirements: '' });
  const [planResult, setPlanResult] = useState('');
  const [workflowDraft, setWorkflowDraft] = useState(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [workflowOutputId, setWorkflowOutputId] = useState(null);
  const [workflowAction, setWorkflowAction] = useState(false);
  const [rankingTaskKey, setRankingTaskKey] = useState(null);
  const [workflowHistory, setWorkflowHistory] = useState([]);
  const [workflowHistoryError, setWorkflowHistoryError] = useState('');
  const [planError, setPlanError] = useState(null);
  const [planSubmitting, setPlanSubmitting] = useState(false);

  const [selectedAttEventId, setSelectedAttEventId] = useState(null);
  const [attendanceData, setAttendanceData] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [rosterReload, setRosterReload] = useState(0);
  const [attendanceAcademicStructure, setAttendanceAcademicStructure] = useState(null);
  const [attendanceAcademicStructureError, setAttendanceAcademicStructureError] = useState('');
  const [checkInPerson, setCheckInPerson] = useState(null);
  const [checkInStatus, setCheckInStatus] = useState('present');
  const [checkInSubmitting, setCheckInSubmitting] = useState(false);
  const [checkInError, setCheckInError] = useState(null);
  const [checkInSuccess, setCheckInSuccess] = useState(null);
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [debouncedAttendanceSearch, setDebouncedAttendanceSearch] = useState('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState('all');
  const [attendanceMeta, setAttendanceMeta] = useState({ currentPage: 1, lastPage: 1, perPage: 10, total: 0 });
  const [attendanceReload, setAttendanceReload] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [eventToDelete, setEventToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [eventToCancel, setEventToCancel] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);


  const canCreateEvents = currentUserRole === 'ADMIN';
  const canManageAttendance = ['ADMIN', 'SBO_OFFICER'].includes(currentUserRole);
  const seesEventFlow = ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'].includes(currentUserRole);
  const holdsEventFiles = ['ADMIN', 'DEPARTMENT_HEAD'].includes(currentUserRole);
  const requirementProgress = useRequirementProgress(selectedEvent?.id, holdsEventFiles && selectedEvent?.requirements_required === true && !detailsLoading, submissionVersion);
  const selectedFlow = selectedEvent && seesEventFlow ? eventFlow(selectedEvent, currentUserRole, requirementProgress) : null;

  useEffect(() => {
    if (currentUserRole === 'ADMIN') getVenues({ per_page: 100 }).then((response) => setCampusVenues(response.data?.data || [])).catch(() => setCampusVenues([]));
  }, [currentUserRole]);

  function load() {
    setLoading(true);
    setError(null);
    // Calendar/dropdown sources need the complete authorized event set. The
    // browsable event table is loaded separately with backend pagination.
    const canLoadTasks = currentUserRole === 'ADMIN' || currentUserRole === 'SBO_OFFICER';
    const requests = canLoadTasks
      ? [fetchAllPages((p) => getEvents({ ...p, ...closedPeriodParams(currentUserRole) }).then((r) => r.data)), fetchAllPages((p) => getTasks(p).then((r) => r.data))]
      : [fetchAllPages((p) => getEvents({ ...p, ...closedPeriodParams(currentUserRole) }).then((r) => r.data)), Promise.resolve([])];
    Promise.all(requests)
      .then(([eventList, taskList]) => {
        setEvents(eventList);
        setTasks(taskList);
        setEventReload((value) => value + 1);
      })
      .catch((requestError) => setError(getApiErrorMessage(requestError, 'We could not load your events and tasks. Check your connection and try again.')))
      .finally(() => setLoading(false));
  }

  useEffect(load, [currentUserRole]);

  async function confirmDeleteEvent() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteEvent(eventToDelete.id);
      notify.success(`"${eventToDelete.title}" deleted.`);
      setEventToDelete(null);
      load();
    } catch (requestError) {
      setDeleteError(getApiErrorMessage(requestError, 'This event could not be deleted.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function confirmCancelEvent() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await updateEventStatus(eventToCancel.id, 'cancelled');
      notify.success(`"${eventToCancel.title}" cancelled.`);
      setEventToCancel(null);
      load();
    } catch (requestError) {
      setCancelError(getApiErrorMessage(requestError, 'This event could not be cancelled.'));
    } finally {
      setCancelBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setEventListLoading(true);
      getEvents({ page: eventsPage, per_page: eventPageSize, search: search || undefined, date: dateFilter || undefined, status: eventStatusFilter || undefined, sort: eventSort, ...closedPeriodParams(currentUserRole) })
        .then((response) => {
          if (!active) return;
          setEventRows(Array.isArray(response.data?.data) ? response.data.data : []);
          setEventTotal(Number(response.data?.total || 0));
        })
        .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, 'We could not load the event list. Check your connection and try again.')); })
        .finally(() => { if (active) setEventListLoading(false); });
    }, 250);

    return () => { active = false; window.clearTimeout(timer); };
  }, [currentUserRole, dateFilter, eventPageSize, eventReload, eventSort, eventStatusFilter, eventsPage, search]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (startEventRequest && canCreateEvents) {
      setActiveTab('events');
      setEditingEventId(null);
      setForm(emptyEventForm());
      setFormError(null);
      setShowForm(true);
    }
  }, [canCreateEvents, startEventRequest]);

  function changeEventsView(view) {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (searchParams.get('new') !== '1' || activeTab !== 'events' || !canCreateEvents) return;
    openCreateForm();
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canCreateEvents, searchParams]);

  useEffect(() => {
    if (!recordId) {
      if (selectedEvent) closeLocalDetails();
      return;
    }
    if (String(selectedEvent?.id) === recordId) return;
    const known = [...eventRows, ...events].find((event) => String(event.id) === recordId);
    loadEventDetails(known ?? { id: Number(recordId) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab !== 'attendance' || !canManageAttendance || usersLoaded) return undefined;
    let active = true;
    setRosterError(false);
    // /users is paginated - check-in search needs the full active roster,
    // not just its first page.
    fetchAllPages(getUsers, { account_status: 'active' })
      .then((data) => {
        if (!active) return;
        setAllUsers(data);
        setUsersLoaded(true);
      })
      .catch(() => { if (active) setRosterError(true); });
    return () => { active = false; };
  }, [activeTab, canManageAttendance, usersLoaded, rosterReload]);

  useEffect(() => {
    if (activeTab !== 'attendance' || !canManageAttendance) return undefined;

    let active = true;
    getAcademicStructure()
      .then((structure) => {
        if (!active) return;
        setAttendanceAcademicStructure(structure);
        setAttendanceAcademicStructureError('');
      })
      .catch(() => {
        if (!active) return;
        setAttendanceAcademicStructure(null);
        setAttendanceAcademicStructureError('Program and section settings could not be refreshed. The fallback choices come from existing Student records.');
      });

    return () => { active = false; };
  }, [activeTab, attendanceReload, canManageAttendance]);

  function handleSelectAttEvent(id) {
    if (id === selectedAttEventId) return;
    setSelectedAttEventId(id);
    setAttendanceData(null);
    setAttendanceLoading(true);
    setCheckInPerson(null);
    setCheckInStatus('present');
    setCheckInError(null);
    setCheckInSuccess(null);
    setAttendanceSearch('');
    setDebouncedAttendanceSearch('');
    setAttendanceStatusFilter('all');
    setAttendancePage(1);
  }

  async function handleCheckIn() {
    if (!canManageAttendance || !checkInPerson) return;
    setCheckInSubmitting(true);
    setCheckInError(null);
    setCheckInSuccess(null);
    try {
      await recordAttendance(selectedAttEventId, {
        user_id: checkInPerson.school_id,
        method: 'manual',
        status: checkInStatus,
      });
      setCheckInPerson(null);
      setCheckInSuccess('Check-in recorded.');
      setAttendanceReload((value) => value + 1);
    } catch (err) {
      const msg = getApiErrorMessage(err, 'We could not record this check-in. Try again.');
      setCheckInError(msg);
      notify.error(msg);
    } finally {
      setCheckInSubmitting(false);
    }
  }

  const eventPlaceChosen = form.venue_type === 'on_campus' ? Boolean(form.venue_id) : Boolean(form.location.trim());
  const venueRequirements = activeEventRequirements.filter((r) => r.is_active !== false && (!r.venue_type || r.venue_type === 'all' || r.venue_type === form.venue_type));
  const missingRequiredFiles = editingEventId ? [] : venueRequirements.filter((r) => !r.is_optional && !attachedEventFiles[r.id]);

  async function handleSaveEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.date || !form.startTime || !form.endDate || !form.endTime || !eventPlaceChosen || missingRequiredFiles.length > 0) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      const start_time = `${form.date}T${form.startTime}:00`;
      const end_time = `${form.endDate}T${form.endTime}:00`;
      if (end_time && end_time <= start_time) {
        setFormError('End date/time must be after start date/time.');
        setFormSubmitting(false);
        return;
      }
      if (form.requires_budget && !form.budget_notes.trim()) {
        setFormError('Add the expected expenses or funding notes for this event budget.');
        setFormSubmitting(false);
        return;
      }
      if (form.proposed_budget_amount && Number(form.budget_warning_threshold || 0) > Number(form.proposed_budget_amount)) {
        setFormError('The warning threshold cannot exceed the proposed budget.');
        setFormSubmitting(false);
        return;
      }
      const payload = {
        title: form.title.trim(),
        start_time,
        end_time,
        location: form.location,
        description: form.description,
        imageFile: form.imageFile,
        requires_budget: form.requires_budget,
        planning_details: {
          event_type: form.event_type,
          venue_type: form.venue_type,
          venue_id: form.venue_type === 'on_campus' ? form.venue_id : null,
          expected_participants: form.expected_participants ? Number(form.expected_participants) : null,
          requirements: form.requirements,
          resources: form.resources,
          proposed_budget_amount: form.proposed_budget_amount ? Number(form.proposed_budget_amount) : null,
          budget_warning_threshold: form.budget_warning_threshold ? Number(form.budget_warning_threshold) : 0,
          budget_notes: form.budget_notes,
          vendor_deadlines: form.vendor_deadlines,
          logistics_checklist: form.logistics_checklist,
        },
      };

      let created = null;
      if (editingEventId) {
        await updateEvent(editingEventId, payload);
      } else {
        created = (await createEvent(payload))?.data;
        if (created?.id && Object.values(attachedEventFiles).some(Boolean)) {
          try {
            if (typeof submitEventRequirements === 'function') {
              await submitEventRequirements(created.id, attachedEventFiles);
            }
          } catch (fileErr) {
            console.warn('Initial event requirements upload:', fileErr);
          }
        }
      }
      setShowForm(false);
      setEditingEventId(null);
      setForm(emptyEventForm());
      load();
      if (created?.id) openEventDetails(created);
    } catch (err) {
      setFormError(getApiErrorMessage(err, `We could not ${editingEventId ? 'update' : 'create'} this event. Try again.`));
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleViewEventSample(requirement) {
    if (requirement.template_url) {
      window.open(requirement.template_url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await openProtectedFile(`/event-requirements/${requirement.id}/template`);
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'Could not open the sample template.'));
    }
  }

  function handleEventFileChange(req, file) {
    if (!file) {
      setAttachedEventFiles((prev) => {
        const copy = { ...prev };
        delete copy[req.id];
        return copy;
      });
      setAttachedFileErrors((prev) => {
        const copy = { ...prev };
        delete copy[req.id];
        return copy;
      });
      return;
    }

    const maxKb = req.max_file_size_kb || 10240;
    if (file.size > maxKb * 1024) {
      const maxMb = Math.round(maxKb / 1024);
      setAttachedFileErrors((prev) => ({ ...prev, [req.id]: `File exceeds ${maxMb}MB limit.` }));
      return;
    }

    const allowed = (req.allowed_extensions && req.allowed_extensions.length > 0)
      ? req.allowed_extensions.map((ext) => ext.toLowerCase().replace(/^\./, ''))
      : ['pdf'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && !allowed.includes(ext)) {
      setAttachedFileErrors((prev) => ({ ...prev, [req.id]: `Only ${allowed.map((e) => `.${e}`).join(', ')} files are allowed.` }));
      return;
    }

    setAttachedFileErrors((prev) => {
      const copy = { ...prev };
      delete copy[req.id];
      return copy;
    });
    setAttachedEventFiles((prev) => ({ ...prev, [req.id]: file }));
  }

  function openCreateForm() {
    setEditingEventId(null);
    setForm(emptyEventForm());
    setAttachedEventFiles({});
    setAttachedFileErrors({});
    setFormError(null);
    (typeof getEventRequirements === 'function' ? getEventRequirements() : Promise.resolve({ data: [] }))
      .then((res) => setActiveEventRequirements(res?.data || []))
      .catch(() => setActiveEventRequirements([]));
    setShowForm(true);
  }

  function openEditForm(event) {
    const planning = event.planning_details || {};
    const [startDate = '', startTime = ''] = isoToLocalDateTimeInput(event.start_time).split('T');
    const [endDate = '', endTime = ''] = isoToLocalDateTimeInput(event.end_time).split('T');
    setEditingEventId(event.id);
    setForm({
      title: event.title || '',
      date: startDate,
      startTime,
      endDate,
      endTime,
      location: event.location || '',
      venue_type: planning.venue_type || 'off_campus',
      venue_id: planning.venue_id || '',
      description: event.description || '',
      imageFile: null,
      requires_budget: Boolean(event.requires_budget),
      event_type: planning.event_type || '',
      expected_participants: planning.expected_participants || '',
      requirements: planning.requirements || '',
      resources: planning.resources || '',
      proposed_budget_amount: planning.proposed_budget_amount || '',
      budget_warning_threshold: planning.budget_warning_threshold || '',
      proposed_budget_id: planning.proposed_budget_id || null,
      budget_notes: planning.budget_notes || '',
      vendor_deadlines: planning.vendor_deadlines || '',
      logistics_checklist: planning.logistics_checklist || '',
    });
    setFormError(null);
    setShowForm(true);
  }

  function openEventDetails(event) {
    setRecordId(event.id);
    return loadEventDetails(event);
  }

  async function loadEventDetails(event, fromLink = false) {
    const requestId = detailsRequestRef.current + 1;
    detailsRequestRef.current = requestId;
    setSelectedEvent(event);
    setDetailsLoading(true);
    setStatusError(null);
    try {
      const response = await getEvent(event.id);
      if (detailsRequestRef.current === requestId) setSelectedEvent(response.data);
    } catch (requestError) {
      if (detailsRequestRef.current !== requestId) return;
      if (fromLink && !event.title) {
        closeLocalDetails();
        setRecordId(null);
        notify.error(getApiErrorMessage(requestError, 'That event could not be opened. It may have been removed or belong to another organization.'));
        return;
      }
      setSelectedEvent(event);
    } finally {
      if (detailsRequestRef.current === requestId) setDetailsLoading(false);
    }
  }

  function closeLocalDetails() {
    detailsRequestRef.current += 1;
    setSelectedEvent(null);
    setDetailsLoading(false);
  }

  function closeEventDetails() {
    closeLocalDetails();
    setRecordId(null);
  }

  async function refreshSelectedEvent() {
    const id = selectedEvent?.id;
    if (!id) return;
    try {
      const response = await getEvent(id);
      setSelectedEvent((current) => (current?.id === id ? response.data : current));
      setEvents((current) => current.map((event) => event.id === id ? response.data : event));
      setEventRows((current) => current.map((event) => event.id === id ? response.data : event));
    } catch {}
    setEventReload((value) => value + 1);
  }

  async function handleStatusUpdate(status) {
    if (!selectedEvent || !status) return;
    setStatusUpdating(true);
    setStatusError(null);
    try {
      await updateEventStatus(selectedEvent.id, status);
      const response = await getEvent(selectedEvent.id);
      setSelectedEvent(response.data);
      setEvents((current) => current.map((event) => event.id === response.data.id ? response.data : event));
      setEventRows((current) => current.map((event) => event.id === response.data.id ? response.data : event));
      notify.success(`Event marked ${status}.`);
    } catch (err) {
      const message = getApiErrorMessage(err, 'We could not update the event status. Try again.');
      setStatusError(message);
      notify.error(message);
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleGeneratePlan(e) {
    e.preventDefault();
    if (!planForm.event_id) return;
    setPlanSubmitting(true);
    setPlanError(null);
    setPlanResult('');
    setWorkflowDraft(null);
    setWorkflowOutputId(null);
    try {
      const res = await generateEventPlan(planForm.event_id, {
        requirements: planForm.requirements,
      });
      setPlanResult(res.data?.plan || '');
      setWorkflowDraft(res.data?.workflow || null);
      setWorkflowOutputId(res.data?.ai_output?.id || null);
      getEventWorkflowHistory(planForm.event_id)
        .then((history) => { setWorkflowHistory(history.data || []); setWorkflowHistoryError(''); })
        .catch(() => setWorkflowHistoryError('The previous workflow drafts could not be loaded.'));
      setPlanForm({ event_id: planForm.event_id, requirements: '' });
    } catch (err) {
      setPlanError(getApiErrorMessage(err, 'We could not create a reliable to-do list. Check the event details and try again.'));
    } finally {
      setPlanSubmitting(false);
    }
  }

  function selectPlanningEvent(eventId) {
    const selected = events.find((event) => String(event.id) === String(eventId));
    setPlanForm({ event_id: eventId, requirements: selected?.planning_details?.requirements || '' });
    setWorkflowDraft(null); setWorkflowOutputId(null); setPlanResult(''); setPlanError(null); setWorkflowHistoryError('');
    if (!eventId) { setWorkflowHistory([]); return; }
    getEventWorkflowHistory(eventId)
      .then((response) => setWorkflowHistory(response.data || []))
      .catch(() => { setWorkflowHistory([]); setWorkflowHistoryError('The previous workflow drafts could not be loaded. Try selecting the event again.'); });
  }

  function updateWorkflowTask(index, field, value) {
    setWorkflowDraft((current) => ({ ...current, tasks: current.tasks.map((task, taskIndex) => taskIndex === index ? { ...task, [field]: value, } : task) }));
  }

  async function reviewWorkflowOfficer(index) {
    const task = workflowDraft?.tasks[index];
    if (!task?.title?.trim()) return;
    setRankingTaskKey(task.key);
    setPlanError(null);
    try {
      const response = await previewTaskRecommendation({ title: task.title, task_type: 'workflow', preferred_role: task.recommended_role || null });
      setWorkflowDraft((current) => ({ ...current, tasks: current.tasks.map((item) => item.key === task.key ? { ...item, assigned_to: null, recommendation: { ...(response.data.delegation || { rankings: [] }), reviewed: true } } : item) }));
    } catch (requestError) {
      setPlanError(getApiErrorMessage(requestError, 'Could not review eligible officers.'));
    } finally {
      setRankingTaskKey(null);
    }
  }

  function removeWorkflowTask(index) {
    setWorkflowDraft((current) => ({ ...current, tasks: current.tasks.filter((_, taskIndex) => taskIndex !== index) }));
  }

  function addWorkflowTask() {
    const key = `admin-task-${Date.now()}`;
    setWorkflowDraft((current) => ({ ...current, tasks: [...current.tasks, { key, title: '', description: '', phase: 'pre_event', priority: 'medium', deadline: '', depends_on_key: null, recommended_role: null, assigned_to: null, recommendation: { rankings: [] } }] }));
  }

  async function confirmWorkflow() {
    if (!workflowDraft || !workflowOutputId) return;
    const incompleteTask = workflowDraft.tasks.findIndex((task) => !task.title?.trim() || !task.deadline || !task.assigned_to);
    if (incompleteTask !== -1) {
      setPlanError(`To-do ${incompleteTask + 1} needs a name, due date, and selected officer before you can save it.`);
      return;
    }
    setWorkflowAction(true); setPlanError(null);
    try {
      const response = await confirmEventWorkflow(planForm.event_id, workflowOutputId, workflowDraft.tasks);
      const created = response.data?.tasks || [];
      setTasks((current) => [...created, ...current]);
      setWorkflowDraft(null); setWorkflowOutputId(null);
      setPlanResult('Tasks created and assigned. Each officer has received a notification.');
      setWorkflowHistory((current) => current.map((output) => output.id === workflowOutputId ? { ...output, decision_status: 'accepted' } : output));
      load();
    } catch (requestError) {
      setPlanError(getApiErrorMessage(requestError, 'We could not save and assign these tasks. Review the highlighted details and try again.'));
    } finally { setWorkflowAction(false); }
  }

  async function discardWorkflow() {
    if (!workflowOutputId) return;
    setConfirmingDiscard(false);
    setWorkflowAction(true); setPlanError(null);
    try {
      await discardEventWorkflow(planForm.event_id, workflowOutputId);
      setWorkflowDraft(null); setWorkflowOutputId(null); setPlanResult('Draft removed. No tasks were created.');
      setWorkflowHistory((current) => current.map((output) => output.id === workflowOutputId ? { ...output, decision_status: 'discarded' } : output));
    } catch (requestError) {
      setPlanError(getApiErrorMessage(requestError, 'We could not remove this draft. Try again.'));
    } finally { setWorkflowAction(false); }
  }

  const filteredEvents = eventRows;
  const eventLinkedTasks = tasks.filter((t) => t.event_id);
  const pagedEvents = eventRows;
  const selectedPlanningEvent = events.find((event) => String(event.id) === String(planForm.event_id));

  const checkedInUserIds = new Set((attendanceData?.records ?? []).map((r) => r.user_id));
  const attendanceFiltered = Boolean(attendanceSearch.trim() || debouncedAttendanceSearch || attendanceStatusFilter !== 'all');
  const filteredAttendanceRecords = attendanceData?.records ?? [];
  const pagedAttendanceRecords = filteredAttendanceRecords;

  const exportAttendance = async () => {
    const exportParams = {
      per_page: 100,
      ...(debouncedAttendanceSearch ? { search: debouncedAttendanceSearch } : {}),
      ...(attendanceStatusFilter !== 'all' ? { status: attendanceStatusFilter } : {}),
    };
    const firstResponse = await getAttendance(selectedAttEventId, { ...exportParams, page: 1 });
    const firstPayload = firstResponse.data;
    const lastPage = Number(firstPayload?.pagination?.last_page ?? 1);
    const remaining = lastPage > 1
      ? await Promise.all(Array.from({ length: lastPage - 1 }, (_, index) => getAttendance(selectedAttEventId, { ...exportParams, page: index + 2 }).then((response) => response.data?.records ?? [])))
      : [];
    const exportRecords = [...(firstPayload?.records ?? []), ...remaining.flat()];
    const event = firstPayload?.event ?? attendanceData?.event;
    const headers = ['Attendance ID', 'Event ID', 'Event', 'School ID', 'Name', 'Email', 'Role', 'Position', 'Department', 'Program', 'Major', 'Year Level', 'Section', 'Status', 'Method', 'Check In', 'Check Out', 'Recorded By', 'Remarks'];
    const rows = exportRecords.map((record) => [record.id, event?.id, event?.title, record.user?.school_id, `${record.user?.first_name || ''} ${record.user?.last_name || ''}`.trim(), record.user?.email, record.user?.role, record.user?.position_title, record.user?.department, record.user?.program, record.user?.major, record.user?.year_level, record.user?.section, record.status, record.method, record.check_in_time, record.check_out_time, `${record.recorder?.first_name || ''} ${record.recorder?.last_name || ''}`.trim(), record.remarks]);
    const csv = buildCsv(headers, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `attendance-${event?.id || 'event'}-${manilaDateStamp()}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const startDistance = (event) => {
    const start = new Date(event.start_time).getTime();
    return Number.isFinite(start) ? Math.abs(start - currentTime) : Infinity;
  };
  const attendanceEvents = events.filter((event) => {
    if (canManageAttendance) {
      return ['approved', 'ongoing'].includes(event.status);
    }
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    return ['approved', 'ongoing'].includes(event.status) && Number.isFinite(start) && Number.isFinite(end) && currentTime >= start && currentTime <= end;
  }).sort((a, b) => (Number(b.status === 'ongoing') - Number(a.status === 'ongoing')) || startDistance(a) - startDistance(b));
  const ongoingAttendanceEvents = attendanceEvents.filter((event) => event.status === 'ongoing');
  const preselectedEventId = searchParams.get('event');
  const preselectedRef = useRef(null);
  useEffect(() => {
    const key = `${activeTab}:${preselectedEventId}`;
    if (!preselectedEventId || loading || preselectedRef.current === key) return;
    const source = activeTab === 'attendance' ? attendanceEvents : activeTab === 'tasks' ? events : [];
    const match = source.find((event) => String(event.id) === preselectedEventId);
    if (!match) return;
    preselectedRef.current = key;
    if (activeTab === 'attendance') handleSelectAttEvent(match.id);
    else selectPlanningEvent(String(match.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, attendanceEvents, events, loading, preselectedEventId]);

  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (autoPickedRef.current || activeTab !== 'attendance' || !canManageAttendance || loading || preselectedEventId) return;
    if (ongoingAttendanceEvents.length !== 1) return;
    autoPickedRef.current = true;
    handleSelectAttEvent(ongoingAttendanceEvents[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canManageAttendance, loading, preselectedEventId, ongoingAttendanceEvents.length]);

  const attendanceEvent = attendanceData?.event ?? attendanceEvents.find((event) => String(event.id) === String(selectedAttEventId));
  const attendanceSummary = attendanceData?.summary;
  const attendanceCount = attendanceSummary
    ? Number(attendanceSummary.present ?? 0) + Number(attendanceSummary.late ?? 0)
    : Number(attendanceData?.count ?? attendanceData?.records?.length ?? 0);
  const currentlyInside = Number(attendanceData?.checked_in_count ?? attendanceCount);
  const expectedAttendance = Number(attendanceEvent?.planning_details?.expected_participants ?? 0);
  const attendanceRate = expectedAttendance > 0 ? Math.min(100, Math.round((attendanceCount / expectedAttendance) * 100)) : null;
  useEffect(() => {
    setEventsPage(1);
  }, [search, dateFilter, eventStatusFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedAttendanceSearch(attendanceSearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [attendanceSearch]);

  useEffect(() => {
    setAttendancePage(1);
  }, [debouncedAttendanceSearch, attendanceStatusFilter]);

  useEffect(() => {
    if (!selectedAttEventId) return undefined;
    let active = true;
    setAttendanceLoading(true);
    getAttendance(selectedAttEventId, {
      page: attendancePage,
      per_page: pageSize,
      ...(debouncedAttendanceSearch ? { search: debouncedAttendanceSearch } : {}),
      ...(attendanceStatusFilter !== 'all' ? { status: attendanceStatusFilter } : {}),
    })
      .then((response) => {
        if (!active) return;
        setAttendanceData(response.data);
        setAttendanceMeta({
          currentPage: Number(response.data?.pagination?.current_page ?? 1),
          lastPage: Number(response.data?.pagination?.last_page ?? 1),
          perPage: Number(response.data?.pagination?.per_page ?? pageSize),
          total: Number(response.data?.pagination?.total ?? response.data?.records?.length ?? 0),
        });
      })
      .catch(() => { if (active) setAttendanceData(null); })
      .finally(() => { if (active) setAttendanceLoading(false); });

    return () => { active = false; };
  }, [attendancePage, attendanceReload, attendanceStatusFilter, debouncedAttendanceSearch, selectedAttEventId]);

  const clearEventFilters = () => {
    setSearch('');
    setDateFilter('');
    setEventStatusFilter('');
    setEventsPage(1);
  };

  const filesAtStage = FILE_STAGES.includes(selectedEvent?.approval_stage);
  const eventFilesPanel = holdsEventFiles && selectedEvent && selectedEvent.requirements_required !== false
    ? <EventSubmissionPanel eventId={selectedEvent.id} role={currentUserRole} onSubmitted={() => { setSubmissionVersion((value) => value + 1); refreshSelectedEvent(); }} />
    : null;
  const hasEventFilters = Boolean(search.trim() || dateFilter || eventStatusFilter);
  const isReturned = (event) => (event.approval_stage ? RETURNED_STAGES.includes(event.approval_stage) : event.approval_status === 'rejected');
  const eventStatusText = (event) => (event.status === 'planning' ? stageText(event) : null) || statusLabel[event.status] || capitalize(event.status);

  function eventListEmptyState() {
    if (hasEventFilters) {
      return <EmptyState kind="filtered" title="No events match these filters" description="Change the search, date or status, or clear the filters to see every event in this period." onClearFilters={clearEventFilters} />;
    }
    if (currentUserRole === 'ADMIN') {
      return (
        <EmptyState
          icon={CalendarPlus}
          title="No events proposed yet"
          description="Every event starts as a proposal that the Department Head approves first."
          action={<Button variant="secondary" leftIcon={Plus} onClick={openCreateForm}>Propose your first event</Button>}
        />
      );
    }
    if (currentUserRole === 'SBO_OFFICER') {
      return <EmptyState kind="restricted" title="No events yet" description="Only your organization's Admin can propose events. Approved events appear here with their tasks and check-in." />;
    }
    if (currentUserRole === 'DEPARTMENT_HEAD') {
      return (
        <EmptyState
          icon={CalendarCheck2}
          title="No events from your college yet"
          description="Events that organizations propose appear here, and the ones waiting for your decision are in Approvals."
          action={<Button variant="secondary" to="/dashboard/department-head/approvals">Open approvals</Button>}
        />
      );
    }
    return (
      <EmptyState
        icon={CalendarCheck2}
        title="No events to join yet"
        description="Approved events appear here with a Register button."
        action={<Button variant="secondary" to="/dashboard/announcements/view-announcements">Read announcements</Button>}
      />
    );
  }

  function closeForm() {
    setShowForm(false);
    setEditingEventId(null);
    setAttachedFileErrors({});
    // A form opened from the request selector goes back there, not to the events list.
    if (startEventRequest && !editingEventId) navigate(REQUEST_SELECTOR_PATH);
  }

  if (showForm) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={editingEventId ? 'Edit event' : 'New event'}
          breadcrumbs={startEventRequest && !editingEventId ? [{ label: 'New request', to: REQUEST_SELECTOR_PATH }, { label: 'New event' }] : undefined}
        />
        <form className="max-w-3xl space-y-8" onSubmit={handleSaveEvent} noValidate>
          <section aria-label="Event details" className="space-y-4">
            <Field label="Event name" required>
              <Input id="event-title" type="text" value={form.title} maxLength={255} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Annual General Assembly" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Event type" optional>
                <Input id="event-type" type="text" maxLength={100} value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} placeholder="e.g. General Assembly" />
              </Field>
              <Field label="Expected participants" optional>
                <Input id="event-participants" type="number" min="1" max="1000000" value={form.expected_participants} onChange={(e) => setForm({ ...form, expected_participants: e.target.value })} placeholder="e.g. 250" />
              </Field>
            </div>
            <Field label="Description" optional>
              <RichTextEditor id="event-description" rows={3} value={form.description} onChange={(description) => setForm({ ...form, description })} placeholder="Brief description" />
            </Field>
            <div className="space-y-1.5">
              <label htmlFor="event-image" className="text-[13px] font-medium text-ink">Event poster <span className="ml-1 font-normal text-ink-muted">(optional)</span></label>
              <label htmlFor="event-image" className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-dashed border-line px-3 py-2 hover:bg-subtle">
                <ImagePlus size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{form.imageFile?.name || (editingEventId ? 'Choose a replacement poster' : 'Choose an image')}</span><span className="block text-xs text-ink-muted">JPEG, PNG or WebP, up to 5 MB</span></span>
              </label>
              <input id="event-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setForm({ ...form, imageFile: event.target.files?.[0] || null })} />
            </div>
          </section>

          <section aria-labelledby="event-when" className="space-y-4 border-t border-line pt-6">
            <h2 id="event-when" className="text-base font-semibold text-ink">When and where</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Start date" required>
                <Input id="event-start-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Start time" required>
                <Input id="event-start-time" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </Field>
              <Field label="End date" required>
                <Input id="event-end-date" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
              <Field label="End time" required>
                <Input id="event-end-time" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Venue type">
                <HiusaSelect id="event-venue-type" value={form.venue_type} onChange={(e) => setForm({ ...form, venue_type: e.target.value, venue_id: '', location: '' })}><option value="on_campus">On campus</option><option value="off_campus">Off campus</option></HiusaSelect>
              </Field>
              {form.venue_type === 'on_campus' ? (
                <Field label="SAO venue" required>
                  <HiusaSelect id="event-campus-venue" value={form.venue_id} onChange={(e) => setForm({ ...form, venue_id: e.target.value, location: campusVenues.find((venue) => String(venue.id) === e.target.value)?.name || '' })}><option value="">Choose a venue</option>{campusVenues.map((venue) => <option key={venue.id} value={venue.id}>{formatDisplayText(venue.name)}</option>)}</HiusaSelect>
                </Field>
              ) : (
                <Field label="Off-campus location" required>
                  <Input id="event-location" type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </Field>
              )}
            </div>
          </section>

          <section aria-labelledby="event-plan" className="space-y-4 border-t border-line pt-6">
            <h2 id="event-plan" className="text-base font-semibold text-ink">Planning</h2>
            <Field label="Planning requirements" optional>
              <Textarea id="event-requirements" rows={2} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} placeholder="Program, safety, registration, approvals, accessibility" />
            </Field>
            <Field label="Available / required resources" optional>
              <Textarea id="event-resources" rows={2} value={form.resources} onChange={(e) => setForm({ ...form, resources: e.target.value })} placeholder="Rooms, equipment, volunteers, suppliers, materials" />
            </Field>
            <Field label="Vendor deadlines" optional>
              <Textarea id="event-vendor-deadlines" rows={2} value={form.vendor_deadlines} onChange={(e) => setForm({ ...form, vendor_deadlines: e.target.value })} placeholder="Supplier, payment, or delivery deadlines" />
            </Field>
            <Field label="Logistics checklist" optional>
              <Textarea id="event-logistics-checklist" rows={2} value={form.logistics_checklist} onChange={(e) => setForm({ ...form, logistics_checklist: e.target.value })} placeholder="Venue setup, materials, registration, documentation" />
            </Field>
          </section>

          <section aria-labelledby="event-budget" className="space-y-4 border-t border-line pt-6">
            <h2 id="event-budget" className="text-base font-semibold text-ink">Budget</h2>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={form.requires_budget} onChange={(e) => setForm({ ...form, requires_budget: e.target.checked })} className="h-4 w-4 rounded border-line" />
              Requires budget allocation
            </label>
            {form.requires_budget && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Proposed budget" optional>
                  <Input id="event-proposed-budget" type="number" min="0.01" step="0.01" disabled={Boolean(editingEventId && form.proposed_budget_id)} value={form.proposed_budget_amount} onChange={(e) => setForm({ ...form, proposed_budget_amount: e.target.value })} placeholder="0.00" />
                </Field>
                <Field label="Warning threshold" optional>
                  <Input id="event-budget-threshold" type="number" min="0" step="0.01" disabled={Boolean(editingEventId && form.proposed_budget_id)} value={form.budget_warning_threshold} onChange={(e) => setForm({ ...form, budget_warning_threshold: e.target.value })} placeholder="0.00" />
                </Field>
                <p className="text-sm text-ink-muted-strong sm:col-span-2">
                  {editingEventId && form.proposed_budget_id ? 'This proposal is already linked. Change approved budget values from Finance so its approval history is preserved.' : 'Entering an amount creates a linked proposed budget with its own approval request for the Department Head.'}
                </p>
              </div>
            )}
            <Field label="Budget requirements / notes" required={form.requires_budget} optional={!form.requires_budget}>
              <Textarea id="event-budget-notes" rows={2} value={form.budget_notes} onChange={(e) => setForm({ ...form, budget_notes: e.target.value })} placeholder="Expected expenses or funding notes" />
            </Field>
            {form.requires_budget && !form.proposed_budget_amount && (
              <p className="text-sm text-ink-muted-strong">These notes describe the event's funding needs. The actual allocation is proposed and linked to this event in Finance, under Budget Allocation.</p>
            )}
          </section>

          {!editingEventId && activeEventRequirements.length > 0 && (
            <section aria-labelledby="event-documents" className="space-y-4 border-t border-line pt-6">
              <div>
                <h2 id="event-documents" className="text-base font-semibold text-ink">Required letters and documents ({form.venue_type === 'on_campus' ? 'on-campus' : 'off-campus'} SAO checklist)</h2>
                <p className="mt-1 text-sm text-ink-muted">Attach them now so they are sent together with your proposal.</p>
              </div>
              <ul className="divide-y divide-line-soft">
                {venueRequirements.map((req) => {
                  const attachedFile = attachedEventFiles[req.id];
                  const fileErr = attachedFileErrors[req.id];
                  return (
                    <li key={req.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="text-sm font-medium text-ink">{req.name}</span>
                          {req.is_optional && <span className="ml-1.5 text-xs text-ink-muted">(optional)</span>}
                          {req.description && <p className="text-xs text-ink-muted">{req.description}</p>}
                        </div>
                        {(req.template_url || req.template_original_name) && (
                          <Button variant="secondary" size="sm" leftIcon={FileText} onClick={() => handleViewEventSample(req)}>Sample template</Button>
                        )}
                      </div>
                      {attachedFile ? (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-control border border-line px-3 py-1.5 text-xs">
                          <span className="min-w-0 truncate font-medium text-ink">{attachedFile.name} <span className="font-normal text-ink-muted">({(attachedFile.size / 1024).toFixed(0)} KB)</span></span>
                          <button type="button" onClick={() => handleEventFileChange(req, null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-subtle hover:text-danger-strong" aria-label={`Remove attached ${req.name}`}><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <input
                            type="file"
                            aria-label={`Attach ${req.name}`}
                            accept={req.allowed_extensions ? req.allowed_extensions.map((ext) => `.${ext}`).join(',') : '.pdf'}
                            onChange={(e) => handleEventFileChange(req, e.target.files?.[0])}
                            className="block min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-xs text-ink-muted"
                          />
                          <p className="mt-1 text-xs text-ink-muted">
                            Allowed: {req.allowed_extensions ? req.allowed_extensions.map((ext) => `.${ext}`).join(', ') : '.pdf'} · Max {(req.max_file_size_kb || 10240) >= 1024 ? `${Math.round((req.max_file_size_kb || 10240) / 1024)}MB` : `${req.max_file_size_kb || 10240}KB`}
                          </p>
                        </div>
                      )}
                      {fileErr && <p role="alert" className="mt-1 text-xs font-medium text-danger-strong">{fileErr}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {formError && <p role="alert" className="text-sm font-medium text-danger-strong">{formError}</p>}
          {missingRequiredFiles.length > 0 && (
            <p className="text-sm text-ink-muted-strong">Attach {missingRequiredFiles.map((req) => req.name).join(', ')} to send the proposal.</p>
          )}
          <div className="flex justify-end gap-3 border-t border-line pt-5">
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={formSubmitting} disabled={!form.title.trim() || !form.date || !form.startTime || !form.endDate || !form.endTime || !eventPlaceChosen || missingRequiredFiles.length > 0 || (form.requires_budget && !form.budget_notes.trim())}>
              {editingEventId ? 'Save changes' : 'Send proposal'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        primary={activeTab === 'events' && canCreateEvents ? <Button leftIcon={Plus} onClick={openCreateForm}>New event</Button> : undefined}
      />

      {error && <ErrorState title="Events did not load" description={error} onRetry={load} />}

      {activeTab === 'events' && (
        <section className="space-y-4">
          {currentUserRole === 'STUDENT' && <PersonalAttendanceSummary />}
          <div className="flex flex-wrap items-end justify-end gap-3">
            <div role="group" aria-label="Switch events view" className="flex h-11 w-fit shrink-0 items-center rounded-control border border-line bg-subtle p-1">
              <button
                type="button"
                aria-label="List view"
                aria-pressed={eventsView === 'list'}
                onClick={() => changeEventsView('list')}
                className={`flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-medium ${eventsView === 'list' ? 'border border-line bg-surface text-ink' : 'text-ink-muted'}`}
              >
                <List size={15} aria-hidden="true" /> <span className="hidden sm:inline">List</span>
              </button>
              <button
                type="button"
                aria-label="Calendar view"
                aria-pressed={eventsView === 'calendar'}
                onClick={() => changeEventsView('calendar')}
                className={`flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-medium ${eventsView === 'calendar' ? 'border border-line bg-surface text-ink' : 'text-ink-muted'}`}
              >
                <Calendar size={15} aria-hidden="true" /> <span className="hidden sm:inline">Calendar</span>
              </button>
            </div>
          </div>

          {eventsView === 'list' && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="relative min-w-0 flex-1 sm:max-w-xs">
                <span className="sr-only">Search events</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events" className="pl-9" />
              </label>
              <Field label="Event date" className="w-full sm:w-44"><Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></Field>
              <Field label="Sort by" className="w-full sm:w-44"><HiusaSelect value={eventSort} onChange={(event) => { setEventSort(event.target.value); setEventsPage(1); }}><option value="start_asc">Soonest</option><option value="start_desc">Latest date</option><option value="newest">Newest created</option><option value="title">Title</option></HiusaSelect></Field>
              <Field label="Status" className="w-full sm:w-52"><HiusaSelect filter value={eventStatusFilter} onChange={(event) => setEventStatusFilter(event.target.value)}><option value="">All statuses</option>{['planning', 'approved', 'ongoing', 'completed', 'cancelled'].map((value) => <option key={value} value={value}>{statusLabel[value] || capitalize(value)}</option>)}</HiusaSelect></Field>
              {hasEventFilters && <button type="button" onClick={clearEventFilters} className="min-h-10 rounded-control px-2 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Clear</button>}
            </div>
          )}

          {eventsView === 'calendar' ? (
            <ActivityCalendar
              events={events}
              loading={loading}
              onSelectEvent={openEventDetails}
            />
          ) : (
            <div>
              {eventListLoading ? (
                <SkeletonTable rows={5} columns={5} />
              ) : filteredEvents.length === 0 ? (
                eventListEmptyState()
              ) : (
                <table className="block w-full text-left lg:table">
                  <caption className="sr-only">Events</caption>
                  <thead className="hidden lg:table-header-group">
                    <tr>
                      <th scope="col" className="px-4 py-2.5">Event</th>
                      <th scope="col" className="px-4 py-2.5">Status</th>
                      <th scope="col" className="px-4 py-2.5">Schedule</th>
                      <th scope="col" className="px-4 py-2.5">Venue</th>
                      {canCreateEvents && <th scope="col" className="px-4 py-2.5">Budget</th>}
                      <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="block lg:table-row-group">
                    {pagedEvents.map((evt) => (
                      <tr key={evt.id} className="relative flex flex-col gap-1 border-b border-line-soft py-3 hover:bg-subtle lg:table-row lg:py-0">
                        <td className="order-1 pr-12 lg:table-cell lg:max-w-[280px] py-0 lg:px-4 lg:py-2.5 lg:pr-4">
                          <button
                            type="button"
                            onClick={() => openEventDetails(evt)}
                            className="min-h-10 text-left text-sm font-semibold text-ink after:absolute after:inset-0 hover:text-brand-700 focus-visible:underline lg:min-h-0 lg:font-medium lg:after:hidden"
                          >
                            {formatDisplayText(evt.title)}
                          </button>
                          <p className="text-xs text-ink-muted">{evt.creator ? `${formatDisplayText(evt.creator.first_name)} ${formatDisplayText(evt.creator.last_name)}` : ''}{evt.creator && (evt.creator.position_title || evt.creator.role) ? ` · ${formatDisplayText(evt.creator.position_title) || evt.creator.role?.replaceAll('_', ' ')}` : ''}</p>
                        </td>
                        <td className="order-2 lg:table-cell py-0 lg:px-4 lg:py-2.5">
                          <EventStatus event={evt} text={eventStatusText(evt)} />
                          {isReturned(evt) && evt.approval_remarks && (
                            <p className="mt-1 max-w-[220px] text-xs text-danger-strong">
                              <span className="font-semibold">Returned:</span> {evt.approval_remarks}
                            </p>
                          )}
                          {seesEventFlow && evt.status === 'planning' && <EventRowProgress flow={eventFlow(evt, currentUserRole)} title={formatDisplayText(evt.title)} className="mt-2 hidden w-[220px] lg:block" />}
                        </td>
                        <td className="order-3 text-sm text-ink lg:table-cell py-0 lg:px-4 lg:py-2.5">
                          <span className="whitespace-nowrap">{formatDateTime(evt.start_time)}</span>
                          <span className="block whitespace-nowrap text-xs text-ink-muted">Ends {formatDateTime(evt.end_time)}</span>
                        </td>
                        <td className="order-4 text-sm text-ink lg:table-cell py-0 lg:px-4 lg:py-2.5">{evt.location || ''}</td>
                        {canCreateEvents && (
                          <td className="order-5 text-sm text-ink lg:table-cell py-0 lg:px-4 lg:py-2.5">
                            <span className="text-xs text-ink-muted lg:hidden">Budget </span>
                            <BudgetStatus event={evt} />
                          </td>
                        )}
                        <td className="absolute right-0 top-2 z-10 lg:static lg:table-cell py-0 lg:px-4 lg:py-2.5 lg:text-right">
                          <TableRowActions subject={evt.title} label="Event actions" actions={[
                            { label: 'View event', icon: Eye, onClick: () => openEventDetails(evt) },
                            canCreateEvents && !['completed', 'cancelled'].includes(evt.status) && { label: 'Edit event', icon: Pencil, onClick: () => openEditForm(evt) },
                            canCreateEvents && !evt.delete_blocked_reason && { label: 'Delete event', icon: Trash2, danger: true, onClick: () => { setDeleteError(null); setEventToDelete(evt); } },
                            canCreateEvents && evt.delete_blocked_reason && canCancelEvent(evt) && { label: 'Cancel event', icon: Ban, danger: true, onClick: () => { setCancelError(null); setEventToCancel(evt); } },
                          ]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <PaginationControls
                currentPage={eventsPage}
                totalItems={eventTotal}
                pageSize={eventPageSize}
                onPageChange={setEventsPage}
                label="events"
              />
            </div>
          )}
        </section>
      )}

      {activeTab === 'tasks' && (
        <section className="space-y-8">
          {!loading && events.length === 0 ? (
            <EmptyState
              icon={CalendarPlus}
              title="No event to plan yet"
              description="A to-do list is built for an event, and an event starts as a proposal for the Department Head to approve."
              action={<Button variant="secondary" leftIcon={Plus} to="/dashboard/events/manage-events?new=1">Propose your first event</Button>}
            />
          ) : (
            <>
              <DataTable
                caption="Assigned event tasks"
                captionVisible
                loading={loading}
                rows={eventLinkedTasks}
                emptyState={<EmptyState title="No event tasks yet" description="Draft a to-do list below to assign the first tasks." />}
                columns={[
                  { key: 'title', header: 'Task', render: (t) => formatDisplayText(t.title) },
                  { key: 'assignee', header: 'Assigned officer', render: (t) => (t.assignee ? `${formatDisplayText(t.assignee.first_name)} ${formatDisplayText(t.assignee.last_name)}` : '') },
                  { key: 'event', header: 'Event', render: (t) => formatDisplayText(t.event?.title) ?? '' },
                  { key: 'deadline', header: 'Due date', render: (t) => <span className="whitespace-nowrap">{formatDateTime(t.deadline)}</span> },
                  { key: 'status', header: 'Status', render: (t) => <TaskStatus task={t} /> },
                ]}
              />

              <div className="border-t border-line pt-6">
                <h2 className="text-base font-semibold text-ink">Draft a to-do list</h2>
                <form className="mt-3 grid gap-4 lg:grid-cols-[260px_1fr]" onSubmit={handleGeneratePlan}>
                  <div>
                    <Field label="Event">
                      <HiusaSelect id="planning-event" value={planForm.event_id} onChange={(event) => selectPlanningEvent(event.target.value)}>
                        <option value="">Choose an event</option>
                        {events.map((event) => <option key={event.id} value={event.id}>{formatDisplayText(event.title)}</option>)}
                      </HiusaSelect>
                    </Field>
                    {selectedPlanningEvent && <p className="mt-2 text-xs text-ink-muted">{formatDateTime(selectedPlanningEvent.start_time)}{selectedPlanningEvent.location ? ` at ${selectedPlanningEvent.location}` : ''}</p>}
                  </div>
                  <div>
                    <Field label="Planning context" optional hint="Add priorities or limits. Anything unknown stays marked for review.">
                      <Textarea id="planning-needs" rows={3} value={planForm.requirements} onChange={(event) => setPlanForm({ ...planForm, requirements: event.target.value })} placeholder="Setup, supplies, publicity, safety, reports, or special concerns" />
                    </Field>
                    <div className="mt-3 flex justify-end">
                      <Button type="submit" variant={workflowDraft ? 'secondary' : 'primary'} loading={planSubmitting} disabled={!planForm.event_id}>{planSubmitting ? 'Drafting…' : 'Draft to-do list'}</Button>
                    </div>
                  </div>
                </form>

                {planError && <div role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-tint px-4 py-3"><p className="text-sm font-semibold text-danger-strong">We could not finish that action</p><p className="mt-1 text-sm text-danger-strong">{planError}</p></div>}

                {workflowHistoryError && <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-tint px-4 py-3 text-sm font-medium text-danger-strong">{workflowHistoryError}</p>}

                {workflowHistory.length > 0 && (
                  <div className="mt-4 border-t border-line pt-4">
                    <p className="text-sm font-semibold text-ink">Previous drafts</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {workflowHistory.map((output) => (
                        <button key={output.id} type="button" onClick={() => { setPlanResult(output.output_text || ''); if (output.decision_status === 'pending' && output.structured_output) { setWorkflowDraft(output.structured_output); setWorkflowOutputId(output.id); } else { setWorkflowDraft(null); setWorkflowOutputId(null); } }} className={`min-h-11 rounded-control border px-3 text-sm font-medium ${output.id === workflowOutputId ? 'border-brand-600 bg-brand-600/10 text-ink' : 'border-line bg-surface text-ink-muted-strong hover:bg-subtle'}`}>Draft {output.version} · {workflowStatusLabel[output.decision_status] || 'Status unavailable'}</button>
                      ))}
                    </div>
                  </div>
                )}

                {planResult && !workflowDraft && <div className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap border-t border-line pt-4 text-sm text-ink-muted-strong">{replaceIsoDateTimes(planResult)}</div>}

                {workflowDraft && (
                  <div className="mt-6 border-t border-line pt-6">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div><h3 className="text-base font-semibold text-ink">{workflowDraft.tasks.length} suggested to-do item{workflowDraft.tasks.length === 1 ? '' : 's'}</h3><p className="mt-1 max-w-3xl text-sm text-ink-muted-strong">{replaceIsoDateTimes(workflowDraft.overview)}</p></div>
                      <StatusBadge tone="warning" label="Nothing saved yet" className="w-fit" />
                    </div>

                    <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                      {[
                        ['Plan outline', workflowDraft.preparation_phases],
                        ['Key dates', workflowDraft.timeline],
                        ['What is needed', workflowDraft.resources],
                        ['Setup and coordination', workflowDraft.logistics],
                        ['Possible problems', [...(workflowDraft.risks || []), ...(workflowDraft.scheduling_conflicts || [])]],
                      ].map(([heading, items]) => (
                        <section key={heading}><h4 className="text-sm font-semibold text-ink">{heading}</h4>{items?.length ? <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-ink-muted-strong">{items.map((item, itemIndex) => <li key={`${heading}-${itemIndex}`}>{replaceIsoDateTimes(item)}</li>)}</ul> : <p className="mt-1.5 text-xs text-ink-muted">Nothing listed.</p>}</section>
                      ))}
                    </div>

                    <div className="mt-6 flex items-center justify-between gap-3">
                      <div><h3 className="text-base font-semibold text-ink">To-do items</h3><p className="mt-0.5 text-sm text-ink-muted">Review the order, due dates, and assigned officers.</p></div>
                      <Button variant="secondary" leftIcon={Plus} onClick={addWorkflowTask}>Add to-do</Button>
                    </div>

                    <ol className="mt-3 divide-y divide-line border-t border-line">
                      {workflowDraft.tasks.map((task, index) => {
                        const selectedOfficer = task.recommendation?.rankings?.find((ranking) => String(ranking.officer_id) === String(task.assigned_to));
                        const dueDateHint = task.phase === 'pre_event' ? `Choose a time before ${formatDateTime(selectedPlanningEvent?.start_time)}.` : task.phase === 'event_day' ? `Choose a time between ${formatDateTime(selectedPlanningEvent?.start_time)} and ${formatDateTime(selectedPlanningEvent?.end_time)}.` : `Choose a time after ${formatDateTime(selectedPlanningEvent?.end_time)}, within 30 days.`;
                        return (
                          <li key={task.key} className="py-5">
                            <div className="flex items-start justify-between gap-3">
                              <div><p className="text-sm font-semibold text-ink">To-do {index + 1}</p><p className="mt-0.5 text-xs text-ink-muted">{workflowPhaseLabel[task.phase] || 'Timing not selected'}</p></div>
                              <button type="button" aria-label={`Delete to-do ${index + 1}`} onClick={() => removeWorkflowTask(index)} className="grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-danger-strong hover:bg-danger-tint"><X size={15} /></button>
                            </div>

                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <Field label="Task name"><Input id={`workflow-title-${index}`} aria-label={`Task ${index + 1} title`} value={task.title} onChange={(event) => updateWorkflowTask(index, 'title', event.target.value)} /></Field>
                              <Field label="Due date and time" hint={dueDateHint}><Input id={`workflow-deadline-${index}`} aria-label={`Task ${index + 1} deadline`} type="datetime-local" value={isoToLocalDateTimeInput(task.deadline)} onChange={(event) => updateWorkflowTask(index, 'deadline', localDateTimeToIso(event.target.value))} /></Field>
                              <Field label="What needs to be done?" optional className="lg:col-span-2"><RichTextEditor id={`workflow-description-${index}`} ariaLabel={`Task ${index + 1} description`} value={task.description || ''} onChange={(description) => updateWorkflowTask(index, 'description', description)} rows={3} /></Field>
                              <Field label="When should it happen?"><HiusaSelect id={`workflow-phase-${index}`} aria-label={`Task ${index + 1} phase`} value={task.phase} onChange={(event) => updateWorkflowTask(index, 'phase', event.target.value)}><option value="pre_event">Before the event</option><option value="event_day">During the event</option><option value="post_event">After the event</option></HiusaSelect></Field>
                              <Field label="Importance"><HiusaSelect id={`workflow-priority-${index}`} aria-label={`Task ${index + 1} priority`} value={task.priority} onChange={(event) => updateWorkflowTask(index, 'priority', event.target.value)}>{['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{capitalize(value)}</option>)}</HiusaSelect></Field>
                              <Field label="Best officer role" optional><Input id={`workflow-role-${index}`} aria-label={`Task ${index + 1} recommended role`} value={task.recommended_role || ''} onChange={(event) => updateWorkflowTask(index, 'recommended_role', event.target.value)} placeholder="Example: Secretary" /></Field>
                              <Field label="This can start after" optional><HiusaSelect id={`workflow-order-${index}`} aria-label={`Task ${index + 1} dependency`} value={task.depends_on_key || ''} onChange={(event) => updateWorkflowTask(index, 'depends_on_key', event.target.value || null)}><option value="">It can start right away</option>{workflowDraft.tasks.slice(0, index).map((candidate, candidateIndex) => <option key={candidate.key} value={candidate.key}>{formatDisplayText(candidate.title) || `To-do ${candidateIndex + 1}`}</option>)}</HiusaSelect></Field>
                              <div className="lg:col-span-2">
                                <Field label="Assign to" required>
                                  <HiusaSelect id={`workflow-officer-${index}`} aria-label={`Task ${index + 1} officer`} value={task.assigned_to || ''} onChange={(event) => updateWorkflowTask(index, 'assigned_to', Number(event.target.value) || null)}><option value="">Choose an eligible officer</option>{task.recommendation?.rankings?.map((ranking) => <option key={ranking.officer_id} value={ranking.officer_id}>{ranking.rank}. {formatDisplayText(ranking.name)}, {formatDisplayText(ranking.position_title)}, {scoreLabel(ranking.final_score)} overall match</option>)}</HiusaSelect>
                                </Field>
                                <div className="mt-2 flex flex-wrap items-center gap-3">
                                  <Button variant="secondary" disabled={rankingTaskKey === task.key || !task.title?.trim()} onClick={() => reviewWorkflowOfficer(index)}>{rankingTaskKey === task.key ? 'Evaluating...' : 'Review officers'}</Button>
                                  {!task.recommendation?.rankings?.length && <p className="text-xs text-ink-muted">{task.recommendation?.reviewed ? 'No officer is eligible right now. Check that officers have an active position and are under their open task limit.' : 'Review eligible officers, then choose the final assignee.'}</p>}
                                </div>
                              </div>
                            </div>

                            {selectedOfficer && (
                              <div className="mt-4 border-t border-line-soft pt-3">
                                <p className="text-sm font-semibold text-ink">Why {formatDisplayText(selectedOfficer.name)} was suggested</p>
                                <p className="mt-0.5 text-xs text-ink-muted">{scoreLabel(selectedOfficer.final_score)} overall match</p>
                                <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Role match', selectedOfficer.role_score], ['Available workload', selectedOfficer.workload_score], ['Past task completion', selectedOfficer.performance_score], ['Not recently assigned', selectedOfficer.recency_score]].map(([label, value]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-0.5 text-sm font-medium tabular-nums text-ink">{scoreLabel(value)}</dd></div>)}</dl>
                                {Number.isFinite(Number(selectedOfficer.active_tasks)) && <p className="mt-2 text-xs text-ink-muted-strong">This officer currently has {selectedOfficer.active_tasks} open task{Number(selectedOfficer.active_tasks) === 1 ? '' : 's'} out of a limit of {selectedOfficer.max_active_tasks}.</p>}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>

                    <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-ink-muted">Saving will create {workflowDraft.tasks.length} task{workflowDraft.tasks.length === 1 ? '' : 's'} and notify the assigned officers.</p>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row"><Button variant="secondary" className="text-danger-strong" disabled={workflowAction} onClick={() => setConfirmingDiscard(true)}>Remove draft</Button><Button disabled={workflowDraft.tasks.length === 0 || workflowDraft.tasks.some((task) => !task.assigned_to)} loading={workflowAction} onClick={confirmWorkflow}>Save and assign tasks</Button></div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'attendance' && (
        <section aria-label="Event check-in" className="space-y-6">
          <p className="text-sm font-medium text-ink-muted-strong">{attendanceEvents.length} {attendanceEvents.length === 1 ? 'event' : 'events'} open for check-in</p>
          {!loading && canManageAttendance && ongoingAttendanceEvents.length === 0 && <p role="status" className="text-sm text-ink-muted-strong">No event is ongoing right now. <Link to={currentUserRole === 'ADMIN' ? '/dashboard/events/manage-events' : '/dashboard/events/activity-calendar'} className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Go to Events</Link></p>}
          {loading ? (
            <SkeletonTable rows={3} columns={3} />
          ) : attendanceEvents.length === 0 ? (
            <EmptyState
              icon={CalendarCheck2}
              title="No events ready for check-in"
              description={canManageAttendance ? 'Approved and ongoing events will appear here.' : 'An event appears here only while its approved check-in window is open.'}
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
              {/* Left panel - event list */}
              <div className={`xl:block ${selectedAttEventId ? 'hidden' : 'block'}`}>
                <h2 className="text-sm font-semibold text-ink">Events</h2>
                <ul className="mt-3 divide-y divide-line-soft border-t border-line">
                  {attendanceEvents.map((evt) => (
                    <li key={evt.id}>
                      <button
                        type="button"
                        aria-label={`Open attendance for ${formatDisplayText(evt.title)}`}
                        aria-current={selectedAttEventId === evt.id ? 'true' : undefined}
                        onClick={() => handleSelectAttEvent(evt.id)}
                        className={`flex min-h-11 w-full items-start gap-3 px-2 py-3 text-left hover:bg-subtle ${selectedAttEventId === evt.id ? 'bg-brand-600/10' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium text-ink">{formatDisplayText(evt.title)}</p>
                          <p className="mt-0.5 text-xs text-ink-muted">{formatDateTime(evt.start_time)}</p>
                          {evt.location && <p className="break-words text-xs text-ink-muted">{evt.location}</p>}
                        </div>
                        {evt.status === 'ongoing' && <StatusBadge tone="active" label="Ongoing" className="shrink-0" />}
                        <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right panel - detail */}
              <div className={`min-w-0 flex-col ${selectedAttEventId ? 'flex' : 'hidden xl:flex'}`}>
                {!selectedAttEventId ? (
                  <EmptyState title="Choose an event to begin" description="Check-in controls and attendance records appear here." />
                ) : attendanceLoading && !attendanceData ? (
                  <SkeletonTable rows={3} columns={4} />
                ) : (
                  <>
                    {/* Mobile back button */}
                    <div className="flex items-center pb-3 xl:hidden">
                      <button
                        type="button"
                        onClick={() => setSelectedAttEventId(null)}
                        className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-700"
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                        All events
                      </button>
                    </div>

                    {/* Event header */}
                    <div className="pb-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="break-words text-lg font-semibold text-ink">{formatDisplayText(attendanceEvent?.title) ?? ''}</h3>
                          <p className="mt-1 text-sm text-ink-muted">{formatDateTime(attendanceEvent?.start_time)}{attendanceEvent?.location ? ` at ${attendanceEvent.location}` : ''}</p>
                          <div className="mt-2"><EventStatus event={attendanceEvent || {}} text={statusLabel[attendanceEvent?.status] || capitalize(attendanceEvent?.status)} /></div>
                        </div>
                        <Button variant="secondary" onClick={() => setAttendanceReload((value) => value + 1)}>Refresh</Button>
                      </div>

                      <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4">
                        {[
                          ['Inside now', currentlyInside, null],
                          ['Arrivals', attendanceCount, attendanceRate === null ? null : `${attendanceRate}% of ${expectedAttendance} expected`],
                          ['Late', attendanceData?.summary?.late ?? 0, null],
                        ].map(([label, value, helper]) => (
                          <div key={label}>
                            <dt className="text-xs text-ink-muted">{label}</dt>
                            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</dd>
                            {helper && <p className="mt-0.5 text-xs text-ink-muted">{helper}</p>}
                          </div>
                        ))}
                      </dl>
                    </div>

                    {/* Check-in form - officer only */}
                    {canManageAttendance && ['approved', 'ongoing'].includes(attendanceData?.event?.status) ? (
                      <div className="grid items-start gap-6 border-t border-line py-5 lg:grid-cols-2 lg:gap-8">
                        {rosterError && <ErrorState className="py-0 lg:col-span-2" title="The member list did not load" description="Fingerprint check-in needs it to match a fingerprint to a member. Try again before checking people in." onRetry={() => setRosterReload((count) => count + 1)} />}
                        <div className="flex flex-col gap-3">
                          <h4 className="text-sm font-semibold text-ink">Manual check-in</h4>
                          <PersonPicker
                            label="Member"
                            organizationId={attendanceEvent?.organization_id}
                            value={checkInPerson}
                            onSelect={(person) => {
                              setCheckInPerson(person);
                              setCheckInSuccess(null);
                              if (person && checkedInUserIds.has(person.school_id)) {
                                setCheckInError('This member is already checked in for this event.');
                                notify.error('This member is already checked in for this event.');
                              } else {
                                setCheckInError(null);
                              }
                            }}
                            disabled={checkInSubmitting}
                          />
                          <Field label="Attendance status">
                            <HiusaSelect id="attendance-status" value={checkInStatus} onChange={(event) => setCheckInStatus(event.target.value)}>
                              <option value="present">Present</option>
                              <option value="late">Late</option>
                              <option value="excused">Excused</option>
                              <option value="absent">Absent</option>
                            </HiusaSelect>
                          </Field>
                          {checkInError && <p role="alert" className="text-sm font-medium text-danger-strong">{checkInError}</p>}
                          {checkInSuccess && <p role="status" className="text-sm font-medium text-success-strong">{checkInSuccess}</p>}
                          <Button leftIcon={UserCheck} className="w-full sm:w-auto sm:self-start" onClick={handleCheckIn} loading={checkInSubmitting} disabled={!checkInPerson}>Confirm check-in</Button>
                        </div>
                        <BiometricCheckIn
                          eventId={selectedAttEventId}
                          users={allUsers}
                          academicStructure={attendanceAcademicStructure}
                          academicStructureError={attendanceAcademicStructureError}
                          department={attendanceAcademicStructure?.department || currentUser.department || currentUser.organization?.college || allUsers.find((user) => user.department)?.department || ''}
                          onRecorded={async () => setAttendanceReload((value) => value + 1)}
                        />
                      </div>
                    ) : canManageAttendance ? (
                      <div className="border-t border-line py-4">
                        <p className="text-sm font-semibold text-ink">Check-in is closed</p>
                        <p className="mt-0.5 text-sm text-ink-muted">This event no longer accepts attendance records. The final register remains available below.</p>
                      </div>
                    ) : null}

                    {/* Attendees table */}
                    {(attendanceData?.records?.length ?? 0) === 0 && !attendanceFiltered ? (
                      <div className="border-t border-line"><EmptyState title="No attendance records yet" description="New arrivals will appear here after check-in." /></div>
                    ) : (
                      <div className="border-t border-line pt-5">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h4 className="text-base font-semibold text-ink">Attendance log</h4>
                          <p className="shrink-0 text-xs tabular-nums text-ink-muted">{attendanceMeta.total} matching</p>
                        </div>
                        <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                          <label className="relative"><span className="sr-only">Search attendance</span><Search size={14} className="pointer-events-none absolute left-3 top-3.5 text-ink-soft" /><Input value={attendanceSearch} onChange={(event) => setAttendanceSearch(event.target.value)} placeholder="Search attendee or academic profile" className="pl-8" /></label>
                          <HiusaSelect filter aria-label="Filter attendance status" value={attendanceStatusFilter} onChange={(event) => setAttendanceStatusFilter(event.target.value)}><option value="all">All statuses</option>{['present', 'late', 'excused', 'absent'].map((status) => <option key={status} value={status}>{capitalize(status)}</option>)}</HiusaSelect>
                          {canManageAttendance && <Button variant="secondary" leftIcon={Download} onClick={exportAttendance} disabled={!filteredAttendanceRecords.length}>Export CSV</Button>}
                        </div>
                        <ul className="divide-y divide-line lg:hidden" aria-label="Attendance records">
                          {pagedAttendanceRecords.map((rec) => (
                            <li key={rec.id} className="py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{rec.user ? `${formatDisplayText(rec.user.first_name)} ${formatDisplayText(rec.user.last_name)}` : ''}</p><p className="mt-0.5 text-xs text-ink-muted">School ID {rec.user?.school_id ?? ''}</p></div>
                                <AttendanceStatus status={rec.status} />
                              </div>
                              <dl className="mt-2 grid grid-cols-2 gap-3 text-xs">
                                <div><dt className="text-ink-muted">Check-in</dt><dd className="mt-0.5 font-medium text-ink">{formatDateTime(rec.check_in_time)}</dd></div>
                                <div><dt className="text-ink-muted">Method</dt><dd className="mt-0.5 font-medium text-ink">{capitalize(rec.method)}</dd></div>
                              </dl>
                              <p className="mt-2 text-xs text-ink-muted">{[rec.user?.program, rec.user?.major, rec.user?.year_level, rec.user?.section].filter(Boolean).join(' · ')}</p>
                            </li>
                          ))}
                          {!filteredAttendanceRecords.length && <li className="py-8 text-sm text-ink-muted">No attendance records match the filters.</li>}
                        </ul>
                        <div className="hidden lg:block">
                        <table className="w-full text-left">
                          <caption className="sr-only">Attendance records</caption>
                          <thead>
                            <tr>
                              <th scope="col" className="px-4 py-2.5">Member</th>
                              <th scope="col" className="px-4 py-2.5">Status</th>
                              <th scope="col" className="px-4 py-2.5">Check in / out</th>
                              <th scope="col" className="px-4 py-2.5">Recorded by</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-soft">
                            {pagedAttendanceRecords.map((rec) => (
                              <tr key={rec.id} className="hover:bg-subtle">
                                <td className="px-4 py-2.5 font-medium text-ink">
                                  {rec.user ? `${formatDisplayText(rec.user.first_name)} ${formatDisplayText(rec.user.last_name)}` : ''}
                                  <p className="text-xs font-normal text-ink-muted">{[rec.user?.school_id, ...[rec.user?.program, rec.user?.major, rec.user?.year_level, rec.user?.section].filter(Boolean)].filter((value) => value !== undefined && value !== null && value !== '').join(' · ')}</p>
                                </td>
                                <td className="px-4 py-2.5"><AttendanceStatus status={rec.status} /></td>
                                <td className="px-4 py-2.5 text-xs text-ink"><p className="whitespace-nowrap">{formatDateTime(rec.check_in_time)}</p><p className="whitespace-nowrap text-ink-muted">Out: {formatDateTime(rec.check_out_time)} · {capitalize(rec.method)}</p></td>
                                <td className="px-4 py-2.5 text-xs text-ink"><p>{rec.recorder ? `${formatDisplayText(rec.recorder.first_name)} ${formatDisplayText(rec.recorder.last_name)}` : ''}</p></td>
                              </tr>
                            ))}
                            {!filteredAttendanceRecords.length && <tr><td colSpan={4} className="px-4 py-8 text-sm text-ink-muted">No attendance records match the filters.</td></tr>}
                          </tbody>
                        </table>
                        </div>
                        <PaginationControls currentPage={attendanceMeta.currentPage} totalItems={attendanceMeta.total} pageSize={attendanceMeta.perPage} onPageChange={setAttendancePage} label="attendance records" />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {selectedEvent && (
        <AccessibleOverlay label="Event details" onClose={closeEventDetails} closeOnBackdrop className="fixed inset-0 z-50 flex justify-end bg-navy-950/50">
          <div className="drawer-slide-in flex h-full w-full max-w-2xl flex-col gap-5 overflow-y-auto border-l border-line bg-surface p-5">
            {selectedEvent.image_url && <img src={resolveAssetUrl(selectedEvent.image_url)} alt="" className="max-h-60 w-full rounded-control object-cover" />}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <EventStatus event={selectedEvent} text={eventStatusText(selectedEvent)} />
                <h2 className="mt-2 text-xl font-semibold text-ink">{formatDisplayText(selectedEvent.title) || 'Loading event'}</h2>
              </div>
              <button type="button" aria-label="Close event details" onClick={closeEventDetails} className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-subtle"><X size={18} /></button>
            </div>
            {selectedFlow && !detailsLoading && (
              <EventFlowPanel flow={selectedFlow}>
                {filesAtStage && eventFilesPanel}
              </EventFlowPanel>
            )}
            {detailsLoading ? (
              <div role="status" aria-label="Loading event details"><SkeletonText lines={4} /></div>
            ) : (
              <div className="space-y-5 text-sm text-ink-muted-strong">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><dt className="text-xs text-ink-muted">Schedule</dt><dd className="mt-0.5 text-ink">{formatDateTime(selectedEvent.start_time)} to {formatDateTime(selectedEvent.end_time)}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Location</dt><dd className="mt-0.5 text-ink">{selectedEvent.location || ''}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Event type</dt><dd className="mt-0.5 text-ink">{selectedEvent.planning_details?.event_type || ''}</dd></div>
                  <div><dt className="text-xs text-ink-muted">Expected participants</dt><dd className="mt-0.5 tabular-nums text-ink">{selectedEvent.planning_details?.expected_participants || ''}</dd></div>
                </dl>
                <section className="border-t border-line pt-4"><h3 className="text-sm font-semibold text-ink">Description</h3><RichTextBody value={selectedEvent.description || 'No description provided.'} className="mt-1" /></section>
                <dl className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-ink-muted">Preparation progress</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums text-ink">{selectedEvent.tasks_count ? `${Math.round((selectedEvent.completed_tasks_count || 0) / selectedEvent.tasks_count * 100)}%` : 'No linked tasks'}</dd>
                    <p className="mt-0.5 text-xs text-ink-muted">{selectedEvent.completed_tasks_count || 0} of {selectedEvent.tasks_count || 0} event tasks completed</p>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">Attendance summary</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums text-ink">{selectedEvent.attendance_records_count ?? 0} recorded</dd>
                    {selectedEvent.attendance_summary && (
                      <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                        Present {selectedEvent.attendance_summary.present ?? 0} · Late {selectedEvent.attendance_summary.late ?? 0} · Excused {selectedEvent.attendance_summary.excused ?? 0} · Absent {selectedEvent.attendance_summary.absent ?? 0}
                      </p>
                    )}
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">Approval stage</dt>
                    <dd className="mt-0.5 font-semibold text-ink">{stageText(selectedEvent) || capitalize(selectedEvent.approval_status || selectedEvent.status)}</dd>
                  </div>
                </dl>
                {(selectedEvent.planning_details?.requirements || selectedEvent.planning_details?.resources || selectedEvent.planning_details?.budget_notes || selectedEvent.planning_details?.vendor_deadlines || selectedEvent.planning_details?.logistics_checklist) && (
                  <section className="space-y-2 border-t border-line pt-4">
                    <h3 className="text-sm font-semibold text-ink">Planning details</h3>
                    {selectedEvent.planning_details?.requirements && <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Requirements:</span> {selectedEvent.planning_details.requirements}</p>}
                    {selectedEvent.planning_details?.resources && <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Resources:</span> {selectedEvent.planning_details.resources}</p>}
                    {selectedEvent.planning_details?.budget_notes && <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Budget requirements:</span> {selectedEvent.planning_details.budget_notes}</p>}
                    {selectedEvent.planning_details?.vendor_deadlines && <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Vendor deadlines:</span> {selectedEvent.planning_details.vendor_deadlines}</p>}
                    {selectedEvent.planning_details?.logistics_checklist && <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Logistics checklist:</span> {selectedEvent.planning_details.logistics_checklist}</p>}
                  </section>
                )}
                {canCreateEvents && (
                  <section className="border-t border-line pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-ink">Linked budget status</h3>
                        <p className="mt-0.5 text-xs text-ink-muted">Only budgets explicitly linked to this event are included.</p>
                      </div>
                      <Button variant="secondary" leftIcon={Wallet} onClick={() => navigate(selectedEvent.budgets?.length === 1 ? `/dashboard/finance/budget-allocation?record=${selectedEvent.budgets[0].id}` : `/dashboard/finance/budget-allocation?event=${selectedEvent.id}`)}>
                        Manage budgets
                      </Button>
                    </div>
                    {selectedEvent.financial_summary && (
                      <div className="mt-3">
                        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {[
                            ['Allocated', selectedEvent.financial_summary.allocated_budget],
                            ['Spent', selectedEvent.financial_summary.spent],
                            ['Income', selectedEvent.financial_summary.income],
                            ['Remaining', selectedEvent.financial_summary.remaining_budget],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-xs text-ink-muted">{label}</dt>
                              <dd className="mt-0.5 font-semibold tabular-nums text-ink">{formatCurrency(value)}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-2 text-xs text-ink-muted">Cash advances are not counted here.</p>
                        <div className="mt-3">
                          <p className="text-xs text-ink-muted">Financial risk and latest organization forecast</p>
                          <p className="mt-0.5 font-semibold text-ink">Risk: {capitalize(selectedEvent.financial_summary.risk)}</p>
                          {selectedEvent.financial_summary.latest_forecast ? (
                            <p className="mt-0.5 text-xs text-ink-muted">{selectedEvent.financial_summary.latest_forecast.forecast_period}: projected income {formatCurrency(selectedEvent.financial_summary.latest_forecast.predicted_income)}, expense {formatCurrency(selectedEvent.financial_summary.latest_forecast.predicted_expense)}, balance {formatCurrency(selectedEvent.financial_summary.latest_forecast.predicted_balance)}</p>
                          ) : <p className="mt-0.5 text-xs text-ink-muted">No OLS forecast has been generated yet.</p>}
                        </div>
                      </div>
                    )}
                    {selectedEvent.budgets?.length ? (
                      <ul className="mt-3 divide-y divide-line-soft border-t border-line-soft">
                        {selectedEvent.budgets.map((budget) => (
                          <li key={budget.id} className="py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold text-ink">{formatDisplayText(budget.title)}</p>
                              <BudgetApproval status={budget.approval_status} />
                            </div>
                            {['pending_department_head', 'pending_sao'].includes(budget.submission_status) && <p className="mt-1 text-xs text-ink-muted-strong">{budgetLifecycle(budget, currentUserRole).nextAction.title}</p>}
                            <p className="mt-1 text-xs tabular-nums text-ink-muted">Allocated {formatCurrency(budget.allocated_amount)} · Spent {formatCurrency(budget.spent_amount)} · Income {formatCurrency(budget.income_amount)} · Remaining {formatCurrency(budget.remaining_amount)} · {budget.transactions_count ?? 0} transaction(s)</p>
                            {budget.advice_generated_at && <p className="mt-1 text-xs text-ink-muted">Advisory risk: {capitalize(budget.overspending_risk || 'not analyzed')} · Safe spending {formatCurrency(budget.safe_spending_limit)}</p>}
                            {budget.approval_remarks && <p className="mt-1 text-xs text-danger-strong">Remarks: {budget.approval_remarks}</p>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={`mt-3 text-sm ${selectedEvent.requires_budget ? 'text-danger-strong' : 'text-ink-muted'}`}>
                        {selectedEvent.requires_budget ? 'This event requires funding, but no budget allocation is linked yet.' : 'This event does not require a budget allocation.'}
                      </p>
                    )}
                  </section>
                )}
                {canCreateEvents && (allowedStatusTransitions[selectedEvent.status]?.length ?? 0) > 0 && (
                  <section className="border-t border-line pt-4">
                    <h3 className="text-sm font-semibold text-ink">Update event status</h3>
                    <p className="mt-0.5 text-xs text-ink-muted">Approval can only be granted through the approval workflow.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {allowedStatusTransitions[selectedEvent.status].map((status) => (
                        <Button key={status} variant="secondary" disabled={statusUpdating} onClick={() => handleStatusUpdate(status)}>
                          {statusUpdating ? 'Updating...' : `Mark ${capitalize(status)}`}
                        </Button>
                      ))}
                    </div>
                    {statusError && <p role="alert" className="mt-2 text-xs text-danger-strong">{statusError}</p>}
                  </section>
                )}
                {!selectedFlow && isReturned(selectedEvent) && selectedEvent.approval_remarks && <p className="border-t border-line pt-4 text-danger-strong"><span className="font-semibold">Approval remarks:</span> {selectedEvent.approval_remarks}</p>}
                <EventRegistrationPanel event={selectedEvent} role={currentUserRole} />
                {!filesAtStage && eventFilesPanel}
              </div>
            )}
            {selectedFlow && !detailsLoading && (
              <EventFlowFooter flow={selectedFlow} busy={statusUpdating} onEdit={() => { const target = selectedEvent; closeEventDetails(); openEditForm(target); }} onStart={() => handleStatusUpdate('ongoing')} />
            )}
          </div>
        </AccessibleOverlay>
      )}

      <ConfirmModal
        open={confirmingDiscard}
        title="Remove this draft?"
        message="No tasks have been created from it yet."
        confirmText="Remove draft"
        cancelText="Keep draft"
        variant="danger"
        onCancel={() => setConfirmingDiscard(false)}
        onConfirm={discardWorkflow}
      />
      <ConfirmModal
        open={Boolean(eventToDelete)}
        title="Delete this event?"
        message="Its tasks, attendance records, registrations, approval request and requirement files are deleted too. Venue bookings are kept but unlinked. This cannot be undone."
        recordName={eventToDelete?.title}
        confirmText="Delete event"
        variant="danger"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => setEventToDelete(null)}
        onConfirm={confirmDeleteEvent}
      />
      <ConfirmModal
        open={Boolean(eventToCancel)}
        title="Cancel this event?"
        message="The event stays on record as cancelled because its files, approvals, attendance, budget or venue booking keep it from being deleted. Its pending and approved venue bookings are withdrawn so the venue is free again. A cancelled event cannot be reopened."
        recordName={eventToCancel?.title}
        confirmText="Cancel event"
        cancelText="Keep event"
        variant="danger"
        busy={cancelBusy}
        error={cancelError}
        onCancel={() => setEventToCancel(null)}
        onConfirm={confirmCancelEvent}
      />
    </div>
  );
}
