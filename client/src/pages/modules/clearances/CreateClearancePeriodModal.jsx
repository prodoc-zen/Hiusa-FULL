import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Field, Input } from '../../../components/ui';
import Modal from '../../../components/Modal';
import RichTextEditor from '../../../components/RichText';
import { createClearancePeriod } from '../../../services/clearanceService';
import { getAcademicYears } from '../../../services/systemAdministrationService';
import notify from '../../../lib/notify';
import { ROLE_PRESETS, humanizeRole, normalizeRoleInput } from './clearanceLabels';

export default function CreateClearancePeriodModal({ open, onClose, onCreated }) {
  const [academicYear, setAcademicYear] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [roles, setRoles] = useState([]);
  const [customRole, setCustomRole] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getAcademicYears()
      .then((years) => {
        const current = years.find((year) => year.is_current);
        if (!cancelled && current) setAcademicYear((value) => value || current.label);
      })
      // Prefill only; the field stays editable when the calendar cannot load.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  function reset() {
    setAcademicYear('');
    setTitle('');
    setDescription('');
    setDeadline('');
    setRoles([]);
    setCustomRole('');
    setFieldErrors({});
  }

  function close() {
    if (submitting) return;
    reset();
    onClose();
  }

  function togglePreset(value) {
    setRoles((current) => (current.includes(value) ? current.filter((role) => role !== value) : [...current, value]));
  }

  function addCustomRole() {
    const normalized = normalizeRoleInput(customRole);
    if (!normalized || roles.includes(normalized) || roles.length >= 10) return;
    setRoles((current) => [...current, normalized]);
    setCustomRole('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!academicYear.trim() || !title.trim() || roles.length === 0) return;

    setSubmitting(true);
    setFieldErrors({});
    try {
      await createClearancePeriod({
        academic_year: academicYear.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        required_roles: roles,
        deadline_at: deadline || undefined,
      });
      notify.success('Clearance period opened. Every active student now has a signature line waiting.');
      reset();
      onCreated();
    } catch (err) {
      if (err.validationErrors) {
        setFieldErrors(err.validationErrors);
      } else {
        notify.error(err.response?.data?.message || 'Could not open this clearance period. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="New clearance period"
      description="Every active student gets a pending signature line for each required role you pick below."
      onClose={close}
      closeOnBackdrop={!submitting}
      closeOnEscape={!submitting}
      footer={(
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!academicYear.trim() || !title.trim() || roles.length === 0}>Open this period</Button>
        </>
      )}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required error={fieldErrors.title?.[0]}>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Second Semester Clearance" />
          </Field>
          <Field label="Academic year" required error={fieldErrors.academic_year?.[0]}>
            <Input value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="2026-2027" />
          </Field>
        </div>

        <Field label="Description" hint="Optional context shown to signatories.">
          <RichTextEditor ariaLabel="Clearance period description" value={description} onChange={setDescription} rows={3} />
        </Field>

        <Field label="Deadline" hint="Optional. Students see this on their checklist.">
          <Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </Field>

        <Field label="Required signatory roles" required error={fieldErrors.required_roles?.[0]} hint="Every active student needs a cleared line for each role you add here.">
          <div className="flex flex-wrap gap-2">
            {ROLE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => togglePreset(preset.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors duration-150 ${roles.includes(preset.value) ? 'border-brand-600 bg-brand-50 text-navy-800' : 'border-line bg-surface text-ink-muted hover:bg-subtle'}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={customRole}
              onChange={(event) => setCustomRole(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomRole(); } }}
              placeholder="Add another role, e.g. Org Secretary"
            />
            <Button type="button" variant="secondary" onClick={addCustomRole} disabled={!customRole.trim()}>Add</Button>
          </div>
          {roles.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {roles.map((role) => (
                <li key={role} className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-ink">
                  {humanizeRole(role)}
                  <button type="button" aria-label={`Remove ${humanizeRole(role)}`} onClick={() => togglePreset(role)} className="text-ink-soft hover:text-danger-strong">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </form>
    </Modal>
  );
}
