import { useEffect, useState } from 'react';
import { Button, Drawer, Field, Input, Select } from '../../../components/ui';
import RichTextEditor from '../../../components/RichText';
import { updateClearancePeriod } from '../../../services/clearanceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { manilaDateStamp } from '../../../utils/dateTime';
import notify from '../../../lib/notify';
import { ROLE_PRESETS } from './clearanceLabels';

export default function EditClearancePeriodDrawer({ period, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [roles, setRoles] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!period) return;
    setTitle(period.title || '');
    setDescription(period.description || '');
    setDeadline(period.deadline_at ? manilaDateStamp(new Date(period.deadline_at)) : '');
    setRoles(period.required_roles || []);
    setFieldErrors({});
    setFormError(null);
  }, [period]);

  function close() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim() || roles.length === 0) return;

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    try {
      await updateClearancePeriod(period.id, {
        title: title.trim(),
        description: description.trim(),
        deadline_at: deadline || null,
        required_roles: roles,
      });
      notify.success(`"${title.trim()}" updated.`);
      onSaved();
    } catch (err) {
      if (err.validationErrors) {
        setFieldErrors(err.validationErrors);
      } else {
        setFormError(getApiErrorMessage(err, 'This clearance period could not be saved. Try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={Boolean(period)}
      title="Edit clearance period"
      description="Roles you add get a line for every student already in the period. A role someone has signed or held cannot be removed."
      onClose={close}
      footer={(
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!title.trim() || roles.length === 0}>Save changes</Button>
        </>
      )}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Title" required error={fieldErrors.title?.[0]}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>

        <Field label="Description" optional hint="Shown to signatories.">
          <RichTextEditor ariaLabel="Clearance period description" value={description} onChange={setDescription} rows={3} />
        </Field>

        <Field label="Deadline" optional hint="Students see this on their checklist. A date in the past closes the period." error={fieldErrors.deadline_at?.[0]}>
          <Input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </Field>

        <Field label="Required signatory roles" required error={fieldErrors.required_roles?.[0]}>
          <Select multiple value={roles} onChange={(event) => setRoles(Array.from(event.target.selectedOptions, (option) => option.value))}>
            {ROLE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </Select>
        </Field>

        {formError && <p role="alert" className="text-sm font-semibold text-danger-strong">{formError}</p>}
      </form>
    </Drawer>
  );
}
