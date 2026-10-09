import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input } from '../../../components/ui';
import Modal from '../../../components/Modal';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getAcademicYears } from '../../../services/systemAdministrationService';
import {
  createRequirementType,
  deleteRequirementType,
  getRequirementTypes,
  updateRequirementType,
} from '../../../services/complianceService';

const EMPTY_TYPE_FORM = { academic_year: '', name: '', description: '', deadline_at: '', is_active: true };

export default function RequirementsTab({ currentAcademicYear, onChanged }) {
  const [types, setTypes] = useState({ loading: true, error: null, items: [] });
  const [typeModal, setTypeModal] = useState(null);
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE_FORM);
  const [academicYears, setAcademicYears] = useState([]);
  const [typeFormError, setTypeFormError] = useState(null);
  const [typeSaving, setTypeSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const loadTypes = useCallback(() => {
    setTypes((current) => ({ ...current, loading: true, error: null }));
    getRequirementTypes({ per_page: 100 })
      .then((response) => setTypes({ loading: false, error: null, items: unwrapList(response.data) }))
      .catch((err) => setTypes((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load requirement types.') })));
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);
  useEffect(() => { getAcademicYears().then(setAcademicYears).catch(() => setAcademicYears([])); }, []);

  function openTypeModal(type = null) {
    setTypeFormError(null);
    setTypeModal({ mode: type ? 'edit' : 'create', type });
    setTypeForm(type ? {
      academic_year: type.academic_year || '',
      name: type.name || '',
      description: type.description || '',
      deadline_at: String(type.deadline_at || '').slice(0, 10),
      is_active: type.is_active !== false,
    } : { ...EMPTY_TYPE_FORM, academic_year: currentAcademicYear || '' });
  }

  async function handleTypeSubmit(event) {
    event.preventDefault();
    if (!typeForm.academic_year.trim() || !typeForm.name.trim() || !typeForm.deadline_at) {
      setTypeFormError('Complete the academic year, name, and deadline before saving.');
      return;
    }

    setTypeSaving(true);
    setTypeFormError(null);
    const payload = {
      academic_year: typeForm.academic_year.trim(),
      name: typeForm.name.trim(),
      description: typeForm.description.trim() || null,
      deadline_at: typeForm.deadline_at,
      is_active: typeForm.is_active,
    };

    try {
      if (typeModal.mode === 'edit') {
        await updateRequirementType(typeModal.type.id, payload);
        notify.success('Requirement updated.');
      } else {
        await createRequirementType(payload);
        notify.success('Requirement added. Every active organization has been notified.');
      }
      setTypeModal(null);
      loadTypes();
      onChanged();
    } catch (err) {
      setTypeFormError(getApiErrorMessage(err, 'Could not save this requirement.'));
    } finally {
      setTypeSaving(false);
    }
  }

  async function toggleTypeActive(type) {
    try {
      await updateRequirementType(type.id, { is_active: !type.is_active });
      notify.success(type.is_active ? `"${type.name}" marked inactive.` : `"${type.name}" marked active.`);
      loadTypes();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Could not update this requirement.'));
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteRequirementType(deleteTarget.id);
      notify.success(`"${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      loadTypes();
      onChanged();
    } catch (err) {
      setDeleteTarget(null);
      setDeleteError(getApiErrorMessage(err, 'Could not delete this requirement.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Requirement', render: (type) => <span className="font-bold text-ink">{formatDisplayText(type.name)}</span> },
    { key: 'academic_year', header: 'Academic year' },
    { key: 'deadline_at', header: 'Deadline', render: (type) => manilaDate(type.deadline_at, 'long') },
    { key: 'description', header: 'Description', render: (type) => <RichTextBody as="span" value={type.description || 'No description.'} className="line-clamp-2 text-ink-muted" /> },
  ];

  return (
    <>
      <Card
        title="Requirement catalog"
        description="What every organization must submit, and by when."
        actions={<Button leftIcon={Plus} onClick={() => openTypeModal()}>New requirement</Button>}
      >
        {deleteError && (
          <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{deleteError}</p>
        )}
        <DataTable
          stickyHeader={false}
          columns={columns}
          rows={types.items}
          loading={types.loading}
          error={types.error}
          onRetry={loadTypes}
          actions={(type) => (
            <div className="flex justify-end gap-1.5">
              <label className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-ink"><span className="sr-only">{formatDisplayText(type.name)} active</span><input type="checkbox" role="switch" aria-label={`${formatDisplayText(type.name)} active`} checked={Boolean(type.is_active)} onChange={() => toggleTypeActive(type)} className="peer sr-only" /><span aria-hidden="true" className="relative h-7 w-12 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#0B8ED0] before:absolute before:left-1 before:top-1 before:h-5 before:w-5 before:rounded-full before:bg-white before:shadow-sm before:transition-transform peer-checked:before:translate-x-5" /></label>
              <Button size="sm" variant="secondary" onClick={() => openTypeModal(type)}>Edit</Button>
              <Button size="sm" variant="secondary" aria-label={`Delete ${formatDisplayText(type.name)}`} className="text-danger-strong" onClick={() => { setDeleteError(null); setDeleteTarget(type); }}>Delete</Button>
            </div>
          )}
          emptyState={(
            <EmptyState
              kind="first-run"
              icon={ClipboardList}
              title="No requirements defined yet"
              description="Add the documents every organization must submit for accreditation this academic year."
              action={<Button leftIcon={Plus} onClick={() => openTypeModal()}>New requirement</Button>}
            />
          )}
        />
      </Card>

      <Modal
        open={Boolean(typeModal)}
        title={typeModal?.mode === 'edit' ? 'Edit requirement' : 'New requirement'}
        description="This requirement applies to every active organization for the academic year you set."
        onClose={typeSaving ? undefined : () => setTypeModal(null)}
        closeOnEscape={!typeSaving}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setTypeModal(null)} disabled={typeSaving}>Cancel</Button>
            <Button onClick={handleTypeSubmit} loading={typeSaving}>{typeModal?.mode === 'edit' ? 'Save changes' : 'Add requirement'}</Button>
          </>
        )}
      >
        <form onSubmit={handleTypeSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Academic year" required>
            <select autoFocus value={typeForm.academic_year} onChange={(event) => setTypeForm({ ...typeForm, academic_year: event.target.value })} className="h-11 w-full rounded-lg border border-line-soft bg-white px-3 text-sm">
              <option value="">Choose academic year</option>
              {academicYears.map((year) => <option key={year.id} value={year.label}>{year.label}{year.is_current ? ' · Current' : ''}</option>)}
            </select>
          </Field>
          <Field label="Deadline" required>
            <Input type="date" value={typeForm.deadline_at} onChange={(event) => setTypeForm({ ...typeForm, deadline_at: event.target.value })} />
          </Field>
          <Field label="Name" required className="sm:col-span-2">
            <Input placeholder="e.g. Accomplishment report" value={typeForm.name} onChange={(event) => setTypeForm({ ...typeForm, name: event.target.value })} />
          </Field>
          <Field label="Description" hint="Shown to organizations alongside this requirement." className="sm:col-span-2">
            <RichTextEditor ariaLabel="Requirement description" value={typeForm.description} onChange={(description) => setTypeForm({ ...typeForm, description })} rows={4} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink sm:col-span-2">
            <input type="checkbox" role="switch" aria-checked={typeForm.is_active} className="h-4 w-4 accent-brand-700" checked={typeForm.is_active} onChange={(event) => setTypeForm({ ...typeForm, is_active: event.target.checked })} />
            Active (organizations must submit against this requirement)
          </label>
          {typeFormError && <p role="alert" className="text-sm font-semibold text-danger-strong sm:col-span-2">{typeFormError}</p>}
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete this requirement?"
        message="A requirement that organizations have already submitted against cannot be deleted. Mark it inactive instead."
        recordName={deleteTarget ? formatDisplayText(deleteTarget.name) : ''}
        confirmText="Delete requirement"
        busy={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
