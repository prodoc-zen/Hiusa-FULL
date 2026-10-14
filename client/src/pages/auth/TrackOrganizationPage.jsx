import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getApplicationTracking } from '../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../utils/apiError';

const STATUS = {
  pending_verification: { title: 'Verify your email', detail: 'Open the verification link we sent to your application email.', tone: 'border-[#DDE7EF] bg-[#EEF6FB] text-[#0F2F62]' },
  expired: { title: 'Verification link expired', detail: 'The application was not verified in time. You can submit a new application.', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  pending_endorsement: { title: 'With your Department Head', detail: 'Your Department Head is reviewing the application and its requirements.', tone: 'border-[#DDE7EF] bg-[#EEF6FB] text-[#0F2F62]' },
  endorsed: { title: 'With SAO', detail: 'Your Department Head endorsed the application. SAO will make the final decision.', tone: 'border-[#DDE7EF] bg-[#EEF6FB] text-[#0F2F62]' },
  approved: { title: 'Approved', detail: 'Your organization has been created. Check your email for account access details.', tone: 'border-green-200 bg-green-50 text-green-800' },
  rejected: { title: 'Returned for changes', detail: 'Read the reviewer’s remarks and use the edit link in your email to revise the application.', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
};

function dateLabel(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : null;
}

function stages(application) {
  const decidedBySao = application.status === 'rejected' && Boolean(application.endorsed_at);
  const approved = application.status === 'approved';
  const verified = Boolean(application.email_verified_at) || approved || application.status === 'endorsed' || decidedBySao;
  return [
    { title: 'Application submitted', date: application.submitted_at, state: 'done' },
    { title: 'Email verified', date: application.email_verified_at, state: verified ? 'done' : application.status === 'expired' ? 'stopped' : 'current' },
    { title: 'Department Head review', date: application.endorsed_at || (!decidedBySao && application.status === 'rejected' ? application.reviewed_at : null), state: application.endorsed_at || approved ? 'done' : application.status === 'rejected' ? 'stopped' : application.status === 'pending_endorsement' ? 'current' : 'waiting' },
    { title: 'SAO decision', date: approved || decidedBySao ? application.reviewed_at : null, state: approved ? 'done' : decidedBySao ? 'stopped' : application.status === 'endorsed' ? 'current' : 'waiting' },
  ];
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
            {application.status === 'rejected' && application.remarks && <section aria-label="Reviewer remarks" className="mt-5 border-l-4 border-amber-400 bg-amber-50 px-4 py-3"><h2 className="text-sm font-bold text-[#0F172A]">What needs fixing</h2><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#475569]">{application.remarks}</p></section>}
            <h2 className="mt-8 text-base font-bold text-[#0F172A]">Review progress</h2>
            <ol className="mt-3 divide-y divide-[#DDE7EF] border-y border-[#DDE7EF]">{stages(application).map((stage, index) => <li key={stage.title} aria-current={stage.state === 'current' ? 'step' : undefined} className="flex items-start gap-4 py-4">
              <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-xs font-bold ${stage.state === 'done' ? 'bg-[#0F2F62] text-white' : stage.state === 'current' ? 'bg-[#0878B7] text-white' : stage.state === 'stopped' ? 'bg-amber-100 text-amber-900' : 'bg-[#EEF6FB] text-[#64748B]'}`}>{String(index + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#0F172A]">{stage.title}</p><p className="mt-1 text-xs text-[#475569]">{stage.state === 'stopped' ? 'Returned for changes' : stage.date ? dateLabel(stage.date) : stage.state === 'done' ? 'Completed' : stage.state === 'current' ? 'In progress' : 'Waiting'}</p></div>
            </li>)}</ol>
            {application.status === 'rejected' && <Link to="/register-organization/edit-link" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7] underline underline-offset-2">Lost the edit link? Request another</Link>}
            {application.status === 'expired' && <Link to="/register-organization" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-[#0878B7] underline underline-offset-2">Start a new application</Link>}
          </>}
    </section>
  </div></main>;
}
