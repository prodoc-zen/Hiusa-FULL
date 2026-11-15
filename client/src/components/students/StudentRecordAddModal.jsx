import { useEffect, useState } from 'react';
import { Button, Field, Input, Select } from '../ui';
import Modal from '../Modal';
import { createStudentRegistryEntry } from '../../services/studentRegistryService';
import { getSystemColleges } from '../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../utils/apiError';

const YEAR_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8].map((year) => ({ value: String(year), label: `${year}${['st', 'nd', 'rd'][year - 1] || 'th'} Year` }));

const EMPTY = { schoolId: '', firstName: '', lastName: '', birthDate: '', program: '', yearLevel: '', section: '', collegeId: '' };

// A dean's records always belong to their own college, so the college is chosen only when no collegeId is passed (the SAO).
export default function StudentRecordAddModal({ collegeId, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [colleges, setColleges] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (collegeId) return undefined;
    let active = true;
    getSystemColleges()
      .then((rows) => { if (active) setColleges((rows || []).filter((college) => college.is_active)); })
      .catch(() => { if (active) setError('The colleges could not be loaded. Close this and try again.'); });
    return () => { active = false; };
  }, [collegeId]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const complete = /^\d{1,8}$/.test(form.schoolId.trim()) && form.firstName.trim() !== '' && form.lastName.trim() !== ''
    && form.birthDate !== '' && form.program.trim() !== '' && form.yearLevel !== '' && (Boolean(collegeId) || form.collegeId !== '');

  async function save() {
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      await createStudentRegistryEntry({
        school_id: Number(form.schoolId.trim()),
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        birth_date: form.birthDate,
        program: form.program.trim(),
        year_level: form.yearLevel,
        ...(form.section.trim() && { section: form.section.trim() }),
        ...(!collegeId && { college_id: Number(form.collegeId) }),
      });
      onSaved();
    } catch (requestError) {
      const errors = requestError?.response?.data?.errors || {};
      setFieldErrors(Object.fromEntries(Object.entries(errors).map(([key, messages]) => [key, [messages].flat()[0]])));
      setError(Object.keys(errors).length ? '' : getApiErrorMessage(requestError, 'The record could not be added.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Add a student"
      description={collegeId
        ? 'Add one student to your college records. The student can then sign up with this school ID and birth date, and you can add them to an organization.'
        : 'Add one student to the school records. The student can then sign up with this school ID and birth date.'}
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidth="max-w-lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!complete}>Add student</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="School ID" required error={fieldErrors.school_id}>
          <Input inputMode="numeric" value={form.schoolId} maxLength={8} onChange={set('schoolId')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.first_name}>
            <Input value={form.firstName} maxLength={60} onChange={set('firstName')} />
          </Field>
          <Field label="Last name" required error={fieldErrors.last_name}>
            <Input value={form.lastName} maxLength={60} onChange={set('lastName')} />
          </Field>
        </div>
        <Field label="Birth date" required error={fieldErrors.birth_date} hint="Used only to check the student when they sign up.">
          <Input type="date" value={form.birthDate} onChange={set('birthDate')} />
        </Field>
        {!collegeId && (
          <Field label="College" required error={fieldErrors.college_id}>
            <Select value={form.collegeId} onChange={set('collegeId')}>
              <option value="">Choose a college</option>
              {colleges.map((college) => <option key={college.id} value={college.id}>{college.code ? `${college.code} - ${college.name}` : college.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Program" required error={fieldErrors.program}>
          <Input value={form.program} maxLength={120} onChange={set('program')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Year level" required error={fieldErrors.year_level}>
            <Select value={form.yearLevel} onChange={set('yearLevel')}>
              <option value="">Choose a year</option>
              {YEAR_LEVELS.map((year) => <option key={year.value} value={year.value}>{year.label}</option>)}
            </Select>
          </Field>
          <Field label="Section" optional error={fieldErrors.section}>
            <Input value={form.section} maxLength={30} onChange={set('section')} />
          </Field>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
      </div>
    </Modal>
  );
}
