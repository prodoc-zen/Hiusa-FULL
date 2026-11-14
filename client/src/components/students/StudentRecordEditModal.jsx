import { useState } from 'react';
import { Button, Field, Input } from '../ui';
import Modal from '../Modal';
import { updateStudentRegistryEntry } from '../../services/studentRegistryService';
import { getApiErrorMessage } from '../../utils/apiError';

// A dean is never sent the birth dates, so a blank birth date means "keep the one on record".
export default function StudentRecordEditModal({ record, onClose, onSaved }) {
  const birthDateKnown = 'birth_date' in record;
  const [firstName, setFirstName] = useState(record.first_name || '');
  const [lastName, setLastName] = useState(record.last_name || '');
  const [birthDate, setBirthDate] = useState(record.birth_date || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const changed = firstName !== (record.first_name || '') || lastName !== (record.last_name || '') || birthDate !== (record.birth_date || '');
  const complete = firstName.trim() !== '' && lastName.trim() !== '';

  async function save() {
    setSaving(true);
    setError('');
    try {
      await updateStudentRegistryEntry(record.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        ...(birthDate && { birth_date: birthDate }),
      });
      onSaved();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The record could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Correct this record"
      description={`School ID ${record.school_id}. The ID and the type of record cannot be changed here.`}
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidth="max-w-md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!changed || !complete}>Save changes</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="First name" required>
          <Input value={firstName} maxLength={60} onChange={(event) => setFirstName(event.target.value)} />
        </Field>
        <Field label="Last name" required>
          <Input value={lastName} maxLength={60} onChange={(event) => setLastName(event.target.value)} />
        </Field>
        <Field label="Birth date" hint={birthDateKnown ? undefined : 'Leave blank to keep the birth date on record.'}>
          <Input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Modal>
  );
}
