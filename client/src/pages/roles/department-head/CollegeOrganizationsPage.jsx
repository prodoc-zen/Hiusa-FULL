import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, File, Plus } from 'lucide-react';
import { Button, Card, DataTable, Drawer, EmptyState, ErrorState, Field, Input, OrgMark, PageHeader, Skeleton, StatusBadge, Tabs, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { fetchAllPages } from '../../../services/pagination';
import { getCollegeOrganizations, getRegistrationRequirements, registerOrganization, resubmitOrganization } from '../../../services/collegeOrganizationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDisplayText } from '../../../utils/displayText.js';
import useRecordParam from '../../../lib/useRecordParam';
import { RegistrationNextStep, RegistrationRowStatus, RegistrationStepper } from '../../../components/organizations/RegistrationFlow';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FORM_FIELDS = ['name', 'acronym', 'description', 'color'];

const LIFECYCLE = {
  returned: { tone: 'danger', label: 'Returned' },
  pending: { tone: 'warning', label: 'Pending review' },
  active: { tone: 'success', label: 'Active' },
  archived: { tone: 'neutral', label: 'Archived' },
};

const REQUIREMENT_STATUS = {
  submitted: { tone: 'info', label: 'Submitted' },
  approved: { tone: 'success', label: 'Approved' },
  returned: { tone: 'danger', label: 'Returned' },
  not_submitted: { tone: 'neutral', label: 'Not submitted' },
};

const STATUS_PANEL_ID = 'organization-status-panel';
const NO_SEMESTER_NOTICE = 'No registration requirements are open. The SAO must activate a semester first.';

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function validatePdf(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Only PDF files are accepted.';
  if (file.size > MAX_FILE_BYTES) return 'This file is larger than 10 MB. Choose a smaller file.';
  return null;
}

function emptyForm(organization) {
  return {
    name: organization?.name || '',
    acronym: organization?.acronym || '',
    description: organization?.description || '',
    color: organization?.color || '',
  };
}

function OrganizationForm({ open, organization, onClose, onSaved }) {
  const isResubmit = Boolean(organization);
  const [fields, setFields] = useState(emptyForm(organization));
  const [files, setFiles] = useState({});
  const [fileErrors, setFileErrors] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef(null);
  const [requirementsState, setRequirementsState] = useState({ loading: !isResubmit, error: null, semester: null, requirements: [] });

  const loadRequirements = useCallback(() => {
    setRequirementsState({ loading: true, error: null, semester: null, requirements: [] });
    getRegistrationRequirements()
      .then((res) => setRequirementsState({ loading: false, error: null, semester: res.data?.academic_semester ?? null, requirements: res.data?.requirements ?? [] }))
      .catch((err) => setRequirementsState({ loading: false, error: getApiErrorMessage(err, 'Could not load the registration requirements.'), semester: null, requirements: [] }));
  }, []);

  useEffect(() => {
    if (open && !isResubmit) loadRequirements();
  }, [open, isResubmit, loadRequirements]);

  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const requirements = useMemo(() => (isResubmit
    ? (organization.registration_requirements || []).map((item) => ({ id: item.requirement_type_id, name: item.requirement_name, current: item }))
    : requirementsState.requirements.map((item) => ({ id: item.id, name: item.name, description: item.description, deadline_at: item.deadline_at }))), [isResubmit, organization, requirementsState.requirements]);

  function setField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function chooseFile(requirementId, file) {
    if (!file) return;
    const problem = validatePdf(file);
    setFileErrors((current) => ({ ...current, [requirementId]: problem || undefined }));
    setErrors((current) => ({ ...current, [`files.${requirementId}`]: undefined }));
    setFiles((current) => {
      const next = { ...current };
      if (problem) delete next[requirementId];
      else next[requirementId] = file;
      return next;
    });
  }

  function validate() {
    const found = {};
    if (!fields.name.trim()) found.name = 'Enter the organization name.';
    else if (fields.name.length > 255) found.name = 'The name may not be longer than 255 characters.';
    if (!fields.acronym.trim()) found.acronym = 'Enter the acronym.';
    else if (fields.acronym.length > 50) found.acronym = 'The acronym may not be longer than 50 characters.';
    if (fields.description.length > 3000) found.description = 'The description may not be longer than 3000 characters.';
    if (fields.color && !HEX_COLOR.test(fields.color)) found.color = 'Use a color like #0B8ED0.';
    requirements.forEach((requirement) => {
      if (fileErrors[requirement.id]) found[`files.${requirement.id}`] = fileErrors[requirement.id];
      else if (!isResubmit && !files[requirement.id]) found[`files.${requirement.id}`] = 'Attach a PDF for this requirement.';
    });
    return found;
  }

  async function handleSubmit(event) {
    event?.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setFocusRequest((count) => count + 1);
      return;
    }

    setSubmitting(true);
    const payload = { name: fields.name.trim(), acronym: fields.acronym.trim(), description: fields.description, color: fields.color };
    try {
      if (isResubmit) await resubmitOrganization(organization.id, payload, files);
      else await registerOrganization(payload, files);
      notify.success(isResubmit ? 'Registration resubmitted to the SAO.' : 'Organization submitted to the SAO for review.');
      onSaved();
    } catch (err) {
      const serverErrors = err?.response?.data?.errors || {};
      const mapped = Object.fromEntries(Object.entries(serverErrors).map(([key, messages]) => [key, [].concat(messages)[0]]));
      setErrors(mapped);
      const knownKeys = [...FORM_FIELDS, ...requirements.map((requirement) => `files.${requirement.id}`)];
      if (!Object.keys(mapped).some((key) => knownKeys.includes(key))) setFormError(getApiErrorMessage(err, 'Could not submit this registration.'));
      else setFocusRequest((count) => count + 1);
      if (err?.response?.status === 409) onSaved({ stayOpen: true });
    } finally {
      setSubmitting(false);
    }
  }

  const noSemester = !isResubmit && !requirementsState.loading && !requirementsState.error && requirements.length === 0;
  const showForm = isResubmit || (!requirementsState.loading && !requirementsState.error && !noSemester);
  const swatch = HEX_COLOR.test(fields.color) ? fields.color : '#0B8ED0';

  return (
    <Modal
      open={open}
      title={isResubmit ? `Edit and resubmit ${organization.name}` : 'Register an organization'}
      description={isResubmit ? 'Change the details and replace only the documents the SAO returned. Resubmitting sends it back to the SAO for review.' : 'The SAO reviews every registration. Attach all required documents as PDF files.'}
      onClose={() => !submitting && onClose()}
      closeOnBackdrop={false}
      maxWidth="max-w-[640px]"
      footer={showForm ? (
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} loading={submitting}>{isResubmit ? 'Resubmit to SAO' : 'Submit for review'}</Button>
        </>
      ) : <Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {requirementsState.loading && <div className="space-y-3"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>}
      {requirementsState.error && <ErrorState description={requirementsState.error} onRetry={loadRequirements} />}
      {noSemester && (
        <div role="status" className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning-tint p-4 text-sm font-semibold text-warning-strong">
          <CalendarClock size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{NO_SEMESTER_NOTICE}</p>
        </div>
      )}
      {showForm && (
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{formError}</p>}
          {isResubmit && organization.review_remarks && (
            <div className="rounded-control border border-danger/30 bg-danger-tint p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-danger-strong">SAO remarks</p>
              <p className="mt-1 text-sm font-medium text-danger-strong">{organization.review_remarks}</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization name" required error={errors.name}>
              <Input value={fields.name} maxLength={255} onChange={(event) => setField('name', event.target.value)} />
            </Field>
            <Field label="Acronym" required error={errors.acronym}>
              <Input value={fields.acronym} maxLength={50} onChange={(event) => setField('acronym', event.target.value)} />
            </Field>
          </div>
          <Field label="Description" hint="Optional. What the organization does." error={errors.description}>
            <Textarea rows={3} maxLength={3000} value={fields.description} onChange={(event) => setField('description', event.target.value)} />
          </Field>
          <div className="flex items-start gap-2">
            <input
              type="color"
              aria-label="Pick a color"
              value={swatch}
              onChange={(event) => setField('color', event.target.value.toUpperCase())}
              className="mt-[26px] h-11 w-14 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-1"
            />
            <Field label="Color" hint="Optional. A hex color such as #0B8ED0." error={errors.color} className="min-w-0 flex-1">
              <Input value={fields.color} maxLength={7} placeholder="#0B8ED0" onChange={(event) => setField('color', event.target.value)} />
            </Field>
          </div>
          <div className="space-y-4 border-t border-line pt-4">
            <div>
              <h3 className="text-base font-bold text-ink">Registration requirements</h3>
              <p className="mt-1 text-xs font-medium text-ink-muted">
                {isResubmit ? 'Documents already on file stay as they are. Choose a PDF only to replace one. ' : requirementsState.semester ? `Academic year ${requirementsState.semester.academic_year}, semester ${requirementsState.semester.number}. ` : ''}
                PDF only, up to 10 MB each.
              </p>
            </div>
            {requirements.map((requirement) => {
              const chosen = files[requirement.id];
              const key = `files.${requirement.id}`;
              const hint = (
                <>
                  {requirement.description && <span className="block">{requirement.description}</span>}
                  {requirement.deadline_at && <span className="block">Due {manilaDate(requirement.deadline_at, 'long')}</span>}
                  {requirement.current && <span className="block">Current file: {requirement.current.file_name || 'None'} ({(REQUIREMENT_STATUS[requirement.current.status] || REQUIREMENT_STATUS.not_submitted).label})</span>}
                  {chosen && <span className="block font-semibold text-ink">Selected: {chosen.name} ({formatSize(chosen.size)})</span>}
                </>
              );
              return (
                <Field key={requirement.id} label={requirement.name} required={!isResubmit} hint={hint} error={errors[key]}>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => { chooseFile(requirement.id, event.target.files?.[0]); event.target.value = ''; }}
                    className="block w-full rounded-control border border-line bg-surface p-2 text-sm font-medium text-ink file:mr-3 file:h-9 file:cursor-pointer file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:text-xs file:font-bold file:text-ink"
                  />
                </Field>
              );
            })}
          </div>
        </form>
      )}
    </Modal>
  );
}

function OrganizationDetails({ organization, onClose, onEdit }) {
  if (!organization) return null;
  const lifecycle = LIFECYCLE[organization.lifecycle_status] || LIFECYCLE.active;
  const checklist = organization.registration_requirements || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={organization.lifecycle_status} label={lifecycle.label} tone={lifecycle.tone} />
        {organization.submitted_at && <span className="text-xs font-medium text-ink-muted">Submitted {manilaDate(organization.submitted_at, 'long')}</span>}
      </div>
      <RegistrationStepper organization={organization} viewerRole="DEPARTMENT_HEAD" />
      <RegistrationNextStep organization={organization} viewerRole="DEPARTMENT_HEAD" onPrimary={() => onEdit(organization)} />
      {organization.lifecycle_status === 'archived' && <p className="text-sm font-semibold text-ink-muted">Archived by the SAO. Read only.</p>}
      <div>
        <h3 className="text-base font-bold text-ink">Requirement checklist</h3>
        {checklist.length === 0 ? (
          <p className="mt-2 text-sm font-medium text-ink-muted">No registration documents are on file.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-soft">
            {checklist.map((item) => {
              const status = REQUIREMENT_STATUS[item.status] || REQUIREMENT_STATUS.not_submitted;
              return (
                <li key={item.requirement_type_id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{item.requirement_name}</p>
                    <p className="mt-0.5 inline-flex items-center gap-1 break-all text-xs font-medium text-ink-muted"><File size={13} aria-hidden="true" />{item.file_name || 'No file'}</p>
                  </div>
                  <StatusBadge status={item.status} label={status.label} tone={status.tone} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export default function CollegeOrganizationsPage() {
  const [state, setState] = useState({ loading: true, error: null, organizations: [] });
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const tab = Object.hasOwn(LIFECYCLE, requestedStatus) ? requestedStatus : 'all';
  const [formTarget, setFormTarget] = useState(null);
  const [recordId, setRecordId] = useRecordParam();
  const [lastDetails, setLastDetails] = useState(null);
  const [missingRecord, setMissingRecord] = useState(false);

  function changeTab(key) {
    setSearchParams(key === 'all' ? {} : { status: key }, { replace: true });
  }

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    fetchAllPages((params) => getCollegeOrganizations(params).then((res) => res.data))
      .then((organizations) => setState({ loading: false, error: null, organizations }))
      .catch((err) => setState((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load the organizations of your college.') })));
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => state.organizations.reduce((totals, organization) => ({ ...totals, [organization.lifecycle_status]: (totals[organization.lifecycle_status] || 0) + 1 }), {}), [state.organizations]);
  const rows = useMemo(() => (tab === 'all' ? state.organizations : state.organizations.filter((organization) => organization.lifecycle_status === tab)), [state.organizations, tab]);
  const college = state.organizations[0]?.college;
  const detailsTarget = recordId ? state.organizations.find((organization) => String(organization.id) === recordId) ?? null : null;
  if (detailsTarget && detailsTarget !== lastDetails) setLastDetails(detailsTarget);
  const shownDetails = detailsTarget ?? lastDetails;

  useEffect(() => {
    if (!recordId || state.loading || state.error) return;
    if (state.organizations.some((organization) => String(organization.id) === recordId)) return;
    setMissingRecord(true);
    setRecordId(null);
  }, [recordId, setRecordId, state.error, state.loading, state.organizations]);

  function openDetails(organization) {
    setMissingRecord(false);
    setRecordId(organization.id);
  }

  const tabs = [
    { key: 'all', label: `All (${state.organizations.length})`, panelId: STATUS_PANEL_ID },
    ...Object.entries(LIFECYCLE).map(([key, value]) => ({ key, label: `${value.label} (${counts[key] || 0})`, panelId: STATUS_PANEL_ID })),
  ];

  const mutedIfArchived = (organization) => (organization.lifecycle_status === 'archived' ? 'text-ink-muted' : '');

  const columns = [
    {
      key: 'name',
      header: 'Organization',
      render: (organization) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={organization.lifecycle_status === 'archived' ? 'grayscale' : ''}><OrgMark name={organization.name} acronym={organization.acronym} size="sm" /></span>
          <div className="min-w-0 text-left">
            <p className={`break-words font-semibold ${organization.lifecycle_status === 'archived' ? 'text-ink-muted' : 'text-ink'}`}>{formatDisplayText(organization.name)}</p>
            <p className="text-xs font-medium text-ink-muted">{organization.acronym}</p>
            <RegistrationRowStatus organization={organization} viewerRole="DEPARTMENT_HEAD" className="mt-2 max-w-xs" />
            {organization.lifecycle_status === 'returned' && organization.review_remarks && <p className="mt-1 max-w-sm text-xs font-semibold text-danger-strong">SAO remarks: {organization.review_remarks}</p>}
            {organization.lifecycle_status === 'archived' && <p className="mt-1 text-xs font-semibold text-ink-muted">Archived by the SAO. Read only.</p>}
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (organization) => { const lifecycle = LIFECYCLE[organization.lifecycle_status] || LIFECYCLE.active; const badge = <StatusBadge status={organization.lifecycle_status} label={lifecycle.label} tone={lifecycle.tone} />; return organization.lifecycle_status === 'archived' ? <span role="group" aria-label="Archived, read only">{badge}</span> : badge; } },
    { key: 'members', header: 'Members', align: 'right', render: (organization) => <span className={mutedIfArchived(organization)}>{organization.members_count ?? 0}</span> },
    { key: 'admins', header: 'Admins', align: 'right', render: (organization) => <span className={mutedIfArchived(organization)}>{organization.administrators_count ?? 0}</span> },
    { key: 'submitted', header: 'Submitted', render: (organization) => <span className={mutedIfArchived(organization)}>{organization.submitted_at ? manilaDate(organization.submitted_at) : '-'}</span> },
  ];

  function closeForm() {
    setFormTarget(null);
  }

  function handleSaved(options) {
    if (!options?.stayOpen) closeForm();
    setRecordId(null);
    load();
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        description={college ? `Student organizations of ${college}. Register new ones and follow their SAO review.` : 'Register student organizations and follow their SAO review.'}
        primary={<Button leftIcon={Plus} onClick={() => setFormTarget({ mode: 'register' })}>Register an organization</Button>}
      />
      {missingRecord && <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">That organization is not in your college, so there is nothing to open.</p>}

      <Card bodyClassName="p-0">
        <div className="px-4 pt-2"><Tabs tabs={tabs} value={tab} onChange={changeTab} /></div>
        <div role="tabpanel" id={STATUS_PANEL_ID} aria-label={`${tab === 'all' ? 'All' : LIFECYCLE[tab].label} organizations`}>
          <DataTable
            stickyHeader={false}
            caption="Organizations of your college"
            rows={rows}
            columns={columns}
            loading={state.loading}
            error={state.error}
            onRetry={load}
            filtersActive={tab !== 'all'}
            emptyState={tab === 'all'
              ? <EmptyState title="No organizations yet" description="Register your first student organization. The SAO reviews it, then provides its administrator." action={<Button variant="secondary" leftIcon={Plus} onClick={() => setFormTarget({ mode: 'register' })}>Register an organization</Button>} />
              : <EmptyState kind="filtered" title={`No ${LIFECYCLE[tab].label.toLowerCase()} organizations`} description="Choose another status to see the rest of your college." />}
            actions={(organization) => (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="secondary" size="sm" className="max-sm:h-[42px]" aria-label={`View checklist for ${organization.name}`} onClick={() => openDetails(organization)}>View checklist</Button>
                {organization.lifecycle_status === 'returned' && <Button size="sm" className="max-sm:h-[42px]" aria-label={`Edit and resubmit ${organization.name}`} onClick={() => setFormTarget({ mode: 'resubmit', organization })}>Edit and resubmit</Button>}
              </div>
            )}
          />
        </div>
      </Card>

      {formTarget && (
        <OrganizationForm
          key={formTarget.organization?.id ?? 'register'}
          open
          organization={formTarget.organization}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}

      <Drawer open={Boolean(detailsTarget)} title={shownDetails?.name} description={shownDetails?.acronym} onClose={() => setRecordId(null)} width="max-w-lg">
        <OrganizationDetails
          organization={shownDetails}
          onClose={() => setRecordId(null)}
          onEdit={(organization) => { setRecordId(null); setFormTarget({ mode: 'resubmit', organization }); }}
        />
      </Drawer>
    </div>
  );
}
