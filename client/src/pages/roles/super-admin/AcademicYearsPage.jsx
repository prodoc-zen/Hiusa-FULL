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
import { activateAcademicSemester, closeAcademicSemester, closeAcademicYear, createAcademicSemester, createAcademicYear, deleteAcademicSemester, deleteAcademicYear, getAcademicYears, makeAcademicYearCurrent, reopenAcademicSemester, updateAcademicYear } from '../../../services/systemAdministrationService';

const EMPTY_FORM = { label: '', starts_on: '', ends_on: '' };
const EMPTY_SEMESTER = { number: '1', starts_on: '', ends_on: '' };
const SEMESTER_CHANGE_TITLES = { activate: 'Activate semester', close: 'Close semester', reopen: 'Reopen semester' };

const YEAR_START_STEPS = [
  { label: "Publish this year's accreditation requirements", to: '/dashboard/super-admin/compliance' },
  { label: "Review each organization's administrators after elections: add the new ones, remove the old ones", to: '/dashboard/super-admin/admins' },
  { label: 'Open a clearance period for the semester', to: '/dashboard/super-admin/clearances' },
];

function semesterLabel(semester, yearLabel) {
  return `${semester.number === 1 ? '1st' : '2nd'} semester, AY ${yearLabel}`;
}

function semesterChangeMessage({ semester, action, yearLabel }, years) {
  if (action === 'reopen') return `This makes ${semesterLabel(semester, yearLabel)} the active semester and AY ${yearLabel} the current year again. Members see its data again. Close it again when it is over.`;
  if (action === 'close') return `Closing this semester ends it. Members stop seeing its data, and the app has no active semester until the next one is activated. ${afterClosingNotice(semester, years)} You can reopen it from this page only while no other semester is active.`;
  const closing = years
    .flatMap((year) => (year.semesters || []).map((item) => ({ semester: item, yearLabel: year.label })))
    .find((item) => item.semester.status === 'active');
  if (!closing) return 'This semester becomes the active one. This cannot be undone from the app.';
  return `This closes the current semester, ${semesterLabel(closing.semester, closing.yearLabel)}. Members stop seeing its data. This cannot be undone from the app.`;
}

function makeCurrentMessage(target, years) {
  const active = years.find((year) => (year.semesters || []).some((item) => item.status === 'active'));
  const base = "Accreditation status will count this year's requirements, and new requirement sets and clearance periods will default to it. This does not start a semester.";
  if (active && active.id !== target.id) return `${base} A semester in AY ${active.label} is active, so this is refused until you activate a semester in this year.`;
  return base;
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
  const [semesterChangeError, setSemesterChangeError] = useState('');

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
  const anyActive = years.items.some((year) => (year.semesters || []).some((semester) => semester.status === 'active'));

  function openModal(year = null) {
    setFieldErrors({});
    setForm(year ? { label: year.label, starts_on: year.starts_on, ends_on: year.ends_on } : EMPTY_FORM);
    setModal(year ? { mode: 'edit', year } : { mode: 'create' });
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

  async function confirmSemesterChange() {
    const { semester, action, yearLabel } = semesterChange;
    setBusy(true);
    setSemesterChangeError('');
    try {
      if (action === 'activate') await activateAcademicSemester(semester.id);
      else if (action === 'reopen') await reopenAcademicSemester(semester.id);
      else await closeAcademicSemester(semester.id, semesterLabel(semester, yearLabel));
      notify.success({ activate: 'Academic semester activated', reopen: 'Academic semester reopened', close: 'Academic semester completed' }[action]);
      setSemesterChange(null);
      await load();
    } catch (cause) {
      setSemesterChangeError(getApiErrorMessage(cause, 'The semester could not be changed.'));
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
              !year.is_current && { label: `Remove ${year.label}`, icon: Trash2, danger: true, onClick: () => { setYearDeleteError(''); setDeleteTarget(year); } },
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
              <div className="mt-1 divide-y divide-line-soft">{(year.semesters || []).map((semester) => <div key={semester.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"><span className="text-sm font-medium text-ink">{semester.number === 1 ? '1st' : '2nd'} semester</span><span className="text-xs text-ink-muted">{manilaDate(semester.starts_on, 'long')} to {manilaDate(semester.ends_on, 'long')}</span></div>
                <div className="flex items-center gap-2">
                  {semester.status === 'active' && <StatusBadge label="Active" tone="success" />}
                  {semester.status === 'completed' && <StatusBadge label="Completed" tone="neutral" />}
                  {semester.status === 'completed' && !anyActive && !year.closed_at && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Reopen ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      disabled={busy}
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
                  {semester.status !== 'active' && semester.status !== 'completed' && (hasStarted(semester) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Activate ${semester.number === 1 ? '1st' : '2nd'} semester of AY ${year.label}`}
                      disabled={busy}
                      onClick={() => { setSemesterChangeError(''); setSemesterChange({ semester, action: 'activate', yearLabel: year.label }); }}
                    >
                      Activate
                    </Button>
                  ) : <span className="text-xs text-ink-muted">Not started yet</span>)}
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
              </div>)}{!year.semesters?.length && <p className="py-2.5 text-sm text-ink-muted">No semesters added.</p>}</div>
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
        error={semesterChangeError}
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
        message="The academic year is removed from the calendar. This cannot be undone. A year that already has semesters, requirements or clearance periods cannot be removed."
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
