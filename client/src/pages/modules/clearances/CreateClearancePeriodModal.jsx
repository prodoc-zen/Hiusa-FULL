import { useEffect, useState } from 'react';
import { Button, Field, Input, Select } from '../../../components/ui';
import Modal from '../../../components/Modal';
import RichTextEditor from '../../../components/RichText';
import { createClearancePeriod } from '../../../services/clearanceService';
import { getAcademicYears } from '../../../services/systemAdministrationService';
import notify from '../../../lib/notify';
import { ROLE_PRESETS } from './clearanceLabels';

export default function CreateClearancePeriodModal({ open, onClose, onCreated }) {
  const [academicYear, setAcademicYear] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [roles, setRoles] = useState([]);
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
    setFieldErrors({});
  }

  function close() {
    if (submitting) return;
    reset();
    onClose();
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

        <Field label="Required signatory roles" required error={fieldErrors.required_roles?.[0]} hint="Organization admins or officers, the Department Head, and SAO can sign their own lines.">
          <Select multiple value={roles} onChange={(event) => setRoles(Array.from(event.target.selectedOptions, (option) => option.value))}>
            {ROLE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
