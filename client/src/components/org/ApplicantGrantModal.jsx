import { useEffect, useState } from 'react';
import { Button, Drawer } from '../ui';
import PersonPicker from '../people/PersonPicker';
import notify from '../../lib/notify';
import { allowStudentToApply, getApplicantGrants } from '../../services/applicantGrantService';
import { getApiErrorMessage } from '../../utils/apiError';

// Where the student belongs (an organization if they are in one, else their college), then the email.
// A student who already belongs to an active organization is marked, so the dean does not pick them to find out.
function describeStudent(person) {
  const place = person.blocked_by ? `Already in ${person.blocked_by.name}` : person.organizations?.[0]?.name || person.college;
  return [place, person.email].filter(Boolean).join(' · ');
}

export default function ApplicantGrantModal({ open, onClose, onGranted }) {
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (open) {
      setPerson(null);
      setError('');
      setClosed(false);
      // Only a warning: if the check fails the dean can still allow the student.
      getApplicantGrants().then(({ data }) => setClosed(data?.applications_open === false)).catch(() => {});
    }
  }, [open]);

  // The server names the active organization that stops a new application (blocked_by), by the same rule it applies when saving.
  const blocker = person?.blocked_by;
  const reason = blocker ? `${person.name} already belongs to ${blocker.name}.` : '';

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
          <Button onClick={allow} loading={busy} disabled={!person || Boolean(reason)}>Allow to apply</Button>
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
          describe={describeStudent}
          onSelect={setPerson}
        />
        {closed && <p className="rounded-control border border-warning/40 bg-warning-tint px-3 py-2 text-sm text-warning-strong">Applications are not open yet. The SAO has not opened a semester with its requirements. You can still allow this student. They can apply once it opens.</p>}
        {reason && <p role="alert" className="text-sm font-semibold text-danger-strong">{reason}</p>}
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Drawer>
  );
}
