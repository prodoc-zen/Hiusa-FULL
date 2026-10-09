import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input, Select } from '../../../components/ui';
import Modal from '../../../components/Modal';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import ActiveSwitch from './ActiveSwitch';
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
const FIELD_ORDER = ['academic_year', 'deadline_at', 'name'];
const ROW_ACTION = 'h-11! sm:h-9!';

export default function RequirementsTab({ currentAcademicYear, onChanged }) {
  const [types, setTypes] = useState({ loading: true, error: null, items: [] });
  const [typeModal, setTypeModal] = useState(null);
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE_FORM);
  const [academicYears, setAcademicYears] = useState([]);
  const [typeFormError, setTypeFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const fieldRefs = useRef({});
  const [togglingId, setTogglingId] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
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
    setFieldErrors({});
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
    const errors = {};
    if (!typeForm.academic_year.trim()) errors.academic_year = 'Choose the academic year this requirement applies to.';
    if (!typeForm.deadline_at) errors.deadline_at = 'Set the deadline for organizations.';
    if (!typeForm.name.trim()) errors.name = 'Enter a name for this requirement.';
    setFieldErrors(errors);
    const firstInvalid = FIELD_ORDER.find((key) => errors[key]);
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus();
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
    setTogglingId(type.id);
    try {
      await updateRequirementType(type.id, { is_active: !type.is_active });
      notify.success(type.is_active ? `"${type.name}" marked inactive.` : `"${type.name}" marked active.`);
      setDeactivateTarget(null);
      loadTypes();
      onChanged();
    } catch (err) {
      setDeactivateTarget(null);
      notify.error(getApiErrorMessage(err, 'Could not update this requirement.'));
    } finally {
      setTogglingId(null);
    }
  }

  function requestToggle(type) {
    if (type.is_active) setDeactivateTarget(type);
    else toggleTypeActive(type);
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
            <div className="flex items-center justify-end gap-1.5">
              <ActiveSwitch label={`${formatDisplayText(type.name)} active`} checked={Boolean(type.is_active)} busy={togglingId === type.id} onChange={() => requestToggle(type)} />
              <Button size="sm" variant="secondary" className={ROW_ACTION} onClick={() => openTypeModal(type)}>Edit</Button>
              <Button size="sm" variant="secondary" aria-label={`Delete ${formatDisplayText(type.name)}`} className={`${ROW_ACTION} text-danger-strong`} onClick={() => { setDeleteError(null); setDeleteTarget(type); }}>Delete</Button>
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
        <form onSubmit={handleTypeSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Academic year" required error={fieldErrors.academic_year}>
            <Select ref={(node) => { fieldRefs.current.academic_year = node; }} autoFocus value={typeForm.academic_year} onChange={(event) => { setTypeForm({ ...typeForm, academic_year: event.target.value }); setFieldErrors((current) => ({ ...current, academic_year: null })); }}>
              <option value="">Choose academic year</option>
              {academicYears.map((year) => <option key={year.id} value={year.label}>{year.label}{year.is_current ? ' · Current' : ''}</option>)}
            </Select>
          </Field>
          <Field label="Deadline" required error={fieldErrors.deadline_at}>
            <Input ref={(node) => { fieldRefs.current.deadline_at = node; }} type="date" value={typeForm.deadline_at} onChange={(event) => { setTypeForm({ ...typeForm, deadline_at: event.target.value }); setFieldErrors((current) => ({ ...current, deadline_at: null })); }} />
          </Field>
          <Field label="Name" required error={fieldErrors.name} className="sm:col-span-2">
            <Input ref={(node) => { fieldRefs.current.name = node; }} placeholder="e.g. Accomplishment report" value={typeForm.name} onChange={(event) => { setTypeForm({ ...typeForm, name: event.target.value }); setFieldErrors((current) => ({ ...current, name: null })); }} />
          </Field>
          <Field label="Description" hint="Shown to organizations alongside this requirement." className="sm:col-span-2">
            <RichTextEditor ariaLabel="Requirement description" value={typeForm.description} onChange={(description) => setTypeForm({ ...typeForm, description })} rows={4} />
          </Field>
          <div className="sm:col-span-2">
            <ActiveSwitch label="Requirement active" checked={typeForm.is_active} onChange={(isActive) => setTypeForm({ ...typeForm, is_active: isActive })} />
            <p className="text-xs font-medium text-ink-muted">Active requirements must be submitted by every organization. Turning one off changes accreditation for all of them.</p>
          </div>
          {typeFormError && <p role="alert" className="text-sm font-semibold text-danger-strong sm:col-span-2">{typeFormError}</p>}
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deactivateTarget)}
        title="Mark this requirement inactive?"
        message="Organizations will no longer need to submit it, and every organization's accreditation status is recalculated without it."
        recordName={deactivateTarget ? formatDisplayText(deactivateTarget.name) : ''}
        confirmText="Mark inactive"
        variant="primary"
        busy={togglingId === deactivateTarget?.id}
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => toggleTypeActive(deactivateTarget)}
      />

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
