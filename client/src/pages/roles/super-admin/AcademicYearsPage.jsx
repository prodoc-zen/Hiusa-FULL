import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, DataTable, EmptyState, Field, IconButton, Input, PageHeader, StatusBadge } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { getApiErrorMessage } from '../../../utils/apiError';
import { createAcademicYear, deleteAcademicYear, getAcademicYears, makeAcademicYearCurrent, updateAcademicYear } from '../../../services/systemAdministrationService';

const EMPTY_FORM = { label: '', starts_on: '', ends_on: '' };

const YEAR_START_STEPS = [
  { label: "Publish this year's accreditation requirements", to: '/dashboard/super-admin/compliance' },
  { label: 'Hand over administrator roles after elections', to: '/dashboard/super-admin/admins' },
  { label: 'Open a clearance period for the semester', to: '/dashboard/super-admin/clearances' },
];

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
  const [busy, setBusy] = useState(false);

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
    try {
      await deleteAcademicYear(deleteTarget.id);
      notify.success(`${deleteTarget.label} removed`);
      setDeleteTarget(null);
      await load();
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'The academic year was not removed.'));
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'label', header: 'Academic year', render: (year) => <span className="font-bold text-ink">{year.label}</span> },
    { key: 'dates', header: 'Dates', render: (year) => `${manilaDate(year.starts_on, 'long')} to ${manilaDate(year.ends_on, 'long')}` },
    { key: 'status', header: 'Status', render: (year) => (year.is_current ? <StatusBadge tone="info" label="Current" /> : <span className="text-xs font-medium text-ink-muted">Not current</span>) },
  ];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Academic years" description="Set the current academic year. Accreditation is measured against its requirements, and new requirement sets and clearance periods use it." />

      {current && (
        <Card title={`${current.label} is the current year`} description={`${manilaDate(current.starts_on, 'long')} to ${manilaDate(current.ends_on, 'long')}`}>
          <p className="text-sm font-semibold text-ink">At the start of each year</p>
          <ul className="mt-2 divide-y divide-line-soft">
            {YEAR_START_STEPS.map((step) => (
              <li key={step.to}>
                <Link to={step.to} className="-mx-2 flex items-center justify-between gap-3 rounded-control px-2 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-subtle">
                  {step.label}
                  <ChevronRight size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Calendar" description="Exactly one year is current at a time." actions={<Button leftIcon={Plus} onClick={() => openModal()}>Add academic year</Button>}>
        <DataTable
          columns={columns}
          rows={years.items}
          loading={years.loading}
          error={years.error}
          onRetry={load}
          actions={(year) => (
            <div className="flex justify-end gap-1.5">
              {!year.is_current && <Button size="sm" variant="secondary" onClick={() => setCurrentTarget(year)}>Make current</Button>}
              <Button size="sm" variant="secondary" onClick={() => openModal(year)}>Edit</Button>
              {!year.is_current && <IconButton icon={Trash2} label={`Remove ${year.label}`} variant="danger" onClick={() => setDeleteTarget(year)} />}
            </div>
          )}
          emptyState={(
            <EmptyState
              kind="first-run"
              icon={CalendarRange}
              title="No academic year set"
              description="Add the current academic year. Until then, accreditation follows the newest set of requirements."
              action={<Button leftIcon={Plus} onClick={() => openModal()}>Add academic year</Button>}
            />
          )}
        />
      </Card>

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
        message="Accreditation status will count this year's requirements, and new requirement sets and clearance periods will default to it."
        recordName={currentTarget?.label}
        confirmText="Make current"
        variant="primary"
        busy={busy}
        onCancel={() => !busy && setCurrentTarget(null)}
        onConfirm={confirmCurrent}
      />
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Remove academic year"
        message="Years that already label requirements or clearance periods stay on the calendar."
        recordName={deleteTarget?.label}
        confirmText="Remove year"
        busy={busy}
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
