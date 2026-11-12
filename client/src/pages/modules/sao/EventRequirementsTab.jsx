import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, FileText, Pencil, Trash2, X } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input, SegmentedControl, Select, SkeletonText, StatusBadge, StatusToggleSwitch, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import { createEventRequirement, deleteEventRequirement, getEventRequirements, removeEventRequirementTemplate, updateEventRequirement } from '../../../services/eventService';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import EventFilesReview, { allAccepted, filesOf, initialMarks, markedFiles, missingNote } from '../../../components/approvals/EventFilesReview';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';
import ActiveSwitch from './ActiveSwitch';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import TableRowActions from '../../../components/TableRowActions';
import { fetchAllPages } from '../../../services/pagination';

const empty = { name: '', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, is_active: true };
const ROW_ACTION = 'h-11! sm:h-9!';
const VENUE_TYPE_LABEL = { on_campus: 'On campus', off_campus: 'Off campus' };
const ON_CAMPUS_PRESETS = [
  'Venue Reservation Letter',
  'Request Letter',
  'Equipment & Technical Request Forms',
];
const OFF_CAMPUS_PRESETS = [
  'Approved Letter Of Intent For The Proposed Activity',
  'Document Tracking Slip',
  'Student Activity Clearance/Permit Form',
  'Modified Checklist Requirements For Off-Campus Activity',
  'Report Of Compliance',
  'Designation Letter For Personnel In-Charge',
  'Participants Parents Consent Form',
  'Minutes Of The Meeting (Planning Stage)',
  'Curriculum Requirement',
  'Journal',
  'Sanitary Permit (If Applicable)',
  'Emergency Preparedness Plan',
  'Mobility Of Students',
  'LGU/NGO',
  'Gate Pass From PCO (If Applicable)',
];

const NO_SEMESTER_MESSAGE = 'There is no active semester. Activate or select a semester before adding a requirement.';
const READ_ONLY_MESSAGE = 'This semester is completed, so its requirements are read only.';

export default function EventRequirementsTab({ mode = 'settings', organizationId = '', noSemester = false, readOnly = false, initialEventId = '', onEventOpen }) {
  const [reviewSearch, setReviewSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState('all');
  const [togglingId, setTogglingId] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [marks, setMarks] = useState({});
  const [notes, setNotes] = useState({});
  const [form, setForm] = useState(empty);
  const [nameError, setNameError] = useState(null);
  const nameRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(initialEventId ? Number(initialEventId) : null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeTemplateTarget, setRemoveTemplateTarget] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [sampleMode, setSampleMode] = useState('file');
  const [sampleUrl, setSampleUrl] = useState('');
  const [templateError, setTemplateError] = useState(null);
  const templateInputRef = useRef(null);
  const [decision, setDecision] = useState(null);
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [remarksError, setRemarksError] = useState(null);
  const remarksRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const loadVersion = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      if (mode === 'reviews') {
        const rows = await fetchAllPages((params) => getApprovalRequests({ ...params, entity_type: 'event', status: 'pending', organization_id: organizationId || undefined }).then((response) => response.data));
        if (version === loadVersion.current) {
          setApprovals(rows);
          setMarks(initialMarks(rows.flatMap(filesOf), 'sao'));
          setNotes({});
        }
      } else {
        const response = await (refresh ? getEventRequirements({ cache: false }) : getEventRequirements());
        if (version === loadVersion.current) setRequirements(response.data || []);
      }
      if (version === loadVersion.current) setLoadError('');
    } catch (cause) {
      if (version === loadVersion.current) setLoadError(getApiErrorMessage(cause, mode === 'reviews' ? 'Could not load events waiting for SAO.' : 'Could not load event requirements.'));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [mode, organizationId]);
  useEffect(() => {
    const requests = loadVersion;
    load();
    return () => { requests.current++; };
  }, [load]);

  function chooseEvent(eventId) {
    setSelectedEventId(eventId);
    onEventOpen?.(eventId);
  }

  function resetForm() {
    setEditingId(null);
    setForm(empty);
    setNameError(null);
    setTemplateFile(null);
    setSampleMode('file');
    setSampleUrl('');
    setTemplateError(null);
    if (templateInputRef.current) templateInputRef.current.value = '';
  }

  function chooseTemplate(file) {
    setTemplateError(null);
    if (!file) { setTemplateFile(null); return; }
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      setTemplateFile(null);
      setTemplateError('Choose a PDF sample template.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setTemplateFile(null);
      setTemplateError('The sample template must be 10 MB or smaller.');
      return;
    }
    setTemplateFile(file);
  }

  async function viewTemplate(requirement) {
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

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setNameError('Enter the name of the file organizations must submit.');
      nameRef.current?.focus();
      return;
    }
    if (sampleMode === 'file' && !templateFile && !editingRequirement?.template_original_name) {
      setTemplateError('Choose a PDF sample file.');
      templateInputRef.current?.focus();
      return;
    }
    if (!['file', 'link'].includes(sampleMode)) { setTemplateError('Provide a sample format as a file or link.'); return; }
    if (sampleMode === 'link') {
      try {
        const url = new URL(sampleUrl.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
      } catch {
        setTemplateError('Enter a valid http or https sample link.');
        return;
      }
    }
    if (templateError) return;
    setBusy(true);
    setSaving(true);
    setActionError('');
    try {
      const payload = { ...form, ...(sampleMode === 'file' && templateFile ? { template: templateFile } : {}), ...(sampleMode === 'link' ? { template_url: sampleUrl.trim() } : {}) };
      if (editingId) await updateEventRequirement(editingId, payload);
      else await createEventRequirement(payload);
      notify.success(editingId ? 'Requirement updated.' : 'Requirement added.');
      resetForm();
      await load();
    } catch (cause) {
      setActionError(getApiErrorMessage(cause, 'Could not save the requirement.'));
      setTemplateError(cause.response?.data?.errors?.template?.[0] || cause.response?.data?.errors?.template_url?.[0] || null);
    } finally {
      setBusy(false);
      setSaving(false);
    }
  }

  async function confirmRemove() {
    const requirement = removeTarget;
    setBusy(true);
    setActionError('');
    try {
      await deleteEventRequirement(requirement.id);
      notify.success('Requirement removed.');
      if (editingId === requirement.id) resetForm();
      setRemoveTarget(null);
      await load();
    } catch (cause) {
      setRemoveTarget(null);
      setActionError(getApiErrorMessage(cause, 'Could not remove the requirement.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveTemplate() {
    const requirement = removeTemplateTarget;
    setBusy(true);
    setActionError('');
    try {
      await removeEventRequirementTemplate(requirement.id);
      setSampleMode('file');
      setSampleUrl('');
      setTemplateFile(null);
      setRemoveTemplateTarget(null);
      notify.success('Sample template removed.');
      await load();
    } catch (cause) {
      setRemoveTemplateTarget(null);
      setActionError(getApiErrorMessage(cause, 'Could not remove the sample template.'));
    } finally {
      setBusy(false);
    }
  }

  function openDecision(approval, action) {
    setActionError('');
    setDecisionRemarks('');
    setRemarksError(null);
    setDecision({ approval, action });
  }

  function closeDecision() {
    setDecision(null);
    setDecisionRemarks('');
    setRemarksError(null);
  }

  async function submitDecision() {
    const { approval, action } = decision;
    const status = action === 'approve' ? 'approved' : 'rejected';
    if (status === 'rejected' && !decisionRemarks.trim()) {
      setRemarksError('Write why this event is rejected so the organization can respond.');
      remarksRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await reviewApprovalRequest(approval.id, { status, remarks: decisionRemarks.trim() || undefined, files: markedFiles(filesOf(approval), marks, notes) });
      chooseEvent(null);
      notify.success(`Event ${status}.`);
      closeDecision();
      await load();
    } catch (cause) {
      const message = getApiErrorMessage(cause, 'Could not review this event.');
      closeDecision();
      setActionError(message);
      notify.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRequirementActive(requirement) {
    setTogglingId(requirement.id);
    setActionError('');
    try {
      await updateEventRequirement(requirement.id, {
        name: requirement.name,
        description: requirement.description || '',
        allowed_extensions: requirement.allowed_extensions || ['pdf'],
        venue_type: requirement.venue_type || 'all',
        is_optional: Boolean(requirement.is_optional),
        is_active: !requirement.is_active,
      });
      notify.success(requirement.is_active ? `"${requirement.name}" marked inactive.` : `"${requirement.name}" marked active.`);
      await load();
    } catch (cause) {
      setActionError(getApiErrorMessage(cause, 'Could not update the requirement status.'));
    } finally {
      setTogglingId(null);
    }
  }

  const filteredRequirements = requirements.filter((item) => venueFilter === 'all' || item.venue_type === venueFilter);

  const checklistColumns = [
    { key: 'order', header: '#', align: 'right', render: (requirement) => filteredRequirements.indexOf(requirement) + 1 },
    {
      key: 'name',
      header: 'File',
      render: (requirement) => (
        <div className="min-w-0 text-left">
          <p className="break-words font-medium text-ink">{formatDisplayText(requirement.name)}</p>
          {requirement.description && <RichTextBody value={requirement.description} className="mt-1 break-words text-xs text-ink-muted" />}
          <p className="mt-1 break-words text-xs text-ink-muted">{`PDF · ${VENUE_TYPE_LABEL[requirement.venue_type] || 'All venues'} · ${requirement.is_active ? (requirement.is_optional ? 'If applicable' : 'Required') : 'Inactive'}`}</p>
          <p className="mt-0.5 break-words text-xs">
            {requirement.template_url
              ? <span className="text-ink-muted">Sample: link</span>
              : requirement.template_original_name ? <span className="text-ink-muted">Sample: PDF file</span> : <span className="font-semibold text-danger-strong">Sample format required</span>}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (requirement) => (readOnly ? <StatusBadge status={requirement.is_active ? 'active' : 'inactive'} /> : (
        <StatusToggleSwitch
          checked={Boolean(requirement.is_active)}
          disabled={busy || togglingId === requirement.id}
          onChange={() => toggleRequirementActive(requirement)}
          label={`${requirement.is_active ? 'Deactivate' : 'Activate'} ${formatDisplayText(requirement.name)}`}
        />
      )),
    },
  ];
  const editingRequirement = requirements.find((item) => item.id === editingId);

  return (
    <div className="space-y-5">
      {loadError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-control border border-danger/30 bg-danger-tint p-3 text-sm text-danger-strong">
          {loadError}
          <Button variant="secondary" size="sm" className={ROW_ACTION} onClick={() => load(true)}>Retry</Button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint p-3 text-sm text-danger-strong">{actionError}</p>
      )}

      {mode === 'settings' && readOnly && <p className="text-sm text-ink-muted">{READ_ONLY_MESSAGE}</p>}

      {mode === 'settings' && <section className={readOnly ? undefined : 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]'}>
        <Card
          title="Event requirements"
          description="Each active item needs one file for an event."
          actions={<span className="text-xs font-semibold text-ink-muted">{requirements.filter((item) => item.is_active).length} active</span>}
        >
          <SegmentedControl
            className="mb-3 max-w-full overflow-x-auto"
            value={venueFilter}
            onChange={setVenueFilter}
            options={[
              { value: 'all', label: `All venues (${requirements.length})` },
              { value: 'on_campus', label: `On campus (${requirements.filter((r) => r.venue_type === 'on_campus').length})` },
              { value: 'off_campus', label: `Off campus (${requirements.filter((r) => r.venue_type === 'off_campus').length})` },
            ]}
          />
          <DataTable
            stickyHeader={false}
            caption="Event requirements"
            columns={checklistColumns}
            rows={filteredRequirements}
            loading={loading}
            actions={(requirement) => <TableRowActions subject={formatDisplayText(requirement.name)} actions={[
              (requirement.template_url || requirement.template_original_name) && { label: 'View sample', icon: Eye, onClick: () => viewTemplate(requirement) },
              !readOnly && { label: 'Edit requirement', icon: Pencil, disabled: busy, onClick: () => {
                    setNameError(null);
                    setEditingId(requirement.id);
                    setForm({ name: requirement.name, description: requirement.description || '', allowed_extensions: ['pdf'], venue_type: requirement.venue_type || 'all', is_optional: requirement.is_optional, is_active: requirement.is_active });
                    setSampleMode(requirement.template_url ? 'link' : 'file');
                    setSampleUrl(requirement.template_url || '');
                    setTemplateFile(null);
                    setTemplateError(null);
                    if (templateInputRef.current) templateInputRef.current.value = '';
                  } },
              !readOnly && { label: 'Remove requirement', icon: Trash2, danger: true, disabled: busy, onClick: () => { setActionError(''); setRemoveTarget(requirement); } },
            ]} />}
            emptyState={loadError ? <div /> : (
              <EmptyState
                kind="first-run"
                icon={FileText}
                title="No files required yet"
                description="Add the first item with the form."
              />
            )}
          />
        </Card>

        {!readOnly && <form onSubmit={save} noValidate className="h-fit">
          <Card title={editingId ? 'Edit event requirement' : 'Add event requirement'}>
            <div className="flex flex-col gap-4">
              <Field label="File name" required error={nameError}>
                <Input
                  ref={nameRef}
                  maxLength={150}
                  value={form.name}
                  onChange={(event) => { setForm({ ...form, name: event.target.value }); setNameError(null); }}
                  placeholder="Event proposal"
                />
              </Field>
              <Field label="Venue type">
                <Select value={form.venue_type} onChange={(event) => setForm({ ...form, venue_type: event.target.value })}>
                  <option value="all">All venues</option>
                  <option value="on_campus">On campus</option>
                  <option value="off_campus">Off campus</option>
                </Select>
              </Field>
              {(form.venue_type === 'on_campus' || form.venue_type === 'off_campus') && (
                <Field label={`Standard ${form.venue_type === 'on_campus' ? 'on-campus' : 'off-campus'} requirement`} optional>
                  <Select
                    aria-label="Standard requirement preset"
                    value=""
                    onChange={(event) => {
                      const chosen = event.target.value;
                      if (chosen) {
                        setForm((curr) => ({
                          ...curr,
                          name: chosen,
                          is_optional: /if applicable/i.test(chosen),
                        }));
                        setNameError(null);
                      }
                    }}
                  >
                    <option value="">Choose a standard requirement</option>
                    {(form.venue_type === 'on_campus' ? ON_CAMPUS_PRESETS : OFF_CAMPUS_PRESETS).map((preset) => (
                      <option key={preset} value={preset}>{preset}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Instructions for organizations" optional>
                <RichTextEditor maxLength={500} rows={3} value={form.description} onChange={(description) => setForm({ ...form, description })} />
              </Field>
              <p className="text-xs text-ink-muted">Accepted file type: PDF</p>
              <Field label="Sample format" required hint="Organizations can open it before they submit or correct a file.">
                <Select value={sampleMode} onChange={(event) => { setSampleMode(event.target.value); setTemplateError(null); }}>
                  <option value="file">Attach a PDF</option>
                  <option value="link">Use a link</option>
                </Select>
              </Field>
              {sampleMode === 'file' && <Field label="Sample PDF file" hint={editingRequirement?.template_original_name ? 'Leave empty to keep the current file.' : undefined} error={templateError}>
                <input ref={templateInputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => chooseTemplate(event.target.files?.[0])} className="block min-h-11 w-full rounded-control border border-line bg-surface p-2 text-sm text-ink" />
              </Field>}
              {sampleMode === 'link' && <Field label="Sample link" error={templateError}>
                <Input type="url" value={sampleUrl} onChange={(event) => { setSampleUrl(event.target.value); setTemplateError(null); }} placeholder="https://example.edu/event-proposal-format" maxLength={2048} />
              </Field>}
              {(editingRequirement?.template_original_name || editingRequirement?.template_url) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span className="break-all">Current: {editingRequirement.template_original_name || editingRequirement.template_url}</span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => viewTemplate(editingRequirement)}>View sample</Button>
                  {!editingRequirement.is_active && <Button type="button" size="sm" variant="secondary" onClick={() => setRemoveTemplateTarget(editingRequirement)}>Remove sample</Button>}
                </div>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={form.is_optional} onChange={(event) => setForm({ ...form, is_optional: event.target.checked })} />
                Only if applicable
              </label>
              <ActiveSwitch label="Active requirement" checked={form.is_active} onChange={(isActive) => setForm({ ...form, is_active: isActive })} />
              {noSemester && !editingId && <p id="add-event-requirement-note" className="text-sm text-ink-muted">{NO_SEMESTER_MESSAGE}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={saving} disabled={busy || !form.allowed_extensions.length || (noSemester && !editingId)} aria-describedby={noSemester && !editingId ? 'add-event-requirement-note' : undefined}>{editingId ? 'Save changes' : 'Add requirement'}</Button>
                {editingId && <Button variant="secondary" onClick={resetForm}>Cancel</Button>}
              </div>
            </div>
          </Card>
        </form>}
      </section>}

      {mode === 'reviews' && <Card title="Events waiting for SAO">
        <Input type="search" className="mb-4" aria-label="Search event submissions" placeholder="Search event or requester" value={reviewSearch} onChange={(event) => setReviewSearch(event.target.value)} />
        {loading ? <SkeletonText lines={3} /> : approvals.length === 0 ? (
          !loadError && <EmptyState kind="first-run" icon={FileText} title="No event submissions are waiting for review." />
        ) : (
          <ul className="divide-y divide-line">
            {approvals.filter((approval) => `${approval.title || ''} ${approval.requester?.first_name || ''} ${approval.requester?.last_name || ''}`.toLowerCase().includes(reviewSearch.trim().toLowerCase())).map((approval) => (
              <li key={approval.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-ink">{formatDisplayText(approval.title)}</h3>
                    <p className="mt-0.5 text-xs text-ink-muted">Event #{approval.entity_id} · {formatDisplayText(approval.requester?.first_name)} {formatDisplayText(approval.requester?.last_name)}</p>
                  </div>
                  <TableRowActions subject={formatDisplayText(approval.title)} actions={[
                    { label: selectedEventId === approval.entity_id ? 'Hide files' : 'View files', icon: Eye, onClick: () => chooseEvent(selectedEventId === approval.entity_id ? null : approval.entity_id) },
                    { label: 'Approve', icon: Check, disabled: busy || !allAccepted(filesOf(approval), marks), onClick: () => openDecision(approval, 'approve') },
                    { label: 'Reject', icon: X, danger: true, disabled: busy || missingNote(filesOf(approval), marks, notes), onClick: () => openDecision(approval, 'reject') },
                  ]} />
                </div>
                {selectedEventId === approval.entity_id && (
                  <div className="mt-3 space-y-2">
                    {filesOf(approval).length === 0
                      ? <p className="text-sm text-ink-muted-strong">No files have been submitted for this event.</p>
                      : <EventFilesReview framed={false} files={filesOf(approval)} actionable marks={marks} notes={notes} onMark={(id, value) => setMarks((current) => ({ ...current, [id]: value }))} onNote={(id, value) => setNotes((current) => ({ ...current, [id]: value }))} />}
                    {!allAccepted(filesOf(approval), marks) && <p className="text-sm text-ink-muted-strong">Accept every file to approve. Reject the event to send back a file with a note.</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!loading && approvals.length > 0 && !approvals.some((approval) => `${approval.title || ''} ${approval.requester?.first_name || ''} ${approval.requester?.last_name || ''}`.toLowerCase().includes(reviewSearch.trim().toLowerCase())) && <EmptyState kind="filtered" title="No matching event submissions" description="Try another event title or requester name." />}
      </Card>}

      <ConfirmModal
        open={Boolean(removeTarget)}
        title="Remove this requirement?"
        message="Organizations will no longer be asked for this file. A requirement that already has submitted files cannot be removed; mark it inactive instead."
        recordName={removeTarget ? formatDisplayText(removeTarget.name) : ''}
        confirmText="Remove requirement"
        busy={busy}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />

      <ConfirmModal
        open={Boolean(removeTemplateTarget)}
        title="Remove this sample template?"
        message="Organizations will no longer see the sample for this requirement. Submitted files are unaffected."
        recordName={removeTemplateTarget ? formatDisplayText(removeTemplateTarget.name) : ''}
        confirmText="Remove sample"
        busy={busy}
        onCancel={() => setRemoveTemplateTarget(null)}
        onConfirm={confirmRemoveTemplate}
      />

      <ConfirmModal
        open={decision?.action === 'approve'}
        title="Approve this event?"
        message="The organization will be notified that its event was approved by the Student Affairs Office."
        recordName={decision ? formatDisplayText(decision.approval.title) : ''}
        confirmText="Approve event"
        variant="primary"
        busy={busy}
        onCancel={closeDecision}
        onConfirm={submitDecision}
      />

      <Modal
        open={decision?.action === 'reject'}
        title="Reject this event"
        description={decision ? `${formatDisplayText(decision.approval.title)}. The organization will see your remarks.` : undefined}
        onClose={busy ? undefined : closeDecision}
        closeOnEscape={!busy}
        footer={(
          <>
            <Button variant="secondary" onClick={closeDecision} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={submitDecision} loading={busy}>Reject event</Button>
          </>
        )}
      >
        <Field label="Remarks for rejection" required error={remarksError} hint="Explain what the organization needs to change.">
          <Textarea ref={remarksRef} data-autofocus value={decisionRemarks} onChange={(event) => { setDecisionRemarks(event.target.value); setRemarksError(null); }} />
        </Field>
      </Modal>
    </div>
  );
}
