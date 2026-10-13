import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Eye, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input, Select } from '../../../components/ui';
import Modal from '../../../components/Modal';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import ActiveSwitch from './ActiveSwitch';
import TableRowActions from '../../../components/TableRowActions';
import { manilaDate } from '../../../lib/format';
import { unwrapList } from '../../../services/pagination';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getAcademicYears } from '../../../services/systemAdministrationService';
import { fileAccept, fileTypesLabel, SUPPORTED_REQUIREMENT_EXTENSIONS, validateRequirementFile } from '../../../utils/requirementFiles';
import { openRequirementSample } from '../../../utils/requirementSample';
import {
  createRequirementType,
  deleteRequirementType,
  getRequirementTypes,
  removeRequirementSample,
  setRequirementSampleLink,
  updateRequirementType,
  uploadRequirementSample,
} from '../../../services/complianceService';

const EMPTY_TYPE_FORM = { academic_year: '', name: '', description: '', deadline_at: '', allowed_extensions: ['pdf'], is_active: true };
const FIELD_ORDER = ['academic_year', 'deadline_at', 'name', 'allowed_extensions'];

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
  const [sampleMode, setSampleMode] = useState('none');
  const [sampleFile, setSampleFile] = useState(null);
  const [sampleUrl, setSampleUrl] = useState('');

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
    setSampleMode(type?.template_url ? 'link' : type?.template_original_name ? 'file' : 'none');
    setSampleFile(null);
    setSampleUrl(type?.template_url || '');
    setTypeForm(type ? {
      academic_year: type.academic_year || '',
      name: type.name || '',
      description: type.description || '',
      deadline_at: String(type.deadline_at || '').slice(0, 10),
      allowed_extensions: type.allowed_extensions || SUPPORTED_REQUIREMENT_EXTENSIONS,
      is_active: type.is_active !== false,
    } : { ...EMPTY_TYPE_FORM, academic_year: currentAcademicYear || '' });
  }

  async function handleTypeSubmit(event) {
    event.preventDefault();
    const errors = {};
    if (!typeForm.academic_year.trim()) errors.academic_year = 'Choose the academic year this requirement applies to.';
    if (!typeForm.deadline_at) errors.deadline_at = 'Set the deadline for organizations.';
    if (!typeForm.name.trim()) errors.name = 'Enter a name for this requirement.';
    if (!typeForm.allowed_extensions.length) errors.allowed_extensions = 'Choose at least one accepted file type.';
    if (sampleMode === 'file' && !sampleFile && !typeModal?.type?.template_original_name) errors.sample = 'Choose a sample file.';
    if (sampleMode === 'link') {
      try {
        const url = new URL(sampleUrl.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
      } catch {
        errors.sample = 'Enter a valid http or https sample link.';
      }
    }
    setFieldErrors(errors);
    const firstInvalid = FIELD_ORDER.find((key) => errors[key]);
    if (firstInvalid || errors.sample) {
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }

    setTypeSaving(true);
    setTypeFormError(null);
    const payload = {
      ...(typeModal.mode === 'create' ? { academic_year: typeForm.academic_year.trim() } : {}),
      name: typeForm.name.trim(),
      description: typeForm.description.trim() || null,
      deadline_at: typeForm.deadline_at,
      allowed_extensions: typeForm.allowed_extensions,
      is_active: typeForm.is_active,
    };

    try {
      const response = typeModal.mode === 'edit'
        ? await updateRequirementType(typeModal.type.id, payload)
        : await createRequirementType(payload);
      const savedType = response.data;
      const previous = typeModal.type;
      const sampleChanged = (sampleMode === 'file' && sampleFile)
        || (sampleMode === 'link' && sampleUrl.trim() !== (previous?.template_url || ''))
        || (sampleMode === 'none' && (previous?.template_original_name || previous?.template_url));
      if (sampleChanged) {
        try {
          if (sampleMode === 'file') await uploadRequirementSample(savedType.id, sampleFile);
          else if (sampleMode === 'link') await setRequirementSampleLink(savedType.id, sampleUrl.trim());
          else await removeRequirementSample(savedType.id);
        } catch (cause) {
          setTypeModal({ mode: 'edit', type: savedType });
          setTypeFormError(`Requirement saved, but the sample was not updated. ${getApiErrorMessage(cause, 'Try saving it again.')}`);
          loadTypes();
          return;
        }
      }
      notify.success(typeModal.mode === 'edit' ? 'Requirement updated.' : 'Requirement added. Every active organization has been notified.');
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

  async function viewSample(type) {
    try {
      await openRequirementSample(type);
    } catch (cause) {
      notify.error(getApiErrorMessage(cause, 'Could not open the sample file.'));
    }
  }

  const columns = [
    { key: 'name', header: 'Requirement', render: (type) => <span className="font-bold text-ink">{formatDisplayText(type.name)}</span> },
    { key: 'academic_year', header: 'Academic year' },
    { key: 'deadline_at', header: 'Deadline', render: (type) => manilaDate(type.deadline_at, 'long') },
    { key: 'allowed_extensions', header: 'Accepted files', render: (type) => fileTypesLabel(type.allowed_extensions) },
    { key: 'sample', header: 'Sample format', render: (type) => type.template_original_name || (type.template_url ? 'Link' : 'None') },
    { key: 'description', header: 'Description', render: (type) => <RichTextBody as="span" value={type.description || 'No description.'} className="line-clamp-2 text-ink-muted" /> },
  ];

  return (
    <>
      <Card
        title="Organization requirements"
        description="Files for organization registration and accreditation, with deadlines and accepted formats."
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
          actions={(type) => <TableRowActions subject={formatDisplayText(type.name)} actions={[
            (type.template_url || type.template_original_name) && { label: 'View sample', icon: Eye, onClick: () => viewSample(type) },
            { label: 'Edit requirement', icon: Pencil, onClick: () => openTypeModal(type) },
            { label: type.is_active ? 'Mark inactive' : 'Mark active', icon: Power, disabled: togglingId === type.id, onClick: () => requestToggle(type) },
            { label: 'Delete requirement', icon: Trash2, danger: true, onClick: () => { setDeleteError(null); setDeleteTarget(type); } },
          ]} />}
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
        title={typeModal?.mode === 'edit' ? 'Edit organization requirement' : 'New organization requirement'}
        description="Used for accreditation. Current-semester requirements also appear during organization registration."
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
          <Field label="Academic year" required error={fieldErrors.academic_year} hint={typeModal?.mode === 'edit' ? 'The academic year stays fixed after creation.' : undefined}>
            <Select ref={(node) => { fieldRefs.current.academic_year = node; }} autoFocus disabled={typeModal?.mode === 'edit'} value={typeForm.academic_year} onChange={(event) => { setTypeForm({ ...typeForm, academic_year: event.target.value }); setFieldErrors((current) => ({ ...current, academic_year: null })); }}>
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
          <fieldset className="sm:col-span-2" aria-describedby={fieldErrors.allowed_extensions ? 'organization-file-types-error' : undefined}>
            <legend className="text-sm font-semibold text-ink">Accepted file types</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {SUPPORTED_REQUIREMENT_EXTENSIONS.map((extension) => (
                <label key={extension} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={typeForm.allowed_extensions.includes(extension)} onChange={(event) => {
                    const allowed_extensions = event.target.checked
                      ? [...typeForm.allowed_extensions, extension]
                      : typeForm.allowed_extensions.filter((item) => item !== extension);
                    setTypeForm({ ...typeForm, allowed_extensions });
                    setFieldErrors((current) => ({ ...current, allowed_extensions: null }));
                  }} />
                  {extension.toUpperCase()}
                </label>
              ))}
            </div>
            {fieldErrors.allowed_extensions && <p id="organization-file-types-error" role="alert" className="text-xs text-danger-strong">{fieldErrors.allowed_extensions}</p>}
          </fieldset>
          <Field label="Sample format" hint="Optional. Applicants and organization admins can view it before submitting." className="sm:col-span-2">
            <Select value={sampleMode} onChange={(event) => { setSampleMode(event.target.value); setFieldErrors((current) => ({ ...current, sample: null })); }}>
              <option value="none">No sample</option>
              <option value="file">Attach a file</option>
              <option value="link">Use a link</option>
            </Select>
          </Field>
          {sampleMode === 'file' && <Field label="Sample file" hint={typeModal?.type?.template_original_name ? 'Leave empty to keep the current file.' : 'Up to 10 MB.'} error={fieldErrors.sample} className="sm:col-span-2">
            <input type="file" accept={fileAccept(SUPPORTED_REQUIREMENT_EXTENSIONS)} onChange={(event) => {
              const file = event.target.files?.[0];
              const problem = file ? validateRequirementFile(file, SUPPORTED_REQUIREMENT_EXTENSIONS) : null;
              setSampleFile(problem ? null : file);
              setFieldErrors((current) => ({ ...current, sample: problem }));
            }} className="block min-h-11 w-full rounded-control border border-line bg-surface p-2 text-sm text-ink" />
          </Field>}
          {sampleMode === 'link' && <Field label="Sample link" error={fieldErrors.sample} className="sm:col-span-2">
            <Input type="url" maxLength={2048} value={sampleUrl} onChange={(event) => { setSampleUrl(event.target.value); setFieldErrors((current) => ({ ...current, sample: null })); }} placeholder="https://example.edu/sample-format" />
          </Field>}
          {(typeModal?.type?.template_original_name || typeModal?.type?.template_url) && <div className="sm:col-span-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="break-all">Current: {typeModal.type.template_original_name || typeModal.type.template_url}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => viewSample(typeModal.type)}>View sample</Button>
          </div>}
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
