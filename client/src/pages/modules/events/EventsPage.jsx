import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Fingerprint,
  ImagePlus,
  List,
  MapPin,
  Pencil,
  Plus,
  Search,
  UserCheck,
  UserRoundCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { getEvents, getEvent, createEvent, updateEvent, updateEventStatus, generateEventPlan, getEventWorkflowHistory, confirmEventWorkflow, discardEventWorkflow, getAttendance, recordAttendance } from '../../../services/eventService';
import { getTasks } from '../../../services/taskService';
import { getAcademicStructure, getUsers } from '../../../services/userService';
import PaginationControls from '../../../components/PaginationControls';
import Modal from '../../../components/Modal';
import { fetchAllPages } from '../../../services/pagination';
import ActivityCalendar from '../../../components/calendar/ActivityCalendar';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDateTime, isoToLocalDateTimeInput, localDateTimeToIso, replaceIsoDateTimes } from '../../../utils/dateTime';
import { useFingerprintReader } from '../../../hooks/useFingerprintReader';
import { confirmFingerprintAttendance, identifyAttendanceFingerprint } from '../../../services/fingerprintService';
import ScannerStatus from '../../../components/fingerprint/ScannerStatus';

const statusBadge = {
  planning: 'bg-amber-50 text-amber-700',
  upcoming: 'bg-[#E6F6FD] text-[#0B8ED0]',
  approved: 'bg-[#E6F6FD] text-[#0B8ED0]',
  ongoing: 'bg-violet-50 text-violet-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

const statusLabel = {
  planning: 'Pending Approval',
};

const taskStatusBadge = {
  pending: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-[#E6F6FD] text-[#0B8ED0]',
  completed: 'bg-emerald-50 text-emerald-700',
  overdue: 'bg-red-50 text-red-700',
  blocked: 'bg-amber-50 text-amber-700',
  ready: 'bg-cyan-50 text-cyan-700',
};

const budgetStatusBadge = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
};

const attendanceStatusBadge = {
  present: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  late: 'border-amber-200 bg-amber-50 text-amber-700',
  excused: 'border-sky-200 bg-sky-50 text-sky-700',
  absent: 'border-red-200 bg-red-50 text-red-700',
};

const allowedStatusTransitions = {
  planning: ['cancelled'],
  approved: ['ongoing', 'completed', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

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

function formatCurrency(value) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getEventBudgetStatus(event) {
  if (!event.budgets?.length) {
    return event.requires_budget
      ? { label: 'Not linked', tone: 'bg-red-50 text-red-700' }
      : { label: 'Not required', tone: 'bg-slate-100 text-slate-500' };
  }
  if (event.budgets.some((budget) => budget.approval_status === 'rejected')) return { label: 'Rejected', tone: budgetStatusBadge.rejected };
  if (event.budgets.some((budget) => budget.approval_status === 'pending' || !budget.approval_status)) return { label: 'Pending', tone: budgetStatusBadge.pending };
  return { label: 'Approved', tone: budgetStatusBadge.approved };
}

const emptyEventForm = () => ({
  title: '', date: '', startTime: '', endDate: '', endTime: '', location: '', description: '', imageFile: null,
  requires_budget: false, event_type: '', expected_participants: '', requirements: '', resources: '',
  proposed_budget_amount: '', budget_warning_threshold: '', budget_notes: '', vendor_deadlines: '', logistics_checklist: '',
  proposed_budget_id: null,
});

const attendanceYearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

function BiometricCheckIn({ eventId, onRecorded, users = [], department = '', academicStructure = null, academicStructureError = '' }) {
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
      .filter((program) => !selectedProgram || program.name === selectedProgram)
      .flatMap((program) => program.sections || [])
      .filter((section) => !selectedYearLevels.length || selectedYearLevels.includes(attendanceYearLevels[Number(section.year_level) - 1]))
      .map((section) => section.name)
    : scopedUsers
      .filter((user) => (!selectedProgram || user.program === selectedProgram)
        && (!selectedYearLevels.length || selectedYearLevels.includes(user.year_level)))
      .map((user) => user.section);
  const sectionOptions = [...new Set(configuredSections.filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  useEffect(() => {
    if (!Array.isArray(academicStructure?.programs)) return;

    const configuredProgramNames = academicStructure.programs.map((program) => program.name).filter(Boolean);
    if (selectedProgram && !configuredProgramNames.includes(selectedProgram)) {
      setSelectedProgram('');
      setSelectedSection('');
      return;
    }

    const validSections = academicStructure.programs
      .filter((program) => !selectedProgram || program.name === selectedProgram)
      .flatMap((program) => program.sections || [])
      .filter((section) => !selectedYearLevels.length || selectedYearLevels.includes(attendanceYearLevels[Number(section.year_level) - 1]))
      .map((section) => section.name);
    if (selectedSection && !validSections.includes(selectedSection)) setSelectedSection('');
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
        ...(selectedProgram ? { programs: [selectedProgram] } : {}),
        ...(selectedSection ? { sections: [selectedSection] } : {}),
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
    <div className="flex h-full flex-col rounded-lg border border-[#B9D9E9] bg-[#F8FBFD] p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#0B8ED0] text-white"><Fingerprint size={19} /></span>
        <div><p className="text-[13px] font-bold text-[#0F172A]">Fingerprint check-in / checkout</p><p className="mt-0.5 text-xs font-medium leading-5 text-slate-500">Scan, verify the matched Student, then confirm check-in or checkout.</p></div>
      </div>
      <ScannerStatus reader={reader} />
      <fieldset disabled={busy || Boolean(pendingConfirmation)} className="mt-4 border-t border-[#DDE7EF] pt-4 disabled:opacity-60">
        <legend className="sr-only">Narrow fingerprint candidates</legend>
        <div className="flex items-start gap-2 rounded-lg border border-[#B9D9E9] bg-white px-3 py-2.5">
          <UserCheck size={15} className="mt-0.5 shrink-0 text-[#0B8ED0]" />
          <p className="text-[11px] font-semibold leading-4 text-slate-600"><span className="font-bold text-[#0F172A]">Required scope:</span> active Students in {department || 'this organization’s configured department'} only.</p>
        </div>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">Optional candidate filters</p>
        {academicStructureError && <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">{academicStructureError}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {attendanceYearLevels.map((yearLevel) => (
            <label key={yearLevel} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[11px] font-bold transition ${selectedYearLevels.includes(yearLevel) ? 'border-[#0B8ED0] bg-[#E6F6FD] text-[#0878B7]' : 'border-[#DDE7EF] bg-white text-slate-600'}`}>
              <input type="checkbox" checked={selectedYearLevels.includes(yearLevel)} onChange={() => toggleYearLevel(yearLevel)} className="h-4 w-4 accent-[#0B8ED0]" /> {yearLevel}
            </label>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-bold text-slate-600">Program
            <select aria-label="Fingerprint program filter" value={selectedProgram} onChange={(event) => { clearCandidate(); setSelectedProgram(event.target.value); setSelectedSection(''); }} className="mt-1 h-10 w-full rounded-lg border border-[#DDE7EF] bg-white px-2.5 text-xs font-semibold text-[#0F172A] outline-none focus:border-[#0B8ED0]">
              <option value="">All programs</option>
              {programOptions.map((program) => <option key={program} value={program}>{program}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600">Section
            <select aria-label="Fingerprint section filter" value={selectedSection} onChange={(event) => { clearCandidate(); setSelectedSection(event.target.value); }} className="mt-1 h-10 w-full rounded-lg border border-[#DDE7EF] bg-white px-2.5 text-xs font-semibold text-[#0F172A] outline-none focus:border-[#0B8ED0]">
              <option value="">All sections</option>
              {sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      {result && <div className={`mt-3 rounded-lg border px-3 py-2.5 text-xs font-semibold ${result.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : result.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
        {result.user && <p className="mb-0.5 font-black">{result.user.first_name} {result.user.last_name} · {result.user.school_id}</p>}
        <p>{result.message}</p>
      </div>}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <button type="button" onClick={scan} disabled={!reader.connected || busy || Boolean(pendingConfirmation)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white transition hover:bg-[#0878B7] focus:outline-none focus:ring-2 focus:ring-[#16C7F3] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
          <Fingerprint size={16} /> {busy ? 'Scanning and identifying...' : 'Scan Fingerprint'}
        </button>
        {busy && !pendingConfirmation && <button type="button" onClick={reader.cancelCapture} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-4 text-[13px] font-bold text-slate-600">Cancel</button>}
      </div>
    </div>

    <Modal
      open={Boolean(pendingConfirmation)}
      title={`Confirm Fingerprint ${confirmationAction}`}
      description="Verify the matched Student before changing the attendance register."
      onClose={busy ? undefined : rejectCandidate}
      closeOnBackdrop={false}
      closeOnEscape={!busy}
      maxWidth="max-w-md"
      footer={pendingConfirmation ? <>
        <button type="button" onClick={rejectCandidate} disabled={busy} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-4 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] disabled:opacity-50">No, Scan Again</button>
        <button type="button" data-autofocus onClick={confirm} disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-sm font-bold text-white hover:bg-[#0878B7] disabled:opacity-50"><CheckCircle2 size={16} /> {busy ? 'Confirming...' : `Confirm ${confirmationAction}`}</button>
      </> : null}
    >
      {pendingConfirmation && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0B8ED0] text-xs font-black text-white">{pendingConfirmation.user?.first_name?.[0]}{pendingConfirmation.user?.last_name?.[0]}</span>
            <div className="min-w-0"><p className="text-sm font-black text-[#0F172A]">Is this the correct Student?</p><p className="mt-1 truncate text-base font-black text-[#0F172A]">{pendingConfirmation.user?.first_name} {pendingConfirmation.user?.last_name}</p><p className="text-xs font-semibold leading-5 text-slate-500">School ID {pendingConfirmation.user?.school_id} · {[pendingConfirmation.user?.program, pendingConfirmation.user?.year_level, pendingConfirmation.user?.section].filter(Boolean).join(' · ') || 'Academic profile unavailable'}</p></div>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-[11px]">
            <div><p className="font-bold uppercase tracking-wide text-slate-400">Action</p><p className="mt-1 font-black text-[#0B8ED0]">{pendingConfirmation.action === 'check_out' ? 'Check out' : 'Check in'}</p></div>
            <div><p className="font-bold uppercase tracking-wide text-slate-400">Match score</p><p className="mt-1 font-black text-[#0F172A]">{Number(pendingConfirmation.match?.score ?? 0).toFixed(1)} <span className="font-semibold text-slate-400">/ required {Number(pendingConfirmation.match?.threshold ?? 60).toFixed(0)}</span></p></div>
          </div>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-5 text-amber-800">Only confirm when the Student’s face and School ID match the person at the reader.</p>
        </div>
      )}
    </Modal>
    </>
  );
}

export default function EventsPage({ initialTab = 'events', startEventRequest = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isCheckInRoute = location.pathname.endsWith('/check-in');
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [eventsView, setEventsView] = useState(() => (location.pathname.endsWith('activity-calendar') ? 'calendar' : 'list'));
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
  const [selectedEvent, setSelectedEvent] = useState(null);
  const detailsRequestRef = useRef(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventPageSize, setEventPageSize] = useState(10);
  const [eventSort, setEventSort] = useState('start_asc');
  const [eventReload, setEventReload] = useState(0);
  const [tasksPage, setTasksPage] = useState(1);
  const [attendancePage, setAttendancePage] = useState(1);
  const pageSize = 10;

  const [form, setForm] = useState(emptyEventForm);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [planForm, setPlanForm] = useState({ event_id: '', requirements: '' });
  const [planResult, setPlanResult] = useState('');
  const [workflowDraft, setWorkflowDraft] = useState(null);
  const [workflowOutputId, setWorkflowOutputId] = useState(null);
  const [workflowAction, setWorkflowAction] = useState(false);
  const [workflowHistory, setWorkflowHistory] = useState([]);
  const [planError, setPlanError] = useState(null);
  const [planSubmitting, setPlanSubmitting] = useState(false);

  const [selectedAttEventId, setSelectedAttEventId] = useState(null);
  const [attendanceData, setAttendanceData] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [attendanceAcademicStructure, setAttendanceAcademicStructure] = useState(null);
  const [attendanceAcademicStructureError, setAttendanceAcademicStructureError] = useState('');
  const [checkInSearch, setCheckInSearch] = useState('');
  const [checkInUserId, setCheckInUserId] = useState(null);
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

  let currentUser = {};
  try { currentUser = JSON.parse(localStorage.getItem('user') ?? '{}') ?? {}; } catch {}
  const currentUserRole = currentUser?.role ?? '';
  const canCreateEvents = currentUserRole === 'ADMIN';
  const canManageAttendance = ['ADMIN', 'SBO_OFFICER'].includes(currentUserRole);

  function load() {
    setLoading(true);
    setError(null);
    // Calendar/dropdown sources need the complete authorized event set. The
    // browsable event table is loaded separately with backend pagination.
    const canLoadTasks = currentUserRole === 'ADMIN' || currentUserRole === 'SBO_OFFICER';
    const requests = canLoadTasks
      ? [fetchAllPages((p) => getEvents(p).then((r) => r.data)), fetchAllPages((p) => getTasks(p).then((r) => r.data))]
      : [fetchAllPages((p) => getEvents(p).then((r) => r.data)), Promise.resolve([])];
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

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setEventListLoading(true);
      getEvents({ page: eventsPage, per_page: eventPageSize, search: search || undefined, date: dateFilter || undefined, status: eventStatusFilter || undefined, sort: eventSort })
        .then((response) => {
          if (!active) return;
          setEventRows(Array.isArray(response.data?.data) ? response.data.data : []);
          setEventTotal(Number(response.data?.total || 0));
        })
        .catch((requestError) => { if (active) setError(getApiErrorMessage(requestError, 'We could not load the event list. Check your connection and try again.')); })
        .finally(() => { if (active) setEventListLoading(false); });
    }, 250);

    return () => { active = false; window.clearTimeout(timer); };
  }, [dateFilter, eventPageSize, eventReload, eventSort, eventStatusFilter, eventsPage, search]);

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

  useEffect(() => {
    setEventsView(location.pathname.endsWith('activity-calendar') ? 'calendar' : 'list');
  }, [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'attendance' && canManageAttendance && !usersLoaded) {
      // /users is paginated - check-in search needs the full active roster,
      // not just its first page.
      fetchAllPages(getUsers, { account_status: 'active' })
        .then((data) => {
          setAllUsers(data);
          setUsersLoaded(true);
        })
        .catch(() => {});
    }
  }, [activeTab, canManageAttendance, usersLoaded]);

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
    setSelectedAttEventId(id);
    setAttendanceData(null);
    setAttendanceLoading(true);
    setCheckInSearch('');
    setCheckInUserId(null);
    setCheckInStatus('present');
    setCheckInError(null);
    setCheckInSuccess(null);
    setAttendanceSearch('');
    setDebouncedAttendanceSearch('');
    setAttendanceStatusFilter('all');
    setAttendancePage(1);
  }

  async function handleCheckIn() {
    if (!canManageAttendance || !checkInUserId) return;
    setCheckInSubmitting(true);
    setCheckInError(null);
    setCheckInSuccess(null);
    try {
      await recordAttendance(selectedAttEventId, {
        user_id: checkInUserId,
        method: 'manual',
        status: checkInStatus,
      });
      setCheckInUserId(null);
      setCheckInSearch('');
      setCheckInSuccess('Check-in recorded.');
      setAttendanceReload((value) => value + 1);
    } catch (err) {
      setCheckInError(getApiErrorMessage(err, 'We could not record this check-in. Please try again.'));
    } finally {
      setCheckInSubmitting(false);
    }
  }

  async function handleSaveEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.date || !form.startTime || !form.endDate || !form.endTime) return;
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

      if (editingEventId) {
        await updateEvent(editingEventId, payload);
      } else {
        await createEvent(payload);
      }
      setShowForm(false);
      setEditingEventId(null);
      setForm(emptyEventForm());
      load();
    } catch (err) {
      setFormError(getApiErrorMessage(err, `We could not ${editingEventId ? 'update' : 'create'} this event. Please try again.`));
    } finally {
      setFormSubmitting(false);
    }
  }

  function openCreateForm() {
    setEditingEventId(null);
    setForm(emptyEventForm());
    setFormError(null);
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

  async function openEventDetails(event) {
    const requestId = detailsRequestRef.current + 1;
    detailsRequestRef.current = requestId;
    setSelectedEvent(event);
    setDetailsLoading(true);
    setStatusError(null);
    try {
      const response = await getEvent(event.id);
      if (detailsRequestRef.current === requestId) setSelectedEvent(response.data);
    } catch {
      if (detailsRequestRef.current === requestId) setSelectedEvent(event);
    } finally {
      if (detailsRequestRef.current === requestId) setDetailsLoading(false);
    }
  }

  function closeEventDetails() {
    detailsRequestRef.current += 1;
    setSelectedEvent(null);
    setDetailsLoading(false);
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
    } catch (err) {
      setStatusError(getApiErrorMessage(err, 'We could not update the event status. Please try again.'));
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleGeneratePlan(e) {
    e.preventDefault();
    if (!planForm.event_id || !planForm.requirements.trim()) return;
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
      getEventWorkflowHistory(planForm.event_id).then((history) => setWorkflowHistory(history.data || [])).catch(() => {});
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
    setWorkflowDraft(null); setWorkflowOutputId(null); setPlanResult(''); setPlanError(null);
    if (!eventId) { setWorkflowHistory([]); return; }
    getEventWorkflowHistory(eventId).then((response) => setWorkflowHistory(response.data || [])).catch(() => setWorkflowHistory([]));
  }

  function updateWorkflowTask(index, field, value) {
    setWorkflowDraft((current) => ({ ...current, tasks: current.tasks.map((task, taskIndex) => taskIndex === index ? { ...task, [field]: value } : task) }));
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
    const incompleteTask = workflowDraft.tasks.findIndex((task) => !task.title?.trim() || !task.deadline);
    if (incompleteTask !== -1) {
      setPlanError(`To-do ${incompleteTask + 1} needs a name and due date before you can save it.`);
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
    if (!window.confirm('Remove this draft? No tasks have been created from it yet.')) return;
    setWorkflowAction(true); setPlanError(null);
    try {
      await discardEventWorkflow(planForm.event_id, workflowOutputId);
      setWorkflowDraft(null); setWorkflowOutputId(null); setPlanResult('Draft removed. No tasks were created.');
      setWorkflowHistory((current) => current.map((output) => output.id === workflowOutputId ? { ...output, decision_status: 'discarded' } : output));
    } catch (requestError) {
      setPlanError(getApiErrorMessage(requestError, 'We could not remove this draft. Please try again.'));
    } finally { setWorkflowAction(false); }
  }

  const upcoming = events.filter((e) => ['upcoming', 'approved'].includes(e.status)).length;
  const completed = events.filter((e) => e.status === 'completed').length;

  const filteredEvents = eventRows;
  const eventLinkedTasks = tasks.filter((t) => t.event_id);
  const pagedEvents = eventRows;
  const pagedEventTasks = eventLinkedTasks.slice((tasksPage - 1) * pageSize, tasksPage * pageSize);
  const selectedPlanningEvent = events.find((event) => String(event.id) === String(planForm.event_id));

  const checkedInUserIds = new Set((attendanceData?.records ?? []).map((r) => r.user_id));
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
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `attendance-${event?.id || 'event'}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const attendanceEvents = events.filter((event) => {
    if (canManageAttendance) {
      return (isCheckInRoute ? ['approved', 'ongoing'] : ['approved', 'ongoing', 'completed']).includes(event.status);
    }
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    return ['approved', 'ongoing'].includes(event.status) && Number.isFinite(start) && Number.isFinite(end) && currentTime >= start && currentTime <= end;
  });
  const attendanceEvent = attendanceData?.event ?? attendanceEvents.find((event) => String(event.id) === String(selectedAttEventId));
  const attendanceCount = Number(attendanceData?.count ?? attendanceData?.records?.length ?? 0);
  const currentlyInside = Number(attendanceData?.checked_in_count ?? attendanceCount);
  const expectedAttendance = Number(attendanceEvent?.planning_details?.expected_participants ?? 0);
  const attendanceRate = expectedAttendance > 0 ? Math.min(100, Math.round((attendanceCount / expectedAttendance) * 100)) : null;
  const filteredCheckInUsers = allUsers
    .filter(
      (u) =>
        !checkedInUserIds.has(u.school_id ?? u.id) &&
        (checkInSearch.trim() === '' ||
          `${u.first_name} ${u.last_name}`.toLowerCase().includes(checkInSearch.toLowerCase()) ||
          String(u.school_id ?? '').toLowerCase().includes(checkInSearch.toLowerCase()))
    )
    .slice(0, 6);

  useEffect(() => {
    setEventsPage(1);
  }, [search, dateFilter, eventStatusFilter, eventSort]);

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

  useEffect(() => {
    setTasksPage(1);
  }, [tasks.length]);

  return (
    <div className="space-y-6">
      {activeTab !== 'attendance' && <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Total Events', value: events.length, helper: 'This academic year', icon: Calendar },
          { label: 'Upcoming', value: upcoming, helper: 'Scheduled', icon: Clock },
          { label: 'Completed', value: completed, helper: 'Successfully held', icon: CheckCircle2 },
          { label: 'Total Tasks', value: tasks.length, helper: 'Across all events', icon: Users },
        ].map((stat) => (
          <article key={stat.label} className="group rounded-xl border border-[#DDE7EF] bg-white p-3 sm:p-5 shadow-sm transition hover:shadow-md hover:border-[#0B8ED0]/20">
            <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition">
              <stat.icon size={19} />
            </div>
            <p className="text-sm font-semibold text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-black text-[#0F172A]">{stat.value}</p>
            <p className="mt-1 text-xs font-medium text-slate-400">{stat.helper}</p>
          </article>
        ))}
      </section>}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-600 underline">Try again</button>
        </div>
      )}

      {activeTab === 'events' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">All Events</h2>
              <p className="text-sm font-medium text-slate-500">Create, manage, and monitor events</p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:items-center">
              <div role="group" aria-label="Switch events view" className="flex h-11 shrink-0 items-center rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-1">
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={eventsView === 'list'}
                  onClick={() => setEventsView('list')}
                  className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-bold transition ${eventsView === 'list' ? 'bg-white text-[#0B8ED0] shadow-sm' : 'text-slate-500'}`}
                >
                  <List size={15} /> <span className="hidden sm:inline">List</span>
                </button>
                <button
                  type="button"
                  aria-label="Calendar view"
                  aria-pressed={eventsView === 'calendar'}
                  onClick={() => setEventsView('calendar')}
                  className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-bold transition ${eventsView === 'calendar' ? 'bg-white text-[#0B8ED0] shadow-sm' : 'text-slate-500'}`}
                >
                  <Calendar size={15} /> <span className="hidden sm:inline">Calendar</span>
                </button>
              </div>
              {eventsView === 'list' && (
                <>
                  <div className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] px-3 sm:flex-none">
                    <Search size={15} className="text-slate-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      type="text"
                      placeholder="Search events..."
                      className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400 sm:w-[140px]"
                    />
                  </div>
                  <input
                    type="date"
                    aria-label="Filter events by date"
                    value={dateFilter}
                    onChange={(event) => setDateFilter(event.target.value)}
                    className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-[13px] outline-none focus:border-[#0B8ED0]"
                  />
                  <select aria-label="Filter events by status" value={eventStatusFilter} onChange={(event) => setEventStatusFilter(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-[13px]"><option value="">All statuses</option>{['planning', 'approved', 'ongoing', 'completed', 'cancelled'].map((value) => <option key={value} value={value}>{statusLabel[value] || capitalize(value)}</option>)}</select>
                  <select aria-label="Sort events" value={eventSort} onChange={(event) => setEventSort(event.target.value)} className="h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-[13px]"><option value="start_asc">Soonest</option><option value="start_desc">Latest date</option><option value="newest">Newest created</option><option value="title">Title</option></select>
                </>
              )}
              {canCreateEvents && (
                <button onClick={openCreateForm} className="flex h-11 items-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white hover:bg-[#0878B7] transition">
                  <Plus size={16} />
                  <span className="hidden sm:inline">Create Event</span>
                </button>
              )}
            </div>
          </div>

          {eventsView === 'calendar' ? (
            <ActivityCalendar
              events={events}
              loading={loading}
              onSelectEvent={openEventDetails}
            />
          ) : (
            <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
              {eventListLoading ? (
                <div className="space-y-2 p-5">
                  {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
                </div>
              ) : filteredEvents.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">No events found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1280px] text-left">
                    <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Event</th>
                        <th className="px-5 py-3">Organizer</th>
                        <th className="px-5 py-3">Schedule</th>
                        <th className="px-5 py-3">Venue</th>
                        <th className="px-5 py-3">Attendance</th>
                        <th className="px-5 py-3">Tasks</th>
                        <th className="px-5 py-3">Status</th>
                        {canCreateEvents && <th className="px-5 py-3">Budget Status</th>}
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5EDF3] text-sm">
                      {pagedEvents.map((evt) => (
                        <tr key={evt.id} className="transition hover:bg-[#F8FBFD]">
                          <td className="max-w-[260px] px-5 py-4"><p className="font-bold text-[#0F172A]">{evt.title}</p><p className="mt-1 line-clamp-2 text-[10px] text-slate-400">{evt.description || 'No description provided'}</p></td>
                          <td className="px-5 py-4 text-xs font-semibold text-slate-600">{evt.creator ? `${evt.creator.first_name} ${evt.creator.last_name}` : '-'}<p className="text-[10px] text-[#0B8ED0]">{evt.creator?.position_title || evt.creator?.role?.replaceAll('_', ' ') || '-'}</p></td>
                          <td className="px-5 py-4 font-medium text-slate-600">
                            <div className="flex items-center gap-1.5">
                              <Clock size={13} className="text-slate-400" />
                              {formatDateTime(evt.start_time)}
                            </div>
                            <p className="mt-1 text-[10px] text-slate-400">Ends {formatDateTime(evt.end_time)}</p>
                          </td>
                          <td className="px-5 py-4 font-medium text-slate-600">
                            <div className="flex items-center gap-1.5">
                              <MapPin size={13} className="text-slate-400" />
                              {evt.location || '-'}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-xs"><p className="font-bold text-[#0F172A]">{evt.present_count || 0} present/late</p><p className="text-[10px] text-slate-400">{evt.attendance_records_count || 0} total records</p></td>
                          <td className="px-5 py-4 text-xs"><p className="font-bold text-[#0F172A]">{evt.tasks_count || 0} linked</p><p className="text-[10px] text-slate-400">Workflow tasks</p></td>
                          <td className="px-5 py-4">
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[evt.status] || 'bg-slate-100 text-slate-500'}`}>
                              {statusLabel[evt.status] || capitalize(evt.status)}
                            </span>
                            {evt.approval_status === 'rejected' && evt.approval_remarks && (
                              <p className="mt-1 max-w-[220px] text-[11px] text-red-600">
                                <span className="font-semibold">Rejected:</span> {evt.approval_remarks}
                              </p>
                            )}
                          </td>
                          {canCreateEvents && (() => {
                            const budgetStatus = getEventBudgetStatus(evt);
                            return (
                              <td className="px-5 py-4">
                                <span className={`rounded-full px-3 py-1 text-xs font-bold ${budgetStatus.tone}`}>
                                  {budgetStatus.label}
                                </span>
                                {evt.budgets?.length > 0 && <p className="mt-1 text-[11px] text-slate-400">{evt.budgets.length} linked</p>}
                              </td>
                            );
                          })()}
                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-1">
                              <button type="button" title="View event details" aria-label={`View ${evt.title}`} onClick={() => openEventDetails(evt)} className="grid h-9 w-9 place-items-center rounded-md border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]">
                                <Eye size={15} />
                              </button>
                              {canCreateEvents && (
                                <button type="button" title="Edit event" aria-label={`Edit ${evt.title}`} onClick={() => openEditForm(evt)} className="grid h-9 w-9 place-items-center rounded-md border border-[#DDE7EF] text-slate-500 hover:bg-[#EEF6FB] hover:text-[#0B8ED0]">
                                  <Pencil size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <PaginationControls
                currentPage={eventsPage}
                totalItems={eventTotal}
                pageSize={eventPageSize}
                onPageChange={setEventsPage}
                onPageSizeChange={(size) => { setEventPageSize(size); setEventsPage(1); }}
                pageSizeOptions={[10, 25, 50]}
                label="events"
              />
            </div>
          )}
        </section>
      )}

      {activeTab === 'tasks' && (
        <section className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
            <div className="border-b border-[#DDE7EF] p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#E6F6FD] text-[#0B8ED0]"><List size={19} /></div>
                <div>
                  <h2 className="text-lg font-bold text-[#0F172A]">Build an Event To-do List</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Choose an event and describe what needs to happen. The AI will suggest a plan, due dates, and officers. You review everything before any task is created.</p>
                </div>
              </div>

              <div aria-label="Steps for creating an event to-do list" className="mt-5 grid overflow-hidden rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] md:grid-cols-3">
                {[
                  ['1', 'Choose an event', 'The event date, location, budget, and saved notes are included.'],
                  ['2', 'Describe what is needed', 'Mention setup, supplies, publicity, safety, reports, or special concerns.'],
                  ['3', 'Review and assign', 'Check every task and officer before saving the list.'],
                ].map(([step, title, detail], index) => (
                  <div key={title} className={`flex gap-3 p-4 ${index ? 'border-t border-[#DDE7EF] md:border-l md:border-t-0' : ''}`}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0B8ED0] text-xs font-black text-white">{step}</span>
                    <div><p className="text-xs font-black text-[#0F172A]">{title}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p></div>
                  </div>
                ))}
              </div>

              <form className="mt-5 grid gap-4 lg:grid-cols-[260px_1fr]" onSubmit={handleGeneratePlan}>
                <div>
                  <label htmlFor="planning-event" className="text-xs font-bold text-[#0F172A]">Event</label>
                  <select id="planning-event" value={planForm.event_id} onChange={(event) => selectPlanningEvent(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none transition focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20">
                    <option value="">Choose an event</option>
                    {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                  </select>
                  {selectedPlanningEvent && <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500"><Calendar size={13} className="mt-0.5 shrink-0 text-[#0B8ED0]" /> {formatDateTime(selectedPlanningEvent.start_time)}{selectedPlanningEvent.location ? ` at ${selectedPlanningEvent.location}` : ''}</p>}
                </div>
                <div>
                  <label htmlFor="planning-needs" className="text-xs font-bold text-[#0F172A]">What should the to-do list cover?</label>
                  <textarea id="planning-needs" rows={3} value={planForm.requirements} onChange={(event) => setPlanForm({ ...planForm, requirements: event.target.value })} placeholder="Example: registration, venue setup, publicity, equipment, safety checks, attendance, and the post-event report." className="mt-1.5 w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20" />
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] leading-5 text-slate-500">Include details the event record may not contain. Missing names, prices, and approvals will be marked for review instead of guessed.</p>
                    <button type="submit" disabled={planSubmitting || !planForm.event_id || !planForm.requirements.trim()} className="h-11 shrink-0 rounded-lg bg-[#0B8ED0] px-5 text-[13px] font-bold text-white transition hover:bg-[#0878B7] focus:outline-none focus:ring-2 focus:ring-[#16C7F3] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{planSubmitting ? 'Creating your to-do list…' : 'Create To-do List'}</button>
                  </div>
                </div>
              </form>

              {planError && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm font-bold text-red-700">We could not finish that action</p><p className="mt-1 text-xs leading-5 text-red-700">{planError}</p></div>}

              {workflowHistory.length > 0 && (
                <div className="mt-4 border-t border-[#DDE7EF] pt-4">
                  <p className="text-xs font-bold text-[#0F172A]">Previous drafts</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workflowHistory.map((output) => (
                      <button key={output.id} type="button" onClick={() => { setPlanResult(output.output_text || ''); if (output.decision_status === 'pending' && output.structured_output) { setWorkflowDraft(output.structured_output); setWorkflowOutputId(output.id); } else { setWorkflowDraft(null); setWorkflowOutputId(null); } }} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${output.id === workflowOutputId ? 'border-[#0B8ED0] bg-[#E6F6FD] text-[#0B8ED0]' : 'border-[#DDE7EF] bg-white text-slate-600 hover:border-[#B9DCEC] hover:bg-[#F8FBFD]'}`}>Draft {output.version} · {workflowStatusLabel[output.decision_status] || 'Status unavailable'}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {planResult && !workflowDraft && <div className="m-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-sm leading-6 text-slate-700 sm:m-5">{replaceIsoDateTimes(planResult)}</div>}

            {workflowDraft && (
              <div className="bg-[#F8FBFD] p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><p className="text-xs font-black uppercase tracking-wider text-[#0B8ED0]">Ready for your review</p><h3 className="mt-1 text-base font-bold text-[#0F172A]">{workflowDraft.tasks.length} suggested to-do item{workflowDraft.tasks.length === 1 ? '' : 's'}</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{replaceIsoDateTimes(workflowDraft.overview)}</p></div>
                  <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Nothing saved yet</span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ['Plan outline', workflowDraft.preparation_phases],
                    ['Key dates', workflowDraft.timeline],
                    ['What is needed', workflowDraft.resources],
                    ['Setup and coordination', workflowDraft.logistics],
                    ['Possible problems', [...(workflowDraft.risks || []), ...(workflowDraft.scheduling_conflicts || [])]],
                  ].map(([heading, items]) => (
                    <article key={heading} className="rounded-lg border border-[#DDE7EF] bg-white p-4"><h4 className="text-xs font-black text-[#0F172A]">{heading}</h4>{items?.length ? <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-slate-600">{items.map((item, itemIndex) => <li key={`${heading}-${itemIndex}`}>{replaceIsoDateTimes(item)}</li>)}</ul> : <p className="mt-2 text-xs text-slate-400">Nothing listed.</p>}</article>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-between gap-3">
                  <div><h3 className="text-sm font-bold text-[#0F172A]">To-do items</h3><p className="mt-0.5 text-xs text-slate-500">Review the order, due dates, and assigned officers.</p></div>
                  <button type="button" onClick={addWorkflowTask} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#0B8ED0] bg-white px-3 text-xs font-bold text-[#0B8ED0] transition hover:bg-[#E6F6FD]"><Plus size={15} /> Add to-do</button>
                </div>

                <div className="mt-3 space-y-4">
                  {workflowDraft.tasks.map((task, index) => {
                    const selectedOfficer = task.recommendation?.rankings?.find((ranking) => String(ranking.officer_id) === String(task.assigned_to));
                    const dueDateHint = task.phase === 'pre_event' ? `Choose a time before ${formatDateTime(selectedPlanningEvent?.start_time)}.` : task.phase === 'event_day' ? `Choose a time between ${formatDateTime(selectedPlanningEvent?.start_time)} and ${formatDateTime(selectedPlanningEvent?.end_time)}.` : `Choose a time after ${formatDateTime(selectedPlanningEvent?.end_time)}, within 30 days.`;
                    return (
                      <article key={task.key} className="rounded-lg border border-[#DDE7EF] bg-white p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3 border-b border-[#E5EDF3] pb-3">
                          <div className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6F6FD] text-xs font-black text-[#0B8ED0]">{index + 1}</span><div><p className="text-sm font-bold text-[#0F172A]">To-do {index + 1}</p><p className="mt-0.5 text-[11px] text-slate-500">{workflowPhaseLabel[task.phase] || 'Timing not selected'}</p></div></div>
                          <button type="button" aria-label={`Delete to-do ${index + 1}`} onClick={() => removeWorkflowTask(index)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"><X size={15} /></button>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div><label htmlFor={`workflow-title-${index}`} className="text-xs font-bold text-[#0F172A]">Task name</label><input id={`workflow-title-${index}`} aria-label={`Task ${index + 1} title`} value={task.title} onChange={(event) => updateWorkflowTask(index, 'title', event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm font-semibold outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20" /></div>
                          <div><label htmlFor={`workflow-deadline-${index}`} className="text-xs font-bold text-[#0F172A]">Due date and time</label><input id={`workflow-deadline-${index}`} aria-label={`Task ${index + 1} deadline`} type="datetime-local" value={isoToLocalDateTimeInput(task.deadline)} onChange={(event) => updateWorkflowTask(index, 'deadline', localDateTimeToIso(event.target.value))} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20" /><p className="mt-1 text-[11px] leading-5 text-slate-500">{dueDateHint}</p></div>
                          <div className="lg:col-span-2"><label htmlFor={`workflow-description-${index}`} className="text-xs font-bold text-[#0F172A]">What needs to be done?</label><textarea id={`workflow-description-${index}`} aria-label={`Task ${index + 1} description`} value={task.description || ''} onChange={(event) => updateWorkflowTask(index, 'description', event.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20" /></div>
                          <div><label htmlFor={`workflow-phase-${index}`} className="text-xs font-bold text-[#0F172A]">When should it happen?</label><select id={`workflow-phase-${index}`} aria-label={`Task ${index + 1} phase`} value={task.phase} onChange={(event) => updateWorkflowTask(index, 'phase', event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="pre_event">Before the event</option><option value="event_day">During the event</option><option value="post_event">After the event</option></select></div>
                          <div><label htmlFor={`workflow-priority-${index}`} className="text-xs font-bold text-[#0F172A]">Importance</label><select id={`workflow-priority-${index}`} aria-label={`Task ${index + 1} priority`} value={task.priority} onChange={(event) => updateWorkflowTask(index, 'priority', event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]">{['low', 'medium', 'high', 'critical'].map((value) => <option key={value} value={value}>{capitalize(value)}</option>)}</select></div>
                          <div><label htmlFor={`workflow-role-${index}`} className="text-xs font-bold text-[#0F172A]">Best officer role</label><input id={`workflow-role-${index}`} aria-label={`Task ${index + 1} recommended role`} value={task.recommended_role || ''} onChange={(event) => updateWorkflowTask(index, 'recommended_role', event.target.value)} placeholder="Example: Secretary" className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" /></div>
                          <div><label htmlFor={`workflow-order-${index}`} className="text-xs font-bold text-[#0F172A]">This can start after</label><select id={`workflow-order-${index}`} aria-label={`Task ${index + 1} dependency`} value={task.depends_on_key || ''} onChange={(event) => updateWorkflowTask(index, 'depends_on_key', event.target.value || null)} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="">It can start right away</option>{workflowDraft.tasks.slice(0, index).map((candidate, candidateIndex) => <option key={candidate.key} value={candidate.key}>{candidate.title || `To-do ${candidateIndex + 1}`}</option>)}</select></div>
                          <div className="lg:col-span-2"><label htmlFor={`workflow-officer-${index}`} className="text-xs font-bold text-[#0F172A]">Assign to</label><select id={`workflow-officer-${index}`} aria-label={`Task ${index + 1} officer`} value={task.assigned_to || ''} onChange={(event) => updateWorkflowTask(index, 'assigned_to', Number(event.target.value) || null)} className="mt-1.5 h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0]"><option value="">Let the system choose an eligible officer</option>{task.recommendation?.rankings?.map((ranking) => <option key={ranking.officer_id} value={ranking.officer_id}>{ranking.rank}. {ranking.name} — {ranking.position_title} — {scoreLabel(ranking.final_score)} overall match</option>)}</select>{!task.recommendation?.rankings?.length && <p className="mt-1 text-[11px] font-medium text-slate-500">The system will check for the best available officer when you save this task.</p>}</div>
                        </div>

                        {selectedOfficer && (
                          <div className="mt-4 rounded-lg border border-[#B9DCEC] bg-[#F5FBFE] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-[#0F172A]">Why {selectedOfficer.name} was suggested</p><span className="rounded-full bg-[#0B8ED0] px-2.5 py-1 text-[11px] font-bold text-white">{scoreLabel(selectedOfficer.final_score)} overall match</span></div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{[['Role match', selectedOfficer.role_score], ['Available workload', selectedOfficer.workload_score], ['Past task completion', selectedOfficer.performance_score]].map(([label, value]) => <div key={label} className="rounded-md border border-[#DDE7EF] bg-white px-3 py-2"><p className="text-[10px] font-semibold text-slate-500">{label}</p><p className="mt-0.5 text-xs font-black text-[#0F172A]">{scoreLabel(value)}</p></div>)}</div>
                            {Number.isFinite(Number(selectedOfficer.active_tasks)) && <p className="mt-2 text-[11px] leading-5 text-slate-600">This officer currently has {selectedOfficer.active_tasks} open task{Number(selectedOfficer.active_tasks) === 1 ? '' : 's'} out of a limit of {selectedOfficer.max_active_tasks}.</p>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-col gap-3 border-t border-[#DDE7EF] pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-slate-500">Saving will create {workflowDraft.tasks.length} task{workflowDraft.tasks.length === 1 ? '' : 's'} and notify the assigned officers.</p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" disabled={workflowAction} onClick={discardWorkflow} className="h-11 rounded-lg border border-red-200 bg-white px-4 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50">Remove Draft</button><button type="button" disabled={workflowAction || workflowDraft.tasks.length === 0} onClick={confirmWorkflow} className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-xs font-bold text-white transition hover:bg-[#0878B7] focus:outline-none focus:ring-2 focus:ring-[#16C7F3] focus:ring-offset-2 disabled:opacity-50">{workflowAction ? 'Saving and assigning…' : 'Save and Assign Tasks'}</button></div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#DDE7EF] bg-white shadow-sm">
          <div className="border-b border-[#DDE7EF] p-4 sm:p-5">
            <h2 className="text-lg font-bold text-[#0F172A]">Assigned Event Tasks</h2>
            <p className="mt-1 text-sm text-slate-500">See who is responsible, when each task is due, and whether it can begin.</p>
          </div>
          {loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : eventLinkedTasks.length === 0 ? (
            <div className="p-8 text-center"><p className="text-sm font-semibold text-slate-600">No event tasks yet</p><p className="mt-1 text-xs text-slate-400">Create and save a to-do list above to assign the first tasks.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left">
                <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Task</th>
                    <th className="px-5 py-3">Assigned Officer</th>
                    <th className="px-5 py-3">Event</th>
                    <th className="px-5 py-3">Due Date</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5EDF3] text-sm">
                  {pagedEventTasks.map((t) => (
                    <tr key={t.id} className="transition hover:bg-[#F8FBFD]">
                      <td className="max-w-[220px] truncate px-5 py-4 font-bold text-[#0F172A]">{t.title}</td>
                      <td className="max-w-[160px] truncate px-5 py-4 font-medium text-slate-600">
                        {t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '-'}
                      </td>
                      <td className="max-w-[160px] truncate px-5 py-4 font-medium text-slate-600">
                        {t.event?.title ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-600">{formatDateTime(t.deadline)}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${taskStatusBadge[t.workflow_status || t.status] || 'bg-slate-100 text-slate-500'}`}>
                          {capitalize(t.workflow_status || t.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PaginationControls
            currentPage={tasksPage}
            totalItems={eventLinkedTasks.length}
            pageSize={pageSize}
            onPageChange={setTasksPage}
            label="tasks"
          />
          </div>
        </section>
      )}

      {activeTab === 'attendance' && (
        <section aria-labelledby="attendance-workspace-title" className="space-y-4">
          <header className="overflow-hidden rounded-lg bg-[#0B1831] text-white shadow-sm">
            <div className="flex flex-col gap-5 px-5 py-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 flex items-center gap-2 text-[#16C7F3]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#16C7F3] opacity-50" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#16C7F3]" />
                  </span>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em]">Live attendance workspace</p>
                </div>
                <h2 id="attendance-workspace-title" className="text-2xl font-black sm:text-[28px]">
                  {isCheckInRoute ? 'Event Check-In' : 'Event Operations'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {isCheckInRoute
                    ? 'Choose an active event, verify your identity, and record your arrival.'
                    : 'Run the entry desk, monitor arrivals, and keep the attendance register accurate.'}
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-4 py-3">
                <CalendarCheck2 size={20} className="text-[#16C7F3]" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Available events</p>
                  <p className="mt-0.5 text-sm font-bold text-white">{attendanceEvents.length} {isCheckInRoute ? 'open for check-in' : 'in the operations queue'}</p>
                </div>
              </div>
            </div>
          </header>
          {loading ? (
            <div className="space-y-2 rounded-lg border border-[#DDE7EF] bg-white p-5">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : attendanceEvents.length === 0 ? (
            <div className="rounded-lg border border-[#DDE7EF] bg-white px-5 py-14 text-center shadow-sm">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><CalendarCheck2 size={24} /></span>
              <h3 className="mt-4 text-base font-bold text-[#0F172A]">No events ready for check-in</h3>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{canManageAttendance ? 'Approved and ongoing events will appear here. Completed events remain available from Event Operations.' : 'An event appears here only while its approved check-in window is open.'}</p>
            </div>
          ) : (
            <div className="grid min-h-[560px] overflow-hidden rounded-lg border border-[#DDE7EF] bg-white shadow-sm xl:grid-cols-[310px_minmax(0,1fr)]">
              {/* Left panel - event list */}
              <div className={`border-[#DDE7EF] bg-[#F8FBFD] xl:flex xl:min-h-[560px] xl:flex-col xl:border-r ${selectedAttEventId ? 'hidden' : 'flex min-h-[440px] flex-col'}`}>
                <div className="border-b border-[#DDE7EF] bg-white px-4 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0B8ED0]">Event queue</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">Select where attendance is being recorded.</p>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {attendanceEvents.map((evt) => (
                    <button
                      key={evt.id}
                      type="button"
                      aria-label={`Open attendance for ${evt.title}`}
                      onClick={() => handleSelectAttEvent(evt.id)}
                      className={`group flex w-full items-start gap-3 rounded-lg border px-3.5 py-3.5 text-left transition focus:outline-none focus:ring-2 focus:ring-[#16C7F3]/40 ${selectedAttEventId === evt.id ? 'border-[#0B8ED0] bg-[#EEF6FB] shadow-sm' : 'border-transparent bg-white hover:border-[#B9D9E9]'}`}
                    >
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${evt.status === 'ongoing' ? 'bg-emerald-500 ring-4 ring-emerald-100' : evt.status === 'completed' ? 'bg-slate-400' : 'bg-[#0B8ED0]'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-[#0F172A]">{evt.title}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Clock size={12} /> {formatDateTime(evt.start_time)}</p>
                        {evt.location && <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-400"><MapPin size={12} /> {evt.location}</p>}
                      </div>
                      <ChevronRight size={16} className={`mt-1 shrink-0 transition ${selectedAttEventId === evt.id ? 'text-[#0B8ED0]' : 'text-slate-300 group-hover:text-[#0B8ED0]'}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Right panel - detail */}
              <div className={`min-w-0 flex-col ${selectedAttEventId ? 'flex' : 'hidden xl:flex'}`}>
                {!selectedAttEventId ? (
                  <div className="flex flex-1 items-center justify-center p-10 text-center">
                    <div>
                      <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><UserRoundCheck size={26} /></span>
                      <p className="mt-4 text-sm font-bold text-[#0F172A]">Choose an event to begin</p>
                      <p className="mt-1 text-xs text-slate-500">Live controls and attendance records will appear here.</p>
                    </div>
                  </div>
                ) : attendanceLoading ? (
                  <div className="space-y-2 p-5">
                    {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
                  </div>
                ) : (
                  <>
                    {/* Mobile back button */}
                    <div className="flex items-center border-b border-[#DDE7EF] p-4 xl:hidden">
                      <button
                        type="button"
                        onClick={() => setSelectedAttEventId(null)}
                        className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B8ED0]"
                      >
                        <ChevronLeft size={16} />
                        All Events
                      </button>
                    </div>

                    {/* Event command header */}
                    <div className="border-b border-[#DDE7EF] px-4 py-5 sm:px-6">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusBadge[attendanceEvent?.status] || 'bg-slate-100 text-slate-600'}`}>{statusLabel[attendanceEvent?.status] || capitalize(attendanceEvent?.status)}</span>
                            {attendanceEvent?.status === 'ongoing' && <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live now</span>}
                          </div>
                          <h3 className="mt-2 truncate text-lg font-black text-[#0F172A] sm:text-xl">{attendanceEvent?.title ?? '-'}</h3>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
                            <span className="inline-flex items-center gap-1.5"><Clock size={13} className="text-[#0B8ED0]" />{formatDateTime(attendanceEvent?.start_time)}</span>
                            {attendanceEvent?.location && <span className="inline-flex items-center gap-1.5"><MapPin size={13} className="text-[#0B8ED0]" />{attendanceEvent.location}</span>}
                          </div>
                        </div>
                        <button type="button" onClick={() => setAttendanceReload((value) => value + 1)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#DDE7EF] bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-[#B9D9E9] hover:bg-[#F8FBFD] focus:outline-none focus:ring-2 focus:ring-[#16C7F3]/40">
                          <Clock size={14} /> Refresh live data
                        </button>
                      </div>

                      <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] lg:grid-cols-4">
                        {[
                          ['Currently inside', currentlyInside, 'Not checked out'],
                          ['Attendance records', attendanceCount, 'Total arrivals'],
                          ['Late', attendanceData?.summary?.late ?? 0, 'After start'],
                          ['Check-in rate', attendanceRate === null ? '—' : `${attendanceRate}%`, expectedAttendance > 0 ? `of ${expectedAttendance} expected` : 'No target set'],
                        ].map(([label, value, helper], index) => (
                          <div key={label} className={`px-4 py-3.5 ${index % 2 ? 'border-l border-[#DDE7EF]' : ''} ${index > 1 ? 'border-t border-[#DDE7EF] lg:border-t-0' : ''} ${index > 0 ? 'lg:border-l' : ''}`}>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                            <p className="mt-1 text-xl font-black text-[#0F172A]">{value}</p>
                            <p className="mt-0.5 text-[10px] font-medium text-slate-500">{helper}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Check-in form - officer only */}
                    {canManageAttendance && ['approved', 'ongoing'].includes(attendanceData?.event?.status) ? (
                      <div className="border-b border-[#DDE7EF] px-4 py-5 sm:px-6">
                        <div className="mb-4">
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0B8ED0]">Door controls</p>
                          <h4 className="mt-1 text-base font-bold text-[#0F172A]">Record an arrival</h4>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Use the fingerprint reader for the fastest entry, or look up a member for a manual record.</p>
                        </div>
                        <div className="grid items-stretch gap-4 lg:grid-cols-2">
                          <BiometricCheckIn
                            eventId={selectedAttEventId}
                            users={allUsers}
                            academicStructure={attendanceAcademicStructure}
                            academicStructureError={attendanceAcademicStructureError}
                            department={attendanceAcademicStructure?.department || currentUser.department || currentUser.organization?.college || allUsers.find((user) => user.department)?.department || ''}
                            onRecorded={async () => setAttendanceReload((value) => value + 1)}
                          />
                          <div className="relative flex flex-col rounded-lg border border-[#DDE7EF] bg-white p-4 sm:p-5">
                            <div className="mb-4 flex items-start gap-3">
                              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><Search size={18} /></span>
                              <div><p className="text-[13px] font-bold text-[#0F172A]">Manual check-in</p><p className="mt-0.5 text-xs font-medium leading-5 text-slate-500">Find the member by name or School ID, then confirm their attendance status.</p></div>
                            </div>
                            <label htmlFor="attendance-member-search" className="text-xs font-bold text-[#0F172A]">Member</label>
                            <div className="relative mt-1.5">
                              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              <input
                                id="attendance-member-search"
                                value={checkInSearch}
                                onChange={(e) => { setCheckInSearch(e.target.value); setCheckInUserId(null); setCheckInSuccess(null); }}
                                type="text"
                                autoComplete="off"
                                placeholder="Search name or School ID"
                                className="h-11 w-full rounded-lg border border-[#DDE7EF] pl-8 pr-3 text-[13px] outline-none transition placeholder:text-slate-400 focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20"
                              />
                              {checkInSearch.trim() !== '' && !checkInUserId && filteredCheckInUsers.length > 0 && (
                              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-56 overflow-y-auto rounded-lg border border-[#DDE7EF] bg-white shadow-xl">
                                {filteredCheckInUsers.map((u) => (
                                  <button
                                    key={u.school_id ?? u.id}
                                    type="button"
                                    onClick={() => {
                                      setCheckInUserId(u.school_id ?? u.id);
                                      setCheckInSearch(`${u.first_name} ${u.last_name} (${u.school_id})`);
                                    }}
                                    className="flex w-full items-center gap-3 border-b border-[#E5EDF3] px-3 py-2.5 text-left transition last:border-b-0 hover:bg-[#EEF6FB]"
                                  >
                                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0B8ED0] text-[10px] font-black text-white">{u.first_name?.[0]}{u.last_name?.[0]}</span>
                                    <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-[#0F172A]">{u.first_name} {u.last_name}</span><span className="block text-[11px] font-medium text-slate-400">{u.school_id} · {capitalize(u.role)}</span></span>
                                  </button>
                                ))}
                              </div>
                              )}
                            </div>
                            {checkInSearch.trim() !== '' && !checkInUserId && filteredCheckInUsers.length === 0 && <p className="mt-2 text-xs font-medium text-slate-400">No matching members found.</p>}
                            <label htmlFor="attendance-status" className="mt-3 text-xs font-bold text-[#0F172A]">Attendance status</label>
                            <select id="attendance-status" value={checkInStatus} onChange={(event) => setCheckInStatus(event.target.value)} className="mt-1.5 h-11 rounded-lg border border-[#DDE7EF] bg-white px-3 text-[13px] font-semibold text-[#0F172A] outline-none transition focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20">
                              <option value="present">Present</option>
                              <option value="late">Late</option>
                              <option value="excused">Excused</option>
                              <option value="absent">Absent</option>
                            </select>
                            {checkInError && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{checkInError}</p>}
                            {checkInSuccess && <p role="status" className="mt-2 text-xs font-semibold text-emerald-600">{checkInSuccess}</p>}
                            <button type="button" onClick={handleCheckIn} disabled={!checkInUserId || checkInSubmitting} className="mt-auto flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0B8ED0] px-4 text-[13px] font-bold text-white transition hover:bg-[#0878B7] focus:outline-none focus:ring-2 focus:ring-[#16C7F3] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
                              <UserCheck size={15} /> {checkInSubmitting ? 'Recording...' : 'Confirm Check-In'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : canManageAttendance ? (
                      <div className="flex items-start gap-3 border-b border-[#DDE7EF] bg-slate-50 px-5 py-4 text-sm font-medium text-slate-600">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-slate-500"><CheckCircle2 size={18} /></span>
                        <div><p className="font-bold text-[#0F172A]">Check-in is closed</p><p className="mt-0.5 text-xs leading-5">This event no longer accepts attendance records. The final register remains available below.</p></div>
                      </div>
                    ) : null}

                    {/* Attendees table */}
                    {(attendanceData?.records?.length ?? 0) === 0 ? (
                      <div className="px-5 py-12 text-center">
                        <span className="mx-auto grid h-11 w-11 place-items-center rounded-lg bg-slate-100 text-slate-400"><Users size={21} /></span>
                        <p className="mt-3 text-sm font-bold text-[#0F172A]">No attendance records yet</p>
                        <p className="mt-1 text-xs text-slate-500">New arrivals will appear here after check-in.</p>
                      </div>
                    ) : (
                      <div>
                        <div className="border-b border-[#DDE7EF] bg-[#F8FBFD] p-4 sm:p-5">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0B8ED0]">Attendance log</p><p className="mt-1 text-xs font-medium text-slate-500">Search, review, and export recorded arrivals.</p></div>
                            <span className="shrink-0 rounded-full border border-[#DDE7EF] bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">{attendanceMeta.total} matching</span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                            <label className="relative"><span className="sr-only">Search attendance</span><Search size={14} className="absolute left-3 top-3 text-slate-400" /><input value={attendanceSearch} onChange={(event) => setAttendanceSearch(event.target.value)} placeholder="Search attendee or academic profile" className="h-10 w-full rounded-lg border border-[#DDE7EF] bg-white pl-8 pr-3 text-xs outline-none transition focus:border-[#0B8ED0] focus:ring-2 focus:ring-[#16C7F3]/20" /></label>
                            <select aria-label="Filter attendance status" value={attendanceStatusFilter} onChange={(event) => setAttendanceStatusFilter(event.target.value)} className="h-10 rounded-lg border border-[#DDE7EF] bg-white px-3 text-xs font-semibold outline-none focus:border-[#0B8ED0]"><option value="all">All statuses</option>{['present', 'late', 'excused', 'absent'].map((status) => <option key={status} value={status}>{capitalize(status)}</option>)}</select>
                            {canManageAttendance && <button type="button" onClick={exportAttendance} disabled={!filteredAttendanceRecords.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#0B8ED0] bg-white px-3 text-xs font-bold text-[#0B8ED0] transition hover:bg-[#EEF6FB] disabled:opacity-50"><Download size={14} /> Export CSV</button>}
                          </div>
                        </div>
                        <div className="divide-y divide-[#E5EDF3] lg:hidden">
                          {pagedAttendanceRecords.map((rec) => (
                            <article key={rec.id} className="p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0"><p className="truncate text-[13px] font-bold text-[#0F172A]">{rec.user ? `${rec.user.first_name} ${rec.user.last_name}` : '-'}</p><p className="mt-0.5 text-[11px] font-medium text-slate-500">School ID {rec.user?.school_id ?? '-'}</p></div>
                                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${attendanceStatusBadge[rec.status] || attendanceStatusBadge.present}`}>{capitalize(rec.status || 'present')}</span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-[#F8FBFD] p-3 text-[11px]">
                                <div><p className="font-bold uppercase tracking-wide text-slate-400">Check-in</p><p className="mt-1 font-semibold text-slate-700">{formatDateTime(rec.check_in_time)}</p></div>
                                <div><p className="font-bold uppercase tracking-wide text-slate-400">Method</p><p className="mt-1 font-semibold text-slate-700">{capitalize(rec.method)}</p></div>
                              </div>
                              <p className="mt-3 text-[11px] leading-5 text-slate-500">{[rec.user?.program, rec.user?.major, rec.user?.year_level, rec.user?.section].filter(Boolean).join(' · ') || 'No academic profile provided'}</p>
                            </article>
                          ))}
                          {!filteredAttendanceRecords.length && <p className="px-5 py-10 text-center text-sm text-slate-400">No attendance records match the filters.</p>}
                        </div>
                        <div className="hidden overflow-x-auto lg:block">
                        <table className="w-full min-w-[980px] text-left">
                          <thead className="bg-[#F8FBFD] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <tr>
                              <th className="px-5 py-3">Member</th>
                              <th className="px-5 py-3">School ID</th>
                              <th className="px-5 py-3">Academic Profile</th>
                              <th className="px-5 py-3">Method</th>
                              <th className="px-5 py-3">Status</th>
                              <th className="px-5 py-3">Check In / Out</th>
                              <th className="px-5 py-3">Recorded By</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E5EDF3] text-sm">
                            {pagedAttendanceRecords.map((rec) => (
                              <tr key={rec.id} className="transition hover:bg-[#F8FBFD]">
                                <td className="px-5 py-3.5 font-bold text-[#0F172A]">
                                  {rec.user ? `${rec.user.first_name} ${rec.user.last_name}` : '-'}
                                </td>
                                <td className="px-5 py-3.5 font-medium text-slate-600">{rec.user?.school_id ?? '-'}</td>
                                <td className="px-5 py-3.5 text-xs text-slate-600"><p className="font-semibold text-slate-700">{[rec.user?.program, rec.user?.major].filter(Boolean).join(' · ') || '-'}</p><p>{[rec.user?.year_level, rec.user?.section, rec.user?.department].filter(Boolean).join(' · ') || '-'}</p></td>
                                <td className="px-5 py-3.5">
                                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${rec.method === 'biometric' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                    {capitalize(rec.method)}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${attendanceStatusBadge[rec.status] || attendanceStatusBadge.present}`}>{capitalize(rec.status || 'present')}</span>
                                </td>
                                <td className="px-5 py-3.5 text-xs font-medium text-slate-600"><p>{formatDateTime(rec.check_in_time)}</p><p className="text-[10px] text-slate-400">Out: {formatDateTime(rec.check_out_time)}</p></td>
                                <td className="px-5 py-3.5 text-xs text-slate-600"><p className="font-semibold">{rec.recorder ? `${rec.recorder.first_name} ${rec.recorder.last_name}` : '-'}</p><p className="text-[10px]">{rec.recorder?.position_title || rec.recorder?.role || '-'}</p></td>
                              </tr>
                            ))}
                            {!filteredAttendanceRecords.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">No attendance records match the filters.</td></tr>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[selectedEvent.status] || 'bg-slate-100 text-slate-600'}`}>{statusLabel[selectedEvent.status] || capitalize(selectedEvent.status)}</span>
                <h2 className="mt-3 text-xl font-extrabold text-[#0F172A]">{selectedEvent.title}</h2>
              </div>
              <button type="button" aria-label="Close event details" onClick={closeEventDetails} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            {detailsLoading ? (
              <div className="mt-5 h-28 animate-pulse rounded-lg bg-slate-100" />
            ) : (
              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <p><span className="font-bold text-[#0F172A]">Schedule:</span> {formatDateTime(selectedEvent.start_time)} to {formatDateTime(selectedEvent.end_time)}</p>
                <p><span className="font-bold text-[#0F172A]">Location:</span> {selectedEvent.location || 'Not specified'}</p>
                <p><span className="font-bold text-[#0F172A]">Event type:</span> {selectedEvent.planning_details?.event_type || 'Not specified'}</p>
                <p><span className="font-bold text-[#0F172A]">Expected participants:</span> {selectedEvent.planning_details?.expected_participants || 'Not specified'}</p>
                <p className="whitespace-pre-wrap"><span className="font-bold text-[#0F172A]">Description:</span> {selectedEvent.description || 'No description provided.'}</p>
                <div className="grid gap-3 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Attendance Summary</p>
                    <p className="mt-1 font-bold text-[#0F172A]">{selectedEvent.attendance_records_count ?? 0} recorded</p>
                    {selectedEvent.attendance_summary && (
                      <p className="mt-1 text-xs text-slate-500">
                        Present {selectedEvent.attendance_summary.present ?? 0} · Late {selectedEvent.attendance_summary.late ?? 0} · Excused {selectedEvent.attendance_summary.excused ?? 0} · Absent {selectedEvent.attendance_summary.absent ?? 0}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Approval Status</p>
                    <p className="mt-1 font-bold text-[#0F172A]">{capitalize(selectedEvent.approval_status || selectedEvent.status)}</p>
                  </div>
                </div>
                {(selectedEvent.planning_details?.requirements || selectedEvent.planning_details?.resources || selectedEvent.planning_details?.budget_notes || selectedEvent.planning_details?.vendor_deadlines || selectedEvent.planning_details?.logistics_checklist) && (
                  <div className="space-y-2 rounded-lg border border-[#DDE7EF] p-4">
                    <p className="font-bold text-[#0F172A]">Planning Details</p>
                    {selectedEvent.planning_details?.requirements && <p className="whitespace-pre-wrap"><span className="font-semibold">Requirements:</span> {selectedEvent.planning_details.requirements}</p>}
                    {selectedEvent.planning_details?.resources && <p className="whitespace-pre-wrap"><span className="font-semibold">Resources:</span> {selectedEvent.planning_details.resources}</p>}
                    {selectedEvent.planning_details?.budget_notes && <p className="whitespace-pre-wrap"><span className="font-semibold">Budget requirements:</span> {selectedEvent.planning_details.budget_notes}</p>}
                    {selectedEvent.planning_details?.vendor_deadlines && <p className="whitespace-pre-wrap"><span className="font-semibold">Vendor deadlines:</span> {selectedEvent.planning_details.vendor_deadlines}</p>}
                    {selectedEvent.planning_details?.logistics_checklist && <p className="whitespace-pre-wrap"><span className="font-semibold">Logistics checklist:</span> {selectedEvent.planning_details.logistics_checklist}</p>}
                  </div>
                )}
                {canCreateEvents && (
                  <div className="rounded-lg border border-[#DDE7EF] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 font-bold text-[#0F172A]"><Wallet size={16} /> Linked Budget Status</p>
                        <p className="mt-1 text-xs text-slate-500">Only budgets explicitly linked to this event are included.</p>
                      </div>
                      <button type="button" onClick={() => navigate('/dashboard/finance/budget-allocation')} className="rounded-lg border border-[#DDE7EF] px-3 py-2 text-xs font-bold text-[#0B8ED0] hover:bg-[#EEF6FB]">
                        Manage Budgets
                      </button>
                    </div>
                    {selectedEvent.financial_summary && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          ['Allocated', selectedEvent.financial_summary.allocated_budget],
                          ['Spent', selectedEvent.financial_summary.spent],
                          ['Income', selectedEvent.financial_summary.income],
                          ['Remaining', selectedEvent.financial_summary.remaining_budget],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg bg-[#F8FBFD] p-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                            <p className="mt-1 text-xs font-black text-[#0F172A]">{formatCurrency(value)}</p>
                          </div>
                        ))}
                        <div className="col-span-2 rounded-lg bg-[#F8FBFD] p-2.5 sm:col-span-4">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Financial Risk / Latest Organization Forecast</p>
                          <p className="mt-1 text-xs font-bold text-[#0F172A]">Risk: {capitalize(selectedEvent.financial_summary.risk)}</p>
                          {selectedEvent.financial_summary.latest_forecast ? (
                            <p className="mt-1 text-xs text-slate-500">{selectedEvent.financial_summary.latest_forecast.forecast_period}: projected income {formatCurrency(selectedEvent.financial_summary.latest_forecast.predicted_income)}, expense {formatCurrency(selectedEvent.financial_summary.latest_forecast.predicted_expense)}, balance {formatCurrency(selectedEvent.financial_summary.latest_forecast.predicted_balance)}</p>
                          ) : <p className="mt-1 text-xs text-slate-500">No OLS forecast has been generated yet.</p>}
                        </div>
                      </div>
                    )}
                    {selectedEvent.budgets?.length ? (
                      <div className="mt-3 space-y-2">
                        {selectedEvent.budgets.map((budget) => (
                          <div key={budget.id} className="rounded-lg bg-[#F8FBFD] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-bold text-[#0F172A]">{budget.title}</p>
                              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${budgetStatusBadge[budget.approval_status] || budgetStatusBadge.pending}`}>
                                {capitalize(budget.approval_status || 'pending')}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Allocated {formatCurrency(budget.allocated_amount)} · Spent {formatCurrency(budget.spent_amount)} · Income {formatCurrency(budget.income_amount)} · Remaining {formatCurrency(budget.remaining_amount)} · {budget.transactions_count ?? 0} transaction(s)</p>
                            {budget.advice_generated_at && <p className="mt-1 text-xs text-slate-500">Advisory risk: {capitalize(budget.overspending_risk || 'not analyzed')} · Safe spending {formatCurrency(budget.safe_spending_limit)}</p>}
                            {budget.approval_remarks && <p className="mt-1 text-xs text-red-600">Remarks: {budget.approval_remarks}</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={`mt-3 rounded-lg p-3 text-xs font-semibold ${selectedEvent.requires_budget ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500'}`}>
                        {selectedEvent.requires_budget ? 'This event requires funding, but no budget allocation is linked yet.' : 'This event does not require a budget allocation.'}
                      </p>
                    )}
                  </div>
                )}
                {canCreateEvents && (allowedStatusTransitions[selectedEvent.status]?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-[#DDE7EF] p-4">
                    <p className="font-bold text-[#0F172A]">Update Event Status</p>
                    <p className="mt-1 text-xs text-slate-500">Approval can only be granted through the approval workflow.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {allowedStatusTransitions[selectedEvent.status].map((status) => (
                        <button key={status} type="button" disabled={statusUpdating} onClick={() => handleStatusUpdate(status)} className="rounded-lg bg-[#0B8ED0] px-3 py-2 text-xs font-bold text-white hover:bg-[#0878B7] disabled:opacity-50">
                          {statusUpdating ? 'Updating...' : `Mark ${capitalize(status)}`}
                        </button>
                      ))}
                    </div>
                    {statusError && <p className="mt-2 text-xs text-red-600">{statusError}</p>}
                  </div>
                )}
                {selectedEvent.approval_remarks && <p className="rounded-lg bg-red-50 p-3 text-red-700"><span className="font-bold">Approval remarks:</span> {selectedEvent.approval_remarks}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1831]/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0F172A]">{editingEventId ? 'Edit Event' : 'Create Event'}</h2>
              <button type="button" aria-label="Close event form" onClick={() => { setShowForm(false); setEditingEventId(null); }} className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-[#EEF6FB]"><X size={18} /></button>
            </div>
            <form className="space-y-4" onSubmit={handleSaveEvent}>
              <div className="space-y-1.5">
                <label htmlFor="event-title" className="text-[13px] font-semibold text-[#0F172A]">Event Name *</label>
                <input
                  id="event-title"
                  type="text"
                  value={form.title}
                  maxLength={255}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Annual General Assembly"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="event-type" className="text-[13px] font-semibold text-[#0F172A]">Event Type</label>
                  <input id="event-type" type="text" maxLength={100} value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} placeholder="e.g. General Assembly" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="event-participants" className="text-[13px] font-semibold text-[#0F172A]">Expected Participants</label>
                  <input id="event-participants" type="number" min="1" max="1000000" value={form.expected_participants} onChange={(e) => setForm({ ...form, expected_participants: e.target.value })} placeholder="e.g. 250" className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="event-start-date" className="text-[13px] font-semibold text-[#0F172A]">Start Date *</label>
                  <input
                    id="event-start-date"
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="event-start-time" className="text-[13px] font-semibold text-[#0F172A]">Start Time *</label>
                  <input
                    id="event-start-time"
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="event-end-date" className="text-[13px] font-semibold text-[#0F172A]">End Date</label>
                  <input
                    id="event-end-date"
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="event-end-time" className="text-[13px] font-semibold text-[#0F172A]">End Time</label>
                  <input
                    id="event-end-time"
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0]"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-location" className="text-[13px] font-semibold text-[#0F172A]">Location</label>
                <input
                  id="event-location"
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Main Auditorium"
                  className="h-11 w-full rounded-lg border border-[#DDE7EF] px-3 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-description" className="text-[13px] font-semibold text-[#0F172A]">Description</label>
                <textarea
                  id="event-description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-requirements" className="text-[13px] font-semibold text-[#0F172A]">Planning Requirements</label>
                <textarea id="event-requirements" rows={2} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} placeholder="Program, safety, registration, approvals, accessibility..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-resources" className="text-[13px] font-semibold text-[#0F172A]">Available / Required Resources</label>
                <textarea id="event-resources" rows={2} value={form.resources} onChange={(e) => setForm({ ...form, resources: e.target.value })} placeholder="Rooms, equipment, volunteers, suppliers, materials..." className="w-full resize-none rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-image" className="text-[13px] font-semibold text-[#0F172A]">Event poster <span className="font-normal text-slate-400">(optional)</span></label>
                <label htmlFor="event-image" className="flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#B9CBD8] bg-[#F8FBFD] p-3 hover:border-[#0B8ED0]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EEF6FB] text-[#0B8ED0]"><ImagePlus size={18} /></span>
                  <span className="min-w-0"><span className="block truncate text-xs font-bold text-[#0F172A]">{form.imageFile?.name || (editingEventId ? 'Choose a replacement poster' : 'Choose an image')}</span><span className="block text-[10px] text-slate-500">JPEG, PNG or WebP · up to 5 MB</span></span>
                </label>
                <input id="event-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setForm({ ...form, imageFile: event.target.files?.[0] || null })} />
              </div>
              <label className="flex items-center gap-2 text-[13px] font-semibold text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={form.requires_budget}
                  onChange={(e) => setForm({ ...form, requires_budget: e.target.checked })}
                  className="h-4 w-4 rounded border-[#DDE7EF]"
                />
                Requires budget allocation
              </label>
              {form.requires_budget && (
                <div className="grid grid-cols-1 gap-4 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="event-proposed-budget" className="text-[13px] font-semibold text-[#0F172A]">Proposed Budget</label>
                    <input id="event-proposed-budget" type="number" min="0.01" step="0.01" disabled={Boolean(editingEventId && form.proposed_budget_id)} value={form.proposed_budget_amount} onChange={(e) => setForm({ ...form, proposed_budget_amount: e.target.value })} placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0] disabled:bg-slate-100" />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="event-budget-threshold" className="text-[13px] font-semibold text-[#0F172A]">Warning Threshold</label>
                    <input id="event-budget-threshold" type="number" min="0" step="0.01" disabled={Boolean(editingEventId && form.proposed_budget_id)} value={form.budget_warning_threshold} onChange={(e) => setForm({ ...form, budget_warning_threshold: e.target.value })} placeholder="0.00" className="h-11 w-full rounded-lg border border-[#DDE7EF] bg-white px-3 text-sm outline-none focus:border-[#0B8ED0] disabled:bg-slate-100" />
                  </div>
                  <p className="text-xs font-medium text-[#0878B7] sm:col-span-2">
                    {editingEventId && form.proposed_budget_id ? 'This proposal is already linked. Change approved budget values from Finance so its approval history is preserved.' : 'Entering an amount creates a linked proposed budget and a separate Super Admin approval request.'}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="event-budget-notes" className="text-[13px] font-semibold text-[#0F172A]">Budget Requirements / Notes</label>
                <textarea
                  id="event-budget-notes"
                  rows={2}
                  value={form.budget_notes}
                  onChange={(e) => setForm({ ...form, budget_notes: e.target.value })}
                  placeholder="Expected expenses or funding notes..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              {form.requires_budget && !form.proposed_budget_amount && (
                <p className="rounded-lg bg-[#EEF6FB] p-3 text-xs font-medium text-[#0878B7]">
                  These notes describe the event's funding needs. The actual allocation is proposed and linked to this event in Finance → Budget Allocation.
                </p>
              )}
              <div className="space-y-1.5">
                <label htmlFor="event-vendor-deadlines" className="text-[13px] font-semibold text-[#0F172A]">Vendor Deadlines</label>
                <textarea
                  id="event-vendor-deadlines"
                  rows={2}
                  value={form.vendor_deadlines}
                  onChange={(e) => setForm({ ...form, vendor_deadlines: e.target.value })}
                  placeholder="Supplier, payment, or delivery deadlines..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-logistics-checklist" className="text-[13px] font-semibold text-[#0F172A]">Logistics Checklist</label>
                <textarea
                  id="event-logistics-checklist"
                  rows={2}
                  value={form.logistics_checklist}
                  onChange={(e) => setForm({ ...form, logistics_checklist: e.target.value })}
                  placeholder="Venue setup, materials, registration, documentation..."
                  className="w-full rounded-lg border border-[#DDE7EF] px-3 py-2.5 text-sm outline-none focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 resize-none"
                />
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditingEventId(null); }} className="h-11 rounded-lg border border-[#DDE7EF] px-5 text-sm font-bold text-slate-600 hover:bg-[#F8FBFD]">Cancel</button>
                <button
                  type="submit"
                  disabled={formSubmitting || !form.title.trim() || !form.date || !form.startTime || !form.endDate || !form.endTime || (form.requires_budget && !form.budget_notes.trim())}
                  className="h-11 rounded-lg bg-[#0B8ED0] px-5 text-sm font-bold text-white hover:bg-[#0878B7] transition disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : editingEventId ? 'Save Changes' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
