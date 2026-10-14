import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui';
import { getApplicationRequirements, getRegistrationColleges, getRejectedApplication, resubmitRejectedApplication, submitOrganizationApplication } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';
import { fileAccept, fileTypesLabel, validateRequirementFile } from '../../utils/requirementFiles';
import { openRequirementSample } from '../../utils/requirementSample';
import { openProtectedFile } from '../../utils/openProtectedFile';

const INITIAL = { name: '', acronym: '', college_id: '', description: '', first_name: '', last_name: '', school_id: '', email: '', position_title: '' };
const FIELDS = [['name', 'Organization name', 'text', 255], ['acronym', 'Organization code', 'text', 50], ['first_name', 'First name', 'text', 60], ['last_name', 'Last name', 'text', 60], ['school_id', 'School ID', 'number', 8], ['email', 'Email', 'email', 255], ['position_title', 'Position', 'text', 100]];
const NO_REQUIREMENTS = 'No registration requirements are open. The SAO must activate a semester first.';

export default function RegisterOrganizationPage() {
  const [params] = useSearchParams();
  const { applicationId } = useParams();
  const editing = Boolean(applicationId);
  const linkQuery = params.toString();
  const [form, setForm] = useState(INITIAL);
  const [applicant, setApplicant] = useState(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [colleges, setColleges] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [semester, setSemester] = useState(null);
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([getRegistrationColleges(), editing ? getRejectedApplication(applicationId, linkQuery) : getApplicationRequirements()])
      .then(([collegeResponse, requirementResponse]) => {
        setColleges(collegeResponse.data);
        setRequirements(requirementResponse.data.requirements || []);
        setSemester(requirementResponse.data.academic_semester);
        if (editing) {
          const application = requirementResponse.data.application;
          setForm(Object.fromEntries(Object.keys(INITIAL).map((key) => [key, application[key] ?? ''])));
          setApplicant({ school_id: application.school_id, email: application.email });
          setReviewRemarks(application.remarks || '');
        }
      })
      .catch((e) => setError(editing && [403, 404].includes(e.response?.status)
        ? 'This edit link has expired or is no longer available. Request a new link if your application is still rejected.'
        : getApiErrorMessage(e, 'Could not load registration details.')))
      .finally(() => setLoading(false));
  }, [applicationId, editing, linkQuery]);

  useEffect(() => { load(); }, [load]);

  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function chooseFile(id, file) {
    const problem = file ? validateRequirementFile(file, requirements.find((item) => item.id === id)?.allowed_extensions) : null;
    setErrors((current) => ({ ...current, [`files.${id}`]: problem ? [problem] : undefined }));
    setFiles((current) => ({ ...current, [id]: problem ? undefined : file }));
  }

  async function viewSample(requirement) {
    try {
      await openRequirementSample(requirement, { publicRegistration: true });
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not open the sample file.'));
    }
  }

  async function viewSubmittedFile(requirement) {
    try {
      await openProtectedFile(requirement.current_file.view_url);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Could not open the submitted file.'));
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const res = editing
        ? await resubmitRejectedApplication(applicationId, linkQuery, Object.fromEntries(Object.entries(form).filter(([key]) => !['school_id', 'email'].includes(key))), files)
        : await submitOrganizationApplication(form, files);
      setSuccess(res.data.message);
    } catch (e) {
      setError(getApiErrorMessage(e, 'Could not submit your application.'));
      setErrors(e.response?.data?.errors || {});
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-[#EEF6FB] px-4 py-8 sm:py-12"><div className="mx-auto max-w-2xl">
    <Link to="/" className="inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7]">Back to HIUSA</Link>
    <section className="mt-4 rounded-lg border border-[#DDE7EF] bg-white p-5 sm:p-8">
      <h1 className="text-2xl font-extrabold text-[#0F172A]">{editing ? 'Edit your application' : 'Register your organization'}</h1>
      <p className="mt-2 text-sm leading-6 text-[#475569]">{editing ? 'Update the details or documents named in the review. Your existing files stay attached unless you replace them. Resubmission returns to your Department Head for endorsement.' : "Submit your organization's details and SAO-required documents. Verify your email, receive your Department Head's endorsement, then wait for SAO's decision. If approved, you become the first administrator."}</p>
      {!editing && params.get('verified') === '1' ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">Email verified. Your application is awaiting Department Head endorsement. We'll email you when its status changes.</p> : success ? <p role="status" className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-green-800">{success}</p> : <form onSubmit={submit} className="mt-6 space-y-5">
        {error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" onClick={load} className="font-bold underline">Reload requirements</button>{editing && <> <Link to="/register-organization/edit-link" className="font-bold underline">Request a new edit link</Link></>}</p>}
        {editing && reviewRemarks && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-[#0F172A]"><p className="font-bold">What needs fixing</p><p className="mt-1 whitespace-pre-wrap leading-6">{reviewRemarks}</p></div>}
        {editing && applicant && <div className="grid gap-3 rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 text-sm sm:grid-cols-2"><div><p className="font-semibold text-[#475569]">School ID</p><p className="mt-1 font-bold text-[#0F172A]">{applicant.school_id}</p></div><div><p className="font-semibold text-[#475569]">Verified email</p><p className="mt-1 break-all font-bold text-[#0F172A]">{applicant.email}</p></div></div>}
        {!loading && !error && requirements.length === 0 && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{NO_REQUIREMENTS}</p>}
        {requirements.length > 0 && <>
          <fieldset disabled={busy || loading} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Organization and applicant details</legend>
            {FIELDS.filter(([key]) => !editing || !['school_id', 'email'].includes(key)).map(([key, label, type, maxLength]) => <Field key={key} label={label} required error={errors[key]?.[0]}><Input required type={type} min={type === 'number' ? 1 : undefined} max={type === 'number' ? 99999999 : undefined} maxLength={maxLength} value={form[key]} onChange={change(key)} /></Field>)}
            <Field label="College" required error={errors.college_id?.[0]}><Select required value={form.college_id} onChange={change('college_id')}><option value="">Select a college</option>{colleges.map((college) => <option key={college.id} value={college.id}>{college.name}</option>)}</Select></Field>
            <Field label="About your organization" className="sm:col-span-2"><Textarea maxLength={3000} rows={3} value={form.description} onChange={change('description')} /></Field>
          </fieldset>
          <fieldset disabled={busy} className="space-y-4 border-t border-[#DDE7EF] pt-5">
            <legend className="text-base font-bold text-[#0B1831]">Registration requirements</legend>
            <p className="text-sm text-[#475569]">Academic year {semester?.academic_year}, semester {semester?.number}. {editing ? 'Keep an existing file or upload a replacement for each requirement.' : 'Attach one file for each SAO requirement, up to 10 MB per file.'}</p>
            {requirements.map((requirement) => <div key={requirement.id}>
              <label htmlFor={`requirement-${requirement.id}`} className="mb-1 block text-sm font-semibold text-[#0F172A]">{requirement.name} <span aria-hidden="true">*</span></label>
              {requirement.description && <p className="mb-2 text-xs text-[#475569]">{requirement.description}</p>}
              <p className="mb-2 text-xs text-[#475569]">Accepted: {fileTypesLabel(requirement.allowed_extensions)}</p>
              {(requirement.template_url || requirement.template_original_name) && <button type="button" onClick={() => viewSample(requirement)} className="mb-2 block min-h-11 text-sm font-semibold text-[#0878B7] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">View sample format</button>}
              {requirement.current_file && <p className="mb-2 text-sm text-[#475569]">Current file: <button type="button" onClick={() => viewSubmittedFile(requirement)} className="min-h-11 font-semibold text-[#0878B7] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">View {requirement.current_file.name}</button></p>}
              <input id={`requirement-${requirement.id}`} type="file" accept={fileAccept(requirement.allowed_extensions)} required={!editing || !requirement.current_file} aria-invalid={Boolean(errors[`files.${requirement.id}`])} aria-describedby={errors[`files.${requirement.id}`] ? `requirement-error-${requirement.id}` : undefined} onChange={(event) => chooseFile(requirement.id, event.target.files?.[0])} className="block min-h-11 w-full rounded-lg border border-[#DDE7EF] bg-white p-2 text-sm text-[#0F172A] file:mr-3 file:rounded file:border-0 file:bg-[#EEF6FB] file:px-3 file:py-1 file:font-semibold file:text-[#0878B7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]" />
              {errors[`files.${requirement.id}`]?.[0] && <p id={`requirement-error-${requirement.id}`} className="mt-1 text-xs text-red-700">{errors[`files.${requirement.id}`][0]}</p>}
            </div>)}
          </fieldset>
          <Button type="submit" loading={busy} disabled={loading || !colleges.length}>{editing ? 'Resubmit application' : 'Submit application'}</Button>
        </>}
      </form>}
      <p className="mt-6 text-sm text-[#475569]">Already have access? <Link to="/login" className="font-bold text-[#0878B7]">Log in</Link></p>
      {!editing && <p className="mt-3 text-sm text-[#475569]">Application rejected or lost the email? <Link to="/register-organization/edit-link" className="font-bold text-[#0878B7] underline underline-offset-2">Request an edit link</Link></p>}
      {!editing && <p className="mt-3 text-sm text-[#475569]">Already applied? <Link to="/track-organization" className="font-bold text-[#0878B7] underline underline-offset-2">Track your application</Link></p>}
    </section>
  </div></main>;
}
