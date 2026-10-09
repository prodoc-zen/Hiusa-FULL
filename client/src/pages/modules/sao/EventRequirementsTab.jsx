import { formatDisplayText } from '../../../utils/displayText.js';
import RichTextEditor, { RichTextBody } from '../../../components/RichText';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileText, Pencil, Trash2, X } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Field, IconButton, Input, Select, Textarea } from '../../../components/ui';
import Modal from '../../../components/Modal';
import ConfirmModal from '../../../components/ConfirmModal';
import { createEventRequirement, deleteEventRequirement, getEventRequirements, updateEventRequirement } from '../../../services/eventService';
import { getApprovalRequests, reviewApprovalRequest } from '../../../services/approvalService';
import EventSubmissionPanel from '../../../components/events/EventSubmissionPanel';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';
import ActiveSwitch from './ActiveSwitch';

const empty = { name: '', description: '', allowed_extensions: ['pdf'], venue_type: 'all', is_optional: false, is_active: true };
const ROW_ACTION = 'h-11! sm:h-9!';
const VENUE_TYPE_LABEL = { on_campus: 'On campus', off_campus: 'Off campus' };

export default function EventRequirementsTab() {
  const [requirements, setRequirements] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [form, setForm] = useState(empty);
  const [nameError, setNameError] = useState(null);
  const nameRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
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
      const [requirementsResponse, approvalsResponse] = await Promise.all([
        getEventRequirements(), getApprovalRequests({ entity_type: 'event', status: 'pending', per_page: 100 }),
      ]);
      setRequirements(requirementsResponse.data || []);
      setApprovals(approvalsResponse.data?.data || []);
      setLoadError('');
    } catch (cause) {
      setLoadError(getApiErrorMessage(cause, 'Could not load event requirements.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null);
    setForm(empty);
    setNameError(null);
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setNameError('Enter the name of the file organizations must submit.');
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setSaving(true);
    setActionError('');
    try {
      if (editingId) await updateEventRequirement(editingId, form);
      else await createEventRequirement(form);
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
  ];

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

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
        <Card
          title="Submission checklist"
          description="Active items require one file each. Order is shared with organizations."
          actions={<span className="text-xs font-semibold text-ink-muted">{requirements.filter((item) => item.is_active).length} active</span>}
        >
          <DataTable
            stickyHeader={false}
            columns={checklistColumns}
            rows={requirements}
            loading={loading}
            actions={(requirement) => (
              <div className="flex justify-end gap-1.5">
                <IconButton
                  icon={Pencil}
                  label={`Edit ${formatDisplayText(requirement.name)}`}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setNameError(null);
                    setEditingId(requirement.id);
                    setForm({ name: requirement.name, description: requirement.description || '', allowed_extensions: ['pdf'], venue_type: requirement.venue_type || 'all', is_optional: requirement.is_optional, is_active: requirement.is_active });
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={`Remove ${formatDisplayText(requirement.name)}`}
                  variant="danger"
                  disabled={busy}
                  onClick={() => { setActionError(''); setRemoveTarget(requirement); }}
                />
              </div>
            )}
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
            title={editingId ? 'Edit requirement' : 'Add requirement'}
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
      </section>

      <Card title="Events waiting for SAO" description="Review each event's files, then approve it or reject it with remarks.">
        {approvals.length === 0 ? (
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" className={ROW_ACTION} onClick={() => setSelectedEventId(selectedEventId === approval.entity_id ? null : approval.entity_id)}>
                      {selectedEventId === approval.entity_id ? 'Hide files' : 'View files'}
                    </Button>
                    <Button size="sm" variant="secondary" className={ROW_ACTION} leftIcon={X} disabled={busy} onClick={() => openDecision(approval, 'reject')}>Reject</Button>
                    <Button size="sm" className={ROW_ACTION} leftIcon={Check} disabled={busy} onClick={() => openDecision(approval, 'approve')}>Approve</Button>
                  </div>
                </div>
                {selectedEventId === approval.entity_id && (
                  <div className="mt-3"><EventSubmissionPanel eventId={approval.entity_id} role="SUPER_ADMIN" /></div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

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
