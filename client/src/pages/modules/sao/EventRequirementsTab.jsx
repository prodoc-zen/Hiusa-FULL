import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, FileText, Pencil, Trash2, X } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, Input, Select, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import { createEventRequirement, deleteEventRequirement, getEventRequirements, removeEventRequirementTemplate, setEventRequirementTemplateLink, updateEventRequirement, uploadEventRequirementTemplate } from '../../../services/eventService';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import EventSubmissionPanel from '../../../components/events/EventSubmissionPanel';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';
import ActiveSwitch from './ActiveSwitch';
import { openProtectedFile } from '../../../utils/openProtectedFile';
import TableRowActions from '../../../components/TableRowActions';

const empty = { name: '', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, is_active: true };
const ROW_ACTION = 'h-11! sm:h-9!';
const VENUE_TYPE_LABEL = { on_campus: 'On campus', off_campus: 'Off campus' };

export default function EventRequirementsTab({ mode = 'settings' }) {
  const [requirements, setRequirements] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [form, setForm] = useState(empty);
  const [nameError, setNameError] = useState(null);
  const nameRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeTemplateTarget, setRemoveTemplateTarget] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [sampleMode, setSampleMode] = useState('none');
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'reviews') {
        const response = await getApprovalRequests({ entity_type: 'event', status: 'pending', per_page: 100 });
        setApprovals(response.data?.data || []);
      } else {
        const response = await getEventRequirements();
        setRequirements(response.data || []);
      }
      setLoadError('');
    } catch (cause) {
      setLoadError(getApiErrorMessage(cause, mode === 'reviews' ? 'Could not load events waiting for SAO.' : 'Could not load event requirements.'));
    } finally {
      setLoading(false);
    }
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null);
    setForm(empty);
    setNameError(null);
    setTemplateFile(null);
    setSampleMode('none');
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
      return;
    }
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
      const response = editingId ? await updateEventRequirement(editingId, form) : await createEventRequirement(form);
      const sampleChanged = (sampleMode === 'file' && templateFile) || sampleMode === 'link' || (sampleMode === 'none' && (editingRequirement?.template_original_name || editingRequirement?.template_url));
      if (sampleChanged) {
        try {
          if (sampleMode === 'file') await uploadEventRequirementTemplate(response.data.id, templateFile);
          else if (sampleMode === 'link') await setEventRequirementTemplateLink(response.data.id, sampleUrl.trim());
          else await removeEventRequirementTemplate(response.data.id);
        } catch (cause) {
          setEditingId(response.data.id);
          setActionError(`Requirement saved, but the sample was not updated. ${getApiErrorMessage(cause, 'Try saving it again.')}`);
          await load();
          return;
        }
      }
      notify.success(editingId ? 'Requirement updated.' : 'Requirement added.');
      resetForm();
      await load();
    } catch (cause) {
      setActionError(getApiErrorMessage(cause, 'Could not save the requirement.'));
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
      setSampleMode('none');
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
      await reviewApprovalRequest(approval.id, { status, remarks: decisionRemarks.trim() || undefined });
      setSelectedEventId(null);
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

  const checklistColumns = [
    { key: 'order', header: '#', render: (requirement) => requirements.indexOf(requirement) + 1 },
    {
      key: 'name',
      header: 'File',
      render: (requirement) => (
        <div className="min-w-0 text-left">
          <p className="break-words font-bold text-ink">{formatDisplayText(requirement.name)}</p>
          {requirement.description && <RichTextBody value={requirement.description} className="mt-1 break-words text-xs font-medium text-ink-muted" />}
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (requirement) => `PDF · ${VENUE_TYPE_LABEL[requirement.venue_type] || 'All venues'} · ${requirement.is_active ? (requirement.is_optional ? 'If applicable' : 'Required') : 'Inactive'}`,
    },
    { key: 'template', header: 'Sample', render: (requirement) => requirement.template_url
      ? <span className="text-ink-muted">Link</span>
      : requirement.template_original_name ? <span className="text-ink-muted">PDF file</span> : <span className="text-ink-muted">None</span> },
  ];
  const editingRequirement = requirements.find((item) => item.id === editingId);

  return (
    <div className="space-y-5">
      {loadError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">
          {loadError}
          <Button variant="secondary" size="sm" className={ROW_ACTION} onClick={load}>Retry</Button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm font-semibold text-danger-strong">{actionError}</p>
      )}

      {mode === 'settings' && <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
        <Card
          title="Event requirements"
          description="Active items require one file each. Order is shared with organizations."
          actions={<span className="text-xs font-semibold text-ink-muted">{requirements.filter((item) => item.is_active).length} active</span>}
        >
          <DataTable
            stickyHeader={false}
            columns={checklistColumns}
            rows={requirements}
            loading={loading}
            actions={(requirement) => <TableRowActions subject={formatDisplayText(requirement.name)} actions={[
              (requirement.template_url || requirement.template_original_name) && { label: 'View sample', icon: Eye, onClick: () => viewTemplate(requirement) },
              { label: 'Edit requirement', icon: Pencil, disabled: busy, onClick: () => {
                    setNameError(null);
                    setEditingId(requirement.id);
                    setForm({ name: requirement.name, description: requirement.description || '', allowed_extensions: ['pdf'], venue_type: requirement.venue_type || 'all', is_optional: requirement.is_optional, is_active: requirement.is_active });
                    setSampleMode(requirement.template_url ? 'link' : requirement.template_original_name ? 'file' : 'none');
                    setSampleUrl(requirement.template_url || '');
                    setTemplateFile(null);
                    setTemplateError(null);
                    if (templateInputRef.current) templateInputRef.current.value = '';
                  } },
              { label: 'Remove requirement', icon: Trash2, danger: true, disabled: busy, onClick: () => { setActionError(''); setRemoveTarget(requirement); } },
            ]} />}
            emptyState={loadError ? <div /> : (
              <EmptyState
                kind="first-run"
                icon={FileText}
                title="No files required yet"
                description="Add the first checklist item."
              />
            )}
          />
        </Card>

        <form onSubmit={save} noValidate className="h-fit">
          <Card
            title={editingId ? 'Edit event requirement' : 'Add event requirement'}
            description="Each active item needs one file for an event submission."
          >
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
              <Field label="Instructions for organizations">
                <RichTextEditor maxLength={500} rows={3} value={form.description} onChange={(description) => setForm({ ...form, description })} />
              </Field>
              <p className="text-xs font-semibold text-ink-muted">Accepted file type: PDF</p>
              <Field label="Sample format" hint="Optional. Organizations can open the sample before submitting or when correcting a returned file.">
                <Select value={sampleMode} onChange={(event) => { setSampleMode(event.target.value); setTemplateError(null); }}>
                  <option value="none">No sample</option>
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
                  <Button type="button" size="sm" variant="secondary" onClick={() => setRemoveTemplateTarget(editingRequirement)}>Remove sample</Button>
                </div>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={form.is_optional} onChange={(event) => setForm({ ...form, is_optional: event.target.checked })} />
                Only if applicable
              </label>
              <ActiveSwitch label="Active requirement" checked={form.is_active} onChange={(isActive) => setForm({ ...form, is_active: isActive })} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" leftIcon={Check} loading={saving} disabled={busy || !form.allowed_extensions.length}>{editingId ? 'Save changes' : 'Add requirement'}</Button>
                {editingId && <Button variant="secondary" onClick={resetForm}>Cancel</Button>}
              </div>
            </div>
          </Card>
        </form>
      </section>}

      {mode === 'reviews' && <Card title="Events waiting for SAO" description="Review each event's files, then approve it or reject it with remarks.">
        {loading ? <p role="status" className="text-sm text-ink-muted">Loading events for review…</p> : approvals.length === 0 ? (
          !loadError && <EmptyState kind="first-run" icon={FileText} title="No event submissions are waiting for review." />
        ) : (
          <ul className="divide-y divide-line">
            {approvals.map((approval) => (
              <li key={approval.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-bold text-ink">{formatDisplayText(approval.title)}</h3>
                    <p className="mt-0.5 text-xs font-medium text-ink-muted">Event #{approval.entity_id} · {formatDisplayText(approval.requester?.first_name)} {formatDisplayText(approval.requester?.last_name)}</p>
                  </div>
                  <TableRowActions subject={formatDisplayText(approval.title)} actions={[
                    { label: selectedEventId === approval.entity_id ? 'Hide files' : 'View files', icon: Eye, onClick: () => setSelectedEventId(selectedEventId === approval.entity_id ? null : approval.entity_id) },
                    { label: 'Approve', icon: Check, disabled: busy, onClick: () => openDecision(approval, 'approve') },
                    { label: 'Reject', icon: X, danger: true, disabled: busy, onClick: () => openDecision(approval, 'reject') },
                  ]} />
                </div>
                {selectedEventId === approval.entity_id && (
                  <div className="mt-3"><EventSubmissionPanel eventId={approval.entity_id} role="SUPER_ADMIN" /></div>
                )}
              </li>
            ))}
          </ul>
        )}
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
