import { Check, Clock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getApplicationTracking } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';

const STATUS = {
  pending_verification: { title: 'Verify your email', detail: 'Open the verification link we sent to your application email.', tone: 'border-green-200 bg-green-50 text-green-800' },
  expired: { title: 'Verification link expired', detail: 'The application was not verified in time. You can submit a new application.', tone: 'border-red-200 bg-red-50 text-red-800' },
  pending_endorsement: { title: 'With your Department Head', detail: 'Your Department Head is reviewing the application and its requirements.', tone: 'border-green-200 bg-green-50 text-green-800' },
  endorsed: { title: 'With SAO', detail: 'Your Department Head endorsed the application. SAO will make the final decision.', tone: 'border-green-200 bg-green-50 text-green-800' },
  approved: { title: 'Approved', detail: 'Your organization has been created. Check your email for account access details.', tone: 'border-green-200 bg-green-50 text-green-800' },
  rejected: { title: 'Returned for changes', detail: 'Read the reviewer’s remarks and use the edit link in your email to revise the application.', tone: 'border-red-200 bg-red-50 text-red-800' },
};

function dateLabel(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value)) : null;
}

function stages(application) {
  const rejected = application.status === 'rejected';
  const expired = application.status === 'expired';
  const decidedBySao = rejected && Boolean(application.endorsed_at);
  const approved = application.status === 'approved';
  const verified = Boolean(application.email_verified_at) || approved || application.status === 'endorsed' || decidedBySao;
  return [
    { title: 'Application submitted', date: application.submitted_at, state: 'done', detail: 'Your organization details and required documents were received.' },
    { title: 'Email verified', date: application.email_verified_at, state: verified ? 'done' : expired ? 'stopped' : 'current',
      detail: verified ? 'Your email is confirmed. The application can proceed to review.' : expired ? 'Email verification expired. Start a new application from the link below.' : 'Open the verification link sent to your email to continue.' },
    { title: 'Department Head review', date: application.endorsed_at || (!decidedBySao && rejected ? application.reviewed_at : null),
      state: application.endorsed_at || approved ? 'done' : rejected ? 'stopped' : application.status === 'pending_endorsement' ? 'current' : 'waiting',
      detail: application.endorsed_at || approved ? 'Your Department Head endorsed the application and forwarded it to SAO.' : rejected && !decidedBySao ? 'Your Department Head returned the application. Revise it using the edit link in your email.' : application.status === 'pending_endorsement' ? 'Your college Department Head is checking the organization details and submitted requirements.' : 'This review begins after your email is verified.' },
    { title: 'SAO decision', date: approved || decidedBySao ? application.reviewed_at : null,
      state: approved ? 'done' : decidedBySao ? 'stopped' : application.status === 'endorsed' ? 'current' : 'waiting',
      detail: approved ? 'SAO approved your organization. Check your email for account access instructions.' : decidedBySao ? 'SAO returned the application. Revise it and resubmit for Department Head endorsement.' : application.status === 'endorsed' ? 'SAO is reviewing the endorsed application and requirements for a final decision.' : 'SAO reviews the application after Department Head endorsement.' },
  ];
}

function expiredLabel(application, index) {
  return application.status === 'expired' && index === 1 ? 'Verification expired' : 'Returned for changes';
}

export default function TrackOrganizationPage() {
  const { applicationId } = useParams();
  const [params] = useSearchParams();
  const query = params.toString();
  const [application, setApplication] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getApplicationTracking(applicationId, query)
      .then((response) => { if (active) setApplication(response.data.application); })
      .catch((cause) => { if (active) setError([403, 404].includes(cause.response?.status)
        ? 'This tracking link has expired or is unavailable. Request a new link using your application details.'
        : getApiErrorMessage(cause, 'Could not load your application status.')); });
    return () => { active = false; };
  }, [applicationId, query]);

  const current = application ? STATUS[application.status] : null;

  return <main className="min-h-screen bg-[#EEF6FB] px-4 py-8 sm:py-12"><div className="mx-auto max-w-2xl">
    <Link to="/" className="inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7]">Back to HIUSA</Link>
    <section className="mt-4 rounded-lg border border-[#DDE7EF] bg-white p-5 sm:p-8">
      <h1 className="text-2xl font-extrabold text-[#0F172A]">Application status</h1>
      {error ? <div role="alert" className="mt-5 text-sm text-red-700"><p>{error}</p><Link to="/track-organization" className="mt-2 inline-flex min-h-11 items-center font-bold text-[#0878B7] underline underline-offset-2">Request a new tracking link</Link></div>
        : !application ? <p role="status" className="mt-5 text-sm text-[#475569]">Loading your application…</p>
          : <>
            <p className="mt-2 text-sm text-[#475569]">{application.name} · {application.college}</p>
            <div className={`mt-6 rounded-lg border p-4 ${current?.tone || 'border-[#DDE7EF] bg-[#EEF6FB] text-[#0F2F62]'}`}>
              <p className="text-base font-bold">{current?.title || 'In review'}</p>
              <p className="mt-1 text-sm leading-6">{current?.detail || 'Check your email for the latest update.'}</p>
            </div>
            {application.status === 'rejected' && application.remarks && <section aria-label="Reviewer remarks" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3"><h2 className="text-sm font-bold text-[#0F172A]">What needs fixing</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#475569]">{application.remarks}</p></section>}
            <h2 className="mt-8 text-base font-bold text-[#0F172A]">Review progress</h2>
            <ol className="mt-3 divide-y divide-[#DDE7EF] border-y border-[#DDE7EF]">{stages(application).map((stage, index) => {
              const Icon = stage.state === 'done' ? Check : stage.state === 'stopped' ? X : Clock;
              return <li key={stage.title} aria-current={stage.state === 'current' ? 'step' : undefined} className="flex items-start gap-4 py-4">
                <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${stage.state === 'done' ? 'bg-green-100 text-green-800' : stage.state === 'current' ? 'bg-[#EEF6FB] text-[#0F2F62]' : stage.state === 'stopped' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'}`}><Icon size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[#0F172A]">{stage.title}</h3><span className={`text-xs font-semibold ${stage.state === 'done' ? 'text-green-800' : stage.state === 'stopped' ? 'text-red-800' : 'text-[#475569]'}`}>{stage.state === 'done' ? 'Completed' : stage.state === 'stopped' ? expiredLabel(application, index) : stage.state === 'current' ? 'In progress' : 'Waiting'}</span></div>
                  <p className="mt-2 text-sm leading-6 text-[#475569]">{stage.detail}</p>
                  {stage.date && <time dateTime={stage.date} className="mt-2 block text-xs text-[#475569]">{dateLabel(stage.date)} (Philippine time)</time>}
                </div>
              </li>;
            })}</ol>
            {application.status === 'rejected' && <Link to="/register-organization/edit-link" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7] underline underline-offset-2">Lost the edit link? Request another</Link>}
            {application.status === 'expired' && <Link to="/register-organization" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7] underline underline-offset-2">Start a new application</Link>}
          </>}
    </section>
  </div></main>;
}
