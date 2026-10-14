import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui';
import { requestApplicationEditLink, requestApplicationTrackingLink } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';

export default function RequestApplicationEditLinkPage({ tracking = false }) {
  const [details, setDetails] = useState({ school_id: '', email: '', organization_name: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const response = await (tracking ? requestApplicationTrackingLink(details) : requestApplicationEditLink(details));
      setMessage(response.data.message);
    } catch (cause) {
      setError(getApiErrorMessage(cause, `Could not request a ${tracking ? 'tracking' : 'edit'} link. Try again.`));
      setErrors(cause.response?.data?.errors || {});
    } finally {
      setBusy(false);
    }
  }

  const change = (key) => (event) => setDetails((current) => ({ ...current, [key]: event.target.value }));

  return <main className="min-h-screen bg-[#EEF6FB] px-4 py-8 sm:py-12"><div className="mx-auto max-w-lg">
    <Link to={tracking ? '/' : '/register-organization'} className="inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7]">Back to {tracking ? 'HIUSA' : 'registration'}</Link>
    <section className="mt-4 rounded-lg border border-[#DDE7EF] bg-white p-5 sm:p-8">
      <h1 className="text-2xl font-extrabold text-[#0F172A]">{tracking ? 'Track your application' : 'Get a new edit link'}</h1>
      <p className="mt-2 text-sm leading-6 text-[#475569]">{tracking ? 'Enter the details you used to apply. We’ll send a private status link to the application email address.' : 'If your organization application was rejected, enter the details you used to apply. We’ll send a private link to the verified email address.'}</p>
      {message ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">{message}</p> : <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Field label="School ID" required error={errors.school_id?.[0]}><Input required type="number" min={1} max={99999999} value={details.school_id} onChange={change('school_id')} /></Field>
        <Field label="Email" required error={errors.email?.[0]}><Input required type="email" autoComplete="email" value={details.email} onChange={change('email')} /></Field>
        <Field label="Organization name" required error={errors.organization_name?.[0]}><Input required maxLength={255} value={details.organization_name} onChange={change('organization_name')} /></Field>
        <Button type="submit" loading={busy}>Email {tracking ? 'tracking' : 'edit'} link</Button>
      </form>}
    </section>
  </div></main>;
}
