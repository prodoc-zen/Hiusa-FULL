import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, DataTable, EmptyState, Field, Input, PageHeader, Select, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import TableRowActions from '../../../components/TableRowActions';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { manilaDateStamp } from '../../../utils/dateTime';
import { getApiErrorMessage } from '../../../utils/apiError';
import { activateAcademicSemester, closeAcademicSemester, closeAcademicYear, createAcademicSemester, createAcademicYear, deleteAcademicSemester, deleteAcademicYear, getAcademicYears, makeAcademicYearCurrent, reopenAcademicSemester, updateAcademicSemesterDates, updateAcademicYear } from '../../../services/systemAdministrationService';

const EMPTY_FORM = { label: '', starts_on: '', ends_on: '' };
const EMPTY_SEMESTER = { number: '1', starts_on: '', ends_on: '' };
const SEMESTER_CHANGE_TITLES = { activate: 'Activate semester', close: 'Close semester', reopen: 'Reopen semester' };

const YEAR_START_STEPS = [
  { label: "Publish this year's accreditation requirements", to: '/dashboard/super-admin/compliance' },
  { label: 'Open a clearance period for the semester', to: '/dashboard/super-admin/clearances' },
];

function semesterLabel(semester, yearLabel) {
  return `${semester.number === 1 ? '1st' : '2nd'} semester, AY ${yearLabel}`;
}

function semesterChangeMessage({ semester, action, yearLabel }, years) {
  if (action === 'reopen') return `This makes ${semesterLabel(semester, yearLabel)} the active semester and AY ${yearLabel} the current year again. Members see its data again. Close it again when it is over.`;
  if (action === 'close') return `Closing this semester ends it. Members stop seeing its data, and the app has no active semester until the next one is activated. ${afterClosingNotice(semester, years)} You can reopen it from this page while no other semester is active and its academic year is not completed.`;
  const closing = years
    .flatMap((year) => (year.semesters || []).map((item) => ({ semester: item, yearLabel: year.label })))
    .find((item) => item.semester.status === 'active');
  // Activating into another year completes the current one for good, whether or not a semester is active now.
  const currentYear = years.find((year) => year.is_current);
  const completesYear = currentYear && currentYear.label !== yearLabel ? ` This also completes AY ${currentYear.label}. A completed year cannot be reopened.` : '';
  if (!closing) return `This semester becomes the active one.${completesYear || ' You can close it from this page when it is over.'}`;
  const closingLabel = semesterLabel(closing.semester, closing.yearLabel);
  return `This closes the current semester, ${closingLabel}. Members stop seeing its data.${completesYear || ` You can reopen ${closingLabel} from this page after the new one is closed.`}`;
}

function semesterName(semester, yearLabel) {
  return `${semester.number === 1 ? '1st' : '2nd'} semester of AY ${yearLabel}`;
}

function liveSemester(years) {
  return years
    .flatMap((year) => (year.semesters || []).map((semester) => ({ semester, yearLabel: year.label })))
    .find((item) => item.semester.status === 'active');
}

// The server's reasons for refusing Activate, as the one thing to do first. Empty when it would accept.
function activateBlocker(semester, year, years) {
  if (year.closed_at) return `AY ${year.label} is completed, so its semesters cannot be activated.`;
  if (!hasStarted(semester)) return `Starts on ${manilaDate(semester.starts_on, 'long')}. Change its dates or activate it from that day.`;
  const current = years.find((item) => item.is_current);
  if (!current || current.id === year.id) return '';
  const own = current.semesters || [];
  if (own.length === 2 && own.every((item) => item.status !== 'upcoming')) return '';
  if (String(year.starts_on).slice(0, 10) < String(current.starts_on).slice(0, 10)) {
    const live = liveSemester(years);
    return live ? `Close the ${semesterName(live.semester, live.yearLabel)} first.` : `Make AY ${year.label} the current year first.`;
  }
  if (own.length === 0) return `Add both semesters to AY ${current.label} and complete them first.`;
  if (own.length === 1) return `Add the ${own[0].number === 1 ? '2nd' : '1st'} semester to AY ${current.label} and complete both first.`;
  const upcoming = [...own].sort((left, right) => left.number - right.number).find((item) => item.status === 'upcoming');
  return `Activate the ${semesterName(upcoming, current.label)} first.`;
}

function reopenBlocker(years) {
  const live = liveSemester(years);
  return live ? `Close the ${semesterName(live.semester, live.yearLabel)} first.` : '';
}

// The server refuses this while a semester in another year is active.
function makeCurrentBlocker(target, years) {
  const active = years.find((year) => (year.semesters || []).some((item) => item.status === 'active'));
  return active && active.id !== target.id ? active : null;
}

// The day a year's first semester begins, or the year itself when it has no semester yet.
function firstDay(year) {
  const starts = (year.semesters || []).map((item) => String(item.starts_on).slice(0, 10)).sort();
  return starts[0] || String(year.starts_on).slice(0, 10);
}

function makeCurrentMessage(target, years) {
  const active = makeCurrentBlocker(target, years);
  const base = "Accreditation status will count this year's requirements, and new requirement sets and clearance periods will default to it. This does not start a semester.";
  if (active) return `${base} A semester in AY ${active.label} is active, so this is refused. Close it first, or activate a semester in this year to make it current.`;
  const replaced = years.find((year) => year.is_current && year.id !== target.id);
  if (firstDay(target) > manilaDateStamp()) {
    return `${base} No semester can be activated in AY ${target.label} until ${manilaDate(firstDay(target), 'long')}.${replaced ? ` AY ${replaced.label} stops being the current year.` : ''}`;
  }
  return base;
}

// After the current year changes with no semester running, the one line that says how to get back.
function wayBackLine(years) {
  const current = years.find((year) => year.is_current);
  if (!current || liveSemester(years)) return '';
  const lastCompleted = years
    .filter((year) => !year.closed_at)
    .flatMap((year) => (year.semesters || []).filter((item) => item.status === 'completed').map((item) => ({ semester: item, yearLabel: year.label })))
    .sort((left, right) => String(right.semester.ends_on).localeCompare(String(left.semester.ends_on)))[0];
  const previous = years
    .filter((year) => !year.is_current && !year.closed_at && String(year.starts_on) < String(current.starts_on))
    .sort((left, right) => String(right.starts_on).localeCompare(String(left.starts_on)))[0];
  const ways = [];
  if (lastCompleted) ways.push(`reopen the ${semesterName(lastCompleted.semester, lastCompleted.yearLabel)}`);
  if (previous) ways.push(`make AY ${previous.label} the current year again`);
  return ways.length ? `No semester is active. To go back, ${ways.join(', or ')}.` : '';
}

const ELECTION_STATUS = { upcoming: 'Upcoming', active: 'Open now' };

// The server's refusal when elections are still running: each one named, with the organization that can cancel it.
function ElectionRefusal({ message, elections }) {
  if (!elections.length) return message;
  return (
    <>
      <span className="block">{`${elections.length === 1 ? 'This election is' : 'These elections are'} still upcoming or open. Each organization Admin can cancel its election, or you can wait for it to close.`}</span>
      {elections.map((election) => (
        <span key={election.id} className="mt-1 block font-medium">
          {`${ELECTION_STATUS[election.status] || election.status}: ${election.title}, `}
          {election.organization_id ? <Link to={`/dashboard/super-admin/organizations/${election.organization_id}`} className="underline">{election.organization_name}</Link> : 'no organization'}
        </span>
      ))}
    </>
  );
}

function hasStarted(semester) {
  return String(semester.starts_on).slice(0, 10) <= manilaDateStamp();
}

// Closing the live semester leaves no semester active until the next one can start, so the box says when that is.
function afterClosingNotice(closing, years) {
  const next = years
    .flatMap((year) => (year.semesters || []).map((item) => ({ semester: item, yearLabel: year.label })))
    .filter((item) => item.semester.id !== closing.id && item.semester.status !== 'completed')
    .sort((left, right) => String(left.semester.starts_on).localeCompare(String(right.semester.starts_on)))[0];
  if (!next) return 'No other semester is set up, so no semester will be active until you add one and activate it.';
  if (!hasStarted(next.semester)) return `${semesterLabel(next.semester, next.yearLabel)} starts on ${manilaDate(next.semester.starts_on, 'long')}. Until then no semester is active.`;
  return `You can activate ${semesterLabel(next.semester, next.yearLabel)} afterwards.`;
}

function suggestedLabel(startsOn) {
  const year = Number(String(startsOn).slice(0, 4));
  return year ? `${year}-${year + 1}` : '';
}

/**
 * The SAO's academic calendar: one current year that accreditation is
 * measured against, and that new requirement sets and clearance periods use.
 */
export default function AcademicYearsPage() {
  const [years, setYears] = useState({ loading: true, error: '', items: [] });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [currentTarget, setCurrentTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [closeYearTarget, setCloseYearTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [semesterYear, setSemesterYear] = useState(null);
  const [semesterForm, setSemesterForm] = useState(EMPTY_SEMESTER);
  const [semesterErrors, setSemesterErrors] = useState({});
  const [semesterDeleteTarget, setSemesterDeleteTarget] = useState(null);
  const [semesterDeleteError, setSemesterDeleteError] = useState(null);
  const [yearDeleteError, setYearDeleteError] = useState('');
  const [semesterChange, setSemesterChange] = useState(null);
  const [datesTarget, setDatesTarget] = useState(null);
  const [datesForm, setDatesForm] = useState({ starts_on: '', ends_on: '' });
  const [semesterChangeError, setSemesterChangeError] = useState('');
  const [semesterChangeElections, setSemesterChangeElections] = useState([]);

  const load = useCallback(async () => {
    setYears((current) => ({ ...current, loading: true, error: '' }));
    try {
      const items = await getAcademicYears();
      setYears({ loading: false, error: '', items });
    } catch (cause) {
      setYears({ loading: false, error: getApiErrorMessage(cause, 'The academic calendar could not load.'), items: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = years.items.find((year) => year.is_current);
  const wayBack = wayBackLine(years.items);

  function openModal(year = null) {
    setFieldErrors({});
    setForm(year ? { label: year.label, starts_on: year.starts_on, ends_on: year.ends_on } : EMPTY_FORM);
    setModal(year ? { mode: 'edit', year } : { mode: 'create' });
  }

  function openDates(semester, yearLabel) {
    setSemesterErrors({});
    setDatesForm({ starts_on: String(semester.starts_on).slice(0, 10), ends_on: String(semester.ends_on).slice(0, 10) });
    setDatesTarget({ semester, yearLabel });
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});
    try {
      if (modal.mode === 'edit') {
        await updateAcademicYear(modal.year.id, form);
        notify.success(`${form.label} updated`);
      } else {
        const created = await createAcademicYear(form);
        notify.success(created.is_current ? `${created.label} is now the current academic year` : `${created.label} added to the calendar`);
      }
      setModal(null);
      await load();
    } catch (cause) {
      setFieldErrors(cause?.response?.data?.errors || {});
      if (!cause?.response?.data?.errors) notify.error(getApiErrorMessage(cause, 'The academic year was not saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmCurrent() {
    setBusy(true);
    try {
      await makeAcademicYearCurrent(currentTarget.id);
      notify.success(`${currentTarget.label} is now the current academic year`, { description: 'Accreditation status now counts this year\'s requirements.' });
      setCurrentTarget(null);
      await load();
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'The current year was not changed.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setYearDeleteError('');
    try {
      await deleteAcademicYear(deleteTarget.id);
      notify.success(`${deleteTarget.label} removed`);
      setDeleteTarget(null);
      await load();
    } catch (cause) {
      setYearDeleteError(getApiErrorMessage(cause, 'The academic year was not removed.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCloseYear() {
    setBusy(true);
    try {
      await closeAcademicYear(closeYearTarget.id);
      notify.success(`AY ${closeYearTarget.label} completed`);
      setCloseYearTarget(null);
      await load();
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'The academic year could not be closed.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveSemester() {
    setBusy(true);
    setSemesterErrors({});
    try {
      await createAcademicSemester(semesterYear.id, { ...semesterForm, number: Number(semesterForm.number) });
      notify.success('Semester added', { description: 'All default requirements for organizations, renewals, events, and semestral reports are active for this semester.' });
      setSemesterYear(null);
      setSemesterForm(EMPTY_SEMESTER);
      await load();
    } catch (cause) {
      setSemesterErrors(cause?.response?.data?.errors || {});
      if (!cause?.response?.data?.errors) notify.error(getApiErrorMessage(cause, 'The semester was not saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDates() {
    setBusy(true);
    setSemesterErrors({});
    try {
      await updateAcademicSemesterDates(datesTarget.semester.id, datesForm);
      notify.success('Semester dates changed');
      setDatesTarget(null);
      await load();
    } catch (cause) {
      setSemesterErrors(cause?.response?.data?.errors || {});
      if (!cause?.response?.data?.errors) notify.error(getApiErrorMessage(cause, 'The semester dates were not saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSemesterChange() {
    const { semester, action, yearLabel } = semesterChange;
    setBusy(true);
    setSemesterChangeError('');
    setSemesterChangeElections([]);
    try {
      if (action === 'activate') await activateAcademicSemester(semester.id);
      else if (action === 'reopen') await reopenAcademicSemester(semester.id);
      else await closeAcademicSemester(semester.id, semesterLabel(semester, yearLabel));
      notify.success({ activate: 'Academic semester activated', reopen: 'Academic semester reopened', close: 'Academic semester completed' }[action]);
      setSemesterChange(null);
      await load();
    } catch (cause) {
      setSemesterChangeError(getApiErrorMessage(cause, 'The semester could not be changed.'));
      setSemesterChangeElections(cause?.response?.data?.elections || []);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSemesterDelete() {
    setBusy(true);
    setSemesterDeleteError(null);
    try {
      await deleteAcademicSemester(semesterDeleteTarget.id);
      notify.success('Semester removed');
      setSemesterDeleteTarget(null);
      await load();
    } catch (cause) {
      setSemesterDeleteError({ message: getApiErrorMessage(cause, 'The semester was not removed.'), reasons: cause?.response?.data?.reasons || [] });
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'label', header: 'Academic year', render: (year) => <span className="font-medium text-ink">{year.label}</span> },
    { key: 'dates', header: 'Dates', render: (year) => `${manilaDate(year.starts_on, 'long')} to ${manilaDate(year.ends_on, 'long')}` },
    { key: 'status', header: 'Status', render: (year) => (year.is_current ? <StatusBadge tone="success" label="Current" /> : (year.closed_at ? <span className="text-sm text-ink-muted">Completed</span> : null)) },
  ];

  return (
    <div className="space-y-6 pb-8">
      <PageHeader primary={years.items.length > 0 && <Button leftIcon={Plus} onClick={() => openModal()}>Add academic year</Button>} />

      {current && (
        <section aria-label="Current academic year">
          <h2 className="text-base font-semibold text-ink">{`${current.label} is the current year`}</h2>
          <p className="mt-1 text-sm text-ink-muted">{`${manilaDate(current.starts_on, 'long')} to ${manilaDate(current.ends_on, 'long')}`}</p>
          {wayBack && <p className="mt-1 text-sm text-ink-muted">{wayBack}</p>}
          <p className="mt-4 text-xs font-medium text-ink-muted">At the start of each year</p>
          <ul className="mt-1 divide-y divide-line-soft border-y border-line-soft">
            {YEAR_START_STEPS.map((step) => (
              <li key={step.to}>
                <Link to={step.to} className="flex min-h-11 items-center rounded-control px-1 text-sm font-medium text-brand-700 transition-colors duration-150 hover:bg-subtle hover:underline">
                  {step.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!years.loading && !years.error && years.items.length > 0 && !current && (
        <p role="status" className="text-sm text-ink-muted">No academic year is current. Choose Make current on a year in the calendar, or add one.</p>
      )}

      <Card title="Calendar">
        <DataTable
          caption="Academic years"
          columns={columns}
          rows={years.items}
          loading={years.loading}
          error={years.error}
          onRetry={load}
          stickyHeader={false}
          actions={(year) => (
            <TableRowActions subject={year.label} actions={[
              !year.is_current && !year.closed_at && { label: 'Make current', onClick: () => setCurrentTarget(year) },
              year.is_current && year.semesters?.length === 2 && year.semesters.every((semester) => semester.status === 'completed') && { label: 'Close year', onClick: () => setCloseYearTarget(year) },
              { label: 'Edit', onClick: () => openModal(year) },
              year.can_be_removed && { label: `Remove ${year.label}`, icon: Trash2, danger: true, onClick: () => { setYearDeleteError(''); setDeleteTarget(year); } },
            ]} />
          )}
          emptyState={(
            <EmptyState
              kind="first-run"
              title="No academic year set"
              description="Add the current academic year. Until then, accreditation follows the newest set of requirements."
              action={<Button leftIcon={Plus} onClick={() => openModal()}>Add academic year</Button>}
            />
          )}
        />

        {years.items.length > 0 && (
          <div className="mt-6 border-t border-line pt-5">
            <h2 className="text-base font-semibold text-ink">Semesters</h2>
            <p className="mt-1 text-sm text-ink-muted">Activating a semester completes the one that is active.</p>
            {years.items.map((year) => <div key={year.id} className="mt-4 first:mt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">AY {year.label}</h3>
                {(year.semesters || []).length < 2 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={Plus}
                    className="max-md:min-h-[42px]"
                    onClick={() => {
                      setSemesterYear(year);
                      setSemesterErrors({});
                      setSemesterForm({
                        ...EMPTY_SEMESTER,
                        number: year.semesters?.some((item) => item.number === 1) ? '2' : '1',
                      });
                    }}
                  >
                    Add semester
                  </Button>
                )}
              </div>
              {!year.can_be_removed && year.removal_blocker && <p className="mt-0.5 text-xs text-ink-muted">{year.removal_blocker}</p>}
              <div className="mt-1 divide-y divide-line-soft">{(year.semesters || []).map((semester) => {
                const blocker = semester.status === 'completed' ? reopenBlocker(years.items) : (semester.status === 'active' ? '' : activateBlocker(semester, year, years.items));
                const datesBeside = semester.status === 'upcoming' && !year.closed_at && !hasStarted(semester);
                return <div key={semester.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"><span className="text-sm font-medium text-ink">{semester.number === 1 ? '1st' : '2nd'} semester</span><span className="text-xs text-ink-muted">{manilaDate(semester.starts_on, 'long')} to {manilaDate(semester.ends_on, 'long')}</span></div>
                <div className="flex items-center gap-2">
                  {semester.status === 'active' && <StatusBadge label="Active" tone="success" />}
                  {semester.status === 'completed' && <StatusBadge label="Completed" tone="neutral" />}
                  {semester.status === 'completed' && !year.closed_at && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Reopen ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      aria-describedby={blocker ? `semester-note-${semester.id}` : undefined}
                      disabled={busy || Boolean(blocker)}
                      onClick={() => { setSemesterChangeError(''); setSemesterChange({ semester, action: 'reopen', yearLabel: year.label }); }}
                    >
                      Reopen
                    </Button>
                  )}
                  {semester.status === 'active' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Close ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      disabled={busy}
                      onClick={() => { setSemesterChangeError(''); setSemesterChange({ semester, action: 'close', yearLabel: year.label }); }}
                    >
                      Close semester
                    </Button>
                  )}
                  {semester.status === 'upcoming' && !datesBeside && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Edit dates of ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      disabled={busy}
                      onClick={() => openDates(semester, year.label)}
                    >
                      Edit dates
                    </Button>
                  )}
                  {semester.status !== 'active' && semester.status !== 'completed' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Activate ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      aria-describedby={blocker ? `semester-note-${semester.id}` : undefined}
                      disabled={busy || Boolean(blocker)}
                      onClick={() => { setSemesterChangeError(''); setSemesterChange({ semester, action: 'activate', yearLabel: year.label }); }}
                    >
                      Activate
                    </Button>
                  )}
                  {semester.status !== 'active' && (
                    <button
                      type="button"
                      aria-label={`Delete ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      title={`Delete ${semester.number === 1 ? '1st' : '2nd'} semester`}
                      disabled={busy}
                      onClick={() => { setSemesterDeleteError(null); setSemesterDeleteTarget({ ...semester, yearLabel: year.label }); }}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-control border border-line text-danger-strong transition-colors duration-150 hover:bg-danger-tint disabled:opacity-50 sm:h-9 sm:w-9"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {blocker && (
                  <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1">
                    <p id={`semester-note-${semester.id}`} className="text-xs text-ink-muted">{blocker}</p>
                    {datesBeside && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="max-md:min-h-[42px]"
                        aria-label={`Edit dates of ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                        disabled={busy}
                        onClick={() => openDates(semester, year.label)}
                      >
                        Edit dates
                      </Button>
                    )}
                  </div>
                )}
              </div>;
              })}{!year.semesters?.length && <p className="py-2.5 text-sm text-ink-muted">No semesters added.</p>}</div>
            </div>)}
          </div>
        )}
      </Card>

      <Modal open={Boolean(semesterYear)} title={`Add semester to AY ${semesterYear?.label || ''}`} onClose={busy ? undefined : () => setSemesterYear(null)} maxWidth="max-w-lg" footer={<><Button variant="secondary" disabled={busy} onClick={() => setSemesterYear(null)}>Cancel</Button><Button loading={busy} disabled={!semesterForm.starts_on || !semesterForm.ends_on} onClick={saveSemester}>Add semester</Button></>}>
        <div className="space-y-4">
          <Field label="Semester" required error={semesterErrors.number?.[0]}><Select value={semesterForm.number} onChange={(event) => setSemesterForm((current) => ({ ...current, number: event.target.value }))}><option value="1">1st semester</option><option value="2">2nd semester</option></Select></Field>
          <Field label="Starts on" required error={semesterErrors.starts_on?.[0]}><Input type="date" value={semesterForm.starts_on} onChange={(event) => setSemesterForm((current) => ({ ...current, starts_on: event.target.value }))} /></Field>
          <Field label="Ends on" required error={semesterErrors.ends_on?.[0]}><Input type="date" value={semesterForm.ends_on} onChange={(event) => setSemesterForm((current) => ({ ...current, ends_on: event.target.value }))} /></Field>
        </div>
      </Modal>

      <Modal open={Boolean(datesTarget)} title={datesTarget ? `Edit dates of the ${semesterLabel(datesTarget.semester, datesTarget.yearLabel)}` : ''} onClose={busy ? undefined : () => setDatesTarget(null)} maxWidth="max-w-lg" footer={<><Button variant="secondary" disabled={busy} onClick={() => setDatesTarget(null)}>Cancel</Button><Button loading={busy} disabled={!datesForm.starts_on || !datesForm.ends_on} onClick={saveDates}>Save dates</Button></>}>
        <div className="space-y-4">
          <Field label="Starts on" required error={semesterErrors.starts_on?.[0]}><Input type="date" value={datesForm.starts_on} onChange={(event) => setDatesForm((current) => ({ ...current, starts_on: event.target.value }))} /></Field>
          <Field label="Ends on" required error={semesterErrors.ends_on?.[0]}><Input type="date" value={datesForm.ends_on} onChange={(event) => setDatesForm((current) => ({ ...current, ends_on: event.target.value }))} /></Field>
          {semesterErrors.semester?.[0] && <p role="alert" className="text-sm font-semibold text-danger-strong">{semesterErrors.semester[0]}</p>}
        </div>
      </Modal>

      <Modal
        open={Boolean(modal)}
        title={modal?.mode === 'edit' ? `Edit ${modal.year.label}` : 'Add academic year'}
        description={modal?.mode === 'edit' ? undefined : 'The first year you add becomes the current one.'}
        onClose={saving ? undefined : () => setModal(null)}
        closeOnEscape={!saving}
        maxWidth="max-w-lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!form.label || !form.starts_on || !form.ends_on}>{modal?.mode === 'edit' ? 'Save changes' : 'Add academic year'}</Button>
          </>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts on" required error={fieldErrors.starts_on?.[0]}>
            <Input
              type="date"
              value={form.starts_on}
              onChange={(event) => setForm((current) => ({ ...current, starts_on: event.target.value, label: (current.label || modal?.mode === 'edit') ? current.label : suggestedLabel(event.target.value) }))}
            />
          </Field>
          <Field label="Ends on" required error={fieldErrors.ends_on?.[0]}>
            <Input type="date" value={form.ends_on} onChange={(event) => setForm((current) => ({ ...current, ends_on: event.target.value }))} />
          </Field>
          <Field label="Label" required hint="Two consecutive years, like 2026-2027." error={fieldErrors.label?.[0]} className="sm:col-span-2">
            <Input value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="2026-2027" />
          </Field>
        </div>
      </Modal>

      {currentTarget && makeCurrentBlocker(currentTarget, years.items) ? (
        <Modal
          open
          title="Make this the current year"
          description={makeCurrentMessage(currentTarget, years.items)}
          onClose={busy ? undefined : () => setCurrentTarget(null)}
          closeOnBackdrop={false}
          maxWidth="max-w-md"
          footer={(
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setCurrentTarget(null)}>Cancel</Button>
              <Button disabled>Make current</Button>
            </>
          )}
        >
          <p className="text-sm font-semibold text-ink">{currentTarget.label}</p>
        </Modal>
      ) : (
        <ConfirmModal
          open={Boolean(currentTarget)}
          title="Make this the current year"
          message={currentTarget ? makeCurrentMessage(currentTarget, years.items) : undefined}
          recordName={currentTarget?.label}
          confirmText="Make current"
          variant="primary"
          busy={busy}
          onCancel={() => !busy && setCurrentTarget(null)}
          onConfirm={confirmCurrent}
        />
      )}
      <ConfirmModal
        open={Boolean(closeYearTarget)}
        title="Complete academic year"
        message="Both semesters will remain available as historical records. A completed year cannot be reopened. Activate a semester in a new year to resume current operations."
        recordName={closeYearTarget?.label}
        confirmText="Close year"
        variant="primary"
        busy={busy}
        onCancel={() => !busy && setCloseYearTarget(null)}
        onConfirm={confirmCloseYear}
      />
      <ConfirmModal
        open={Boolean(semesterChange)}
        title={SEMESTER_CHANGE_TITLES[semesterChange?.action]}
        message={semesterChange ? semesterChangeMessage(semesterChange, years.items) : undefined}
        recordName={semesterChange ? semesterLabel(semesterChange.semester, semesterChange.yearLabel) : undefined}
        confirmText={SEMESTER_CHANGE_TITLES[semesterChange?.action]}
        confirmationText={semesterChange?.action === 'close' ? semesterLabel(semesterChange.semester, semesterChange.yearLabel) : undefined}
        variant="primary"
        busy={busy}
        error={semesterChangeError && <ElectionRefusal message={semesterChangeError} elections={semesterChangeElections} />}
        onCancel={() => !busy && setSemesterChange(null)}
        onConfirm={confirmSemesterChange}
      />
      <ConfirmModal
        open={Boolean(semesterDeleteTarget)}
        title="Delete semester"
        message="The semester is removed from the calendar. This cannot be undone. A semester that already has events, tasks or requirements attached cannot be deleted."
        recordName={semesterDeleteTarget ? `${semesterDeleteTarget.number === 1 ? '1st' : '2nd'} semester, AY ${semesterDeleteTarget.yearLabel}` : undefined}
        confirmText="Delete semester"
        busy={busy}
        error={semesterDeleteError && (
          <>
            <p>{semesterDeleteError.message}</p>
            {semesterDeleteError.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 font-medium">{semesterDeleteError.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          </>
        )}
        onCancel={() => !busy && setSemesterDeleteTarget(null)}
        onConfirm={confirmSemesterDelete}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove academic year"
        message={`The academic year and any semesters that never started are removed from the calendar, along with their requirement lists. This cannot be undone. A year with a semester that has started, or with requirements or clearance periods of its own, cannot be removed.${deleteTarget?.is_current ? ' No academic year will be current afterwards.' : ''}`}
        recordName={deleteTarget?.label}
        confirmText="Remove year"
        busy={busy}
        error={yearDeleteError}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
