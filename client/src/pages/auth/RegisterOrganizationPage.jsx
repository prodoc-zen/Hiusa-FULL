import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui';
import { getRegistrationColleges, submitOrganizationApplication } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';

const INITIAL = { name: '', acronym: '', college_id: '', description: '', first_name: '', last_name: '', school_id: '', email: '', position_title: '' };
const FIELDS = [['name', 'Organization name', 'text', 255], ['acronym', 'Organization code', 'text', 50], ['first_name', 'First name', 'text', 60], ['last_name', 'Last name', 'text', 60], ['school_id', 'School ID', 'number', 8], ['email', 'Email', 'email', 255], ['position_title', 'Position', 'text', 100]];

export default function RegisterOrganizationPage() {
  const [params] = useSearchParams();
  const [form, setForm] = useState(INITIAL);
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState('');
  function load() {
    setLoading(true); setError('');
    getRegistrationColleges().then((res) => setColleges(res.data)).catch((e) => setError(getApiErrorMessage(e, 'Could not load colleges.'))).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setErrors({});
    try { const res = await submitOrganizationApplication(form); setSuccess(res.data.message); }
    catch (e) { setError(getApiErrorMessage(e, 'Could not submit your application.')); setErrors(e.response?.data?.errors || {}); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-[#EEF6FB] px-4 py-8 sm:py-12"><div className="mx-auto max-w-2xl"><Link to="/" className="inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7]">Back to HIUSA</Link>
    <section className="mt-4 rounded-lg border border-[#DDE7EF] bg-white p-5 sm:p-8"><h1 className="text-2xl font-extrabold text-[#0F172A]">Register your organization</h1><p className="mt-2 text-sm leading-6 text-[#64748B]">Verify your email, receive your department head’s endorsement, then wait for SAO’s decision. When approved, you become the first administrator. If you already use HIUSA, enter the same school ID and email.</p>
      {params.get('verified') === '1' ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">Email verified. Your application is awaiting department-head endorsement. We’ll email you when its status changes.</p> : success ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">{success}</p> : <form onSubmit={submit} className="mt-6 space-y-5">
        {error && <p role="alert" className="text-sm text-red-700">{error} {colleges.length === 0 && <button type="button" onClick={load} className="font-bold underline">Retry</button>}</p>}
        <fieldset disabled={busy || loading} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Organization and applicant details</legend>
          {FIELDS.map(([key, label, type, maxLength]) => <Field key={key} label={label} required error={errors[key]?.[0]}><Input required type={type} min={type === 'number' ? 1 : undefined} max={type === 'number' ? 99999999 : undefined} maxLength={maxLength} value={form[key]} onChange={change(key)} /></Field>)}
          <Field label="College" required error={errors.college_id?.[0]}><Select required value={form.college_id} onChange={change('college_id')}><option value="">{loading ? 'Loading colleges…' : 'Select a college'}</option>{colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}</Select></Field>
          <Field label="About your organization" className="sm:col-span-2"><Textarea maxLength={3000} rows={3} value={form.description} onChange={change('description')} /></Field>
        </fieldset><Button type="submit" loading={busy} disabled={loading || !colleges.length}>Submit application</Button>
      </form>}<p className="mt-6 text-sm text-[#64748B]">Already have access? <Link to="/login" className="font-bold text-[#0878B7]">Log in</Link></p>
    </section></div></main>;
}
