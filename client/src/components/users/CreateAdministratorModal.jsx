import { useEffect, useId, useState } from 'react';
import Modal from '../Modal';
import { Button, Field, Input, Select } from '../ui';
import { getProfileOrganizations } from '../../services/authService';
import { createSystemAdmin } from '../../services/systemAdministrationService';
import { unwrapList } from '../../services/pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatDisplayText } from '../../utils/displayText';

export default function CreateAdministratorModal({ organization = null, onClose, onCreated, onUseExisting }) {
  const formId = useId();
  const [organizations, setOrganizations] = useState(organization ? [organization] : []);
  const [loading, setLoading] = useState(!organization);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [form, setForm] = useState({ organization_id: organization ? String(organization.id) : '', school_id: '', first_name: '', last_name: '', email: '', position_title: '', password: '', password_confirmation: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (organization) return undefined;
    let current = true;
    getProfileOrganizations().then((response) => {
      if (current) { setOrganizations(unwrapList(response.data)); setLoadError(''); }
    }).catch((cause) => { if (current) setLoadError(getApiErrorMessage(cause, 'Could not load organizations.')); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [organization, retry]);

  const change = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setError('');
  };

  async function save(event) {
    event.preventDefault();
    if (busy || loading || loadError) return;
    if (form.password !== form.password_confirmation) {
      setErrors({ password_confirmation: ['Passwords must match.'] });
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const user = await createSystemAdmin({ ...form, organization_id: Number(form.organization_id), school_id: Number(form.school_id), first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim().toLowerCase(), position_title: form.position_title.trim() || null });
      onCreated?.(user);
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not create this administrator.'));
      setErrors(cause.response?.data?.errors || {});
    } finally { setBusy(false); }
  }

  return <Modal open title="Add administrator" description="Create an Admin login for an active student organization. The administrator must change the initial password after signing in." onClose={busy ? undefined : onClose} closeOnEscape={!busy}
    footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={formId} loading={busy} disabled={loading || Boolean(loadError) || !form.organization_id}>Create administrator</Button></>}>
    <form id={formId} onSubmit={save} className="space-y-4">
      {onUseExisting && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle p-3"><p className="text-sm text-ink-muted">Already has a university login?</p><Button variant="secondary" size="sm" disabled={busy} onClick={onUseExisting}>Use existing user</Button></div>}
      {organization ? <p className="text-sm font-semibold text-ink">{formatDisplayText(organization.name)}</p> : <Field label="Organization" required error={errors.organization_id?.[0]}><Select required value={form.organization_id} onChange={change('organization_id')} disabled={busy || loading || Boolean(loadError)}><option value="">{loading ? 'Loading organizations...' : 'Choose an organization'}</option>{organizations.map((item) => <option key={item.id} value={item.id}>{formatDisplayText(item.name)}</option>)}</Select></Field>}
      {!organization && !loading && !loadError && organizations.length === 0 && <p role="status" className="text-sm text-ink-muted">No active student organizations are available. Approve or restore an organization before adding its administrator.</p>}
      {loadError && <p role="alert" className="text-sm text-danger-strong">{loadError} <Button variant="secondary" size="sm" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>Retry</Button></p>}
      {error && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School ID" required error={errors.school_id?.[0]}><Input required type="number" min="1" max="99999999" value={form.school_id} onChange={change('school_id')} disabled={busy} /></Field>
        <Field label="Email" required error={errors.email?.[0]}><Input required type="email" maxLength={255} value={form.email} onChange={change('email')} disabled={busy} /></Field>
        <Field label="First name" required error={errors.first_name?.[0]}><Input required maxLength={60} value={form.first_name} onChange={change('first_name')} disabled={busy} /></Field>
        <Field label="Last name" required error={errors.last_name?.[0]}><Input required maxLength={60} value={form.last_name} onChange={change('last_name')} disabled={busy} /></Field>
      </div>
      <Field label="Position title" error={errors.position_title?.[0]}><Input maxLength={100} value={form.position_title} onChange={change('position_title')} disabled={busy} placeholder="President or adviser" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Initial password" required error={errors.password?.[0]}><Input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={form.password} onChange={change('password')} disabled={busy} /></Field>
        <Field label="Confirm initial password" required error={errors.password_confirmation?.[0]}><Input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={form.password_confirmation} onChange={change('password_confirmation')} disabled={busy} /></Field>
      </div>
    </form>
  </Modal>;
}
