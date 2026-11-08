import { useEffect, useState } from 'react';
import { Button, Drawer } from '../ui';
import PersonPicker from '../people/PersonPicker';
import notify from '../../lib/notify';
import { allowStudentToApply } from '../../services/applicantGrantService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function ApplicantGrantModal({ open, onClose, onGranted }) {
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setPerson(null);
      setError('');
    }
  }, [open]);

  async function allow() {
    setBusy(true);
    setError('');
    try {
      const { data } = await allowStudentToApply(person.school_id);
      notify.success(`${person.name} can now apply for an organization.`);
      onGranted?.(data);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save this. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Allow a student to apply"
      description="They will see Apply for an organization in their menu. One permission covers one application."
      onClose={busy ? undefined : onClose}
      width="max-w-lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={allow} loading={busy} disabled={!person}>Allow to apply</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <PersonPicker
          label="Student"
          scope="college"
          role="STUDENT"
          placeholder="Type the student's name or email"
          hint="Only students of your college can be picked."
          value={person}
          onSelect={setPerson}
        />
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Drawer>
  );
}
