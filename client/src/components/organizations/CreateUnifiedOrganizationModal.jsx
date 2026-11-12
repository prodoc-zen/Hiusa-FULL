import { useId, useState } from 'react';
import { Button, Drawer, Field, Input, Textarea } from '../ui';
import { createUnifiedOrganization } from '../../services/systemAdministrationService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function CreateUnifiedOrganizationModal({ onClose, onCreated }) {
  const formId = useId();
  const [form, setForm] = useState({ name: '', acronym: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const change = (key) => (event) => { setForm((value) => ({ ...value, [key]: event.target.value })); setErrors((value) => ({ ...value, [key]: undefined })); };
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setErrors({});
    try {
      onCreated(await createUnifiedOrganization({ name: form.name.trim(), acronym: form.acronym.trim(), description: form.description.trim() || null }));
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not create this organization.'));
      setErrors(cause.response?.data?.errors || {});
    } finally { setBusy(false); }
  }
  return <Drawer open title="Add unified organization" description="Open to students from every college. It has no dean, so you name its Admin next." onClose={busy ? undefined : onClose} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" form={formId} loading={busy}>Create organization</Button></>}>
    <form id={formId} onSubmit={save} className="space-y-4">
      <Field label="Organization name" required error={errors.name?.[0]}><Input required data-autofocus maxLength={255} value={form.name} onChange={change('name')} disabled={busy} /></Field>
      <Field label="Acronym" required error={errors.acronym?.[0]}><Input required maxLength={50} value={form.acronym} onChange={change('acronym')} disabled={busy} /></Field>
      <Field label="Description" optional error={errors.description?.[0]}><Textarea rows={4} maxLength={3000} value={form.description} onChange={change('description')} disabled={busy} /></Field>
      {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
    </form>
  </Drawer>;
}
