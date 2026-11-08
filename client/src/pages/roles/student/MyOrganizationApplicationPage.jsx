import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Paperclip } from 'lucide-react';
import { Card, ErrorState, PageHeader, SkeletonCard, StatusBadge } from '../../../components/ui';
import ApplicationForm from '../../../components/org/ApplicationForm';
import { APPLICATION_LABELS, applicantStatusLine } from '../../../components/org/applicationStatus';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { getMyOrganizationApplication, resubmitOrganizationApplication } from '../../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { openProtectedFile } from '../../../utils/openProtectedFile';

async function open(url) {
  try {
    await openProtectedFile(url);
  } catch (error) {
    notify.error(getApiErrorMessage(error, 'Could not open this file.'));
  }
}

function FileButton({ url, children, icon: Icon = FileText }) {
  return (
    <button type="button" onClick={() => open(url)} className="inline-flex min-h-11 items-center gap-2 text-left text-sm font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="break-all">{children}</span>
    </button>
  );
}

function Note({ who, children }) {
  return (
    <div className="mt-3 rounded-control border border-line bg-subtle p-3">
      <p className="text-xs font-bold text-ink-muted">Note from {who}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{children}</p>
    </div>
  );
}

export default function MyOrganizationApplicationPage() {
  const { applicationId } = useParams();
  const [state, setState] = useState({ loading: true, error: null, application: null });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    return getMyOrganizationApplication(applicationId)
      .then((res) => setState({ loading: false, error: null, application: res.data }))
      .catch((err) => setState({
        loading: false,
        error: err?.response?.status === 404 ? 'This application is not yours or no longer exists.' : getApiErrorMessage(err, 'Could not load this application.'),
        application: null,
      }));
  }, [applicationId]);

  useEffect(() => { load(); }, [load]);

  async function resubmit(fields, files) {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const { data } = await resubmitOrganizationApplication(applicationId, fields, files);
      setState({ loading: false, error: null, application: data });
      notify.success('Sent again to your Department Head.');
    } catch (err) {
      setErrors(err?.response?.data?.errors || {});
      setFormError(getApiErrorMessage(err, 'Could not send the application. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const { loading, error, application } = state;
  const returned = application?.status === 'returned';
  const generalFiles = application?.review_files || [];
  const returnedBy = application?.returned_by_role === 'DEPARTMENT_HEAD' ? 'your Department Head' : 'the SAO';

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title={application?.name} description={application ? undefined : 'Follow your organization application.'} />

      {loading && <SkeletonCard />}
      {!loading && error && <Card><ErrorState description={error} onRetry={load} /></Card>}

      {!loading && !error && application && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={application.status} label={APPLICATION_LABELS[application.status]} />
              <p className="text-sm font-medium text-ink-muted">{application.acronym} · {application.college?.name}{application.submitted_at ? ` · Sent ${manilaDate(application.submitted_at, 'long')}` : ''}</p>
            </div>
            <p className="mt-3 text-sm font-semibold text-ink">{applicantStatusLine(application)}</p>
            {application.remarks && <Note who={application.status === 'returned' ? returnedBy : 'the SAO'}>{application.remarks}</Note>}
            {application.endorsement_note && <Note who="your Department Head">{application.endorsement_note}</Note>}
          </Card>

          <Card title="Requirements" bodyClassName="p-0">
            <ul className="divide-y divide-line-soft">
              {application.requirements.map((requirement) => (
                <li key={requirement.id} className="space-y-2 px-5 py-4">
                  <p className="text-sm font-bold text-ink">{requirement.name}</p>
                  {requirement.document
                    ? <FileButton url={requirement.document.open_url}>{requirement.document.name}</FileButton>
                    : <p className="text-sm font-medium text-ink-muted">No file yet.</p>}
                  {requirement.reviews.map((review) => (
                    <div key={review.stage} className="flex flex-wrap items-start gap-2">
                      <StatusBadge status={review.status} />
                      <p className="min-w-0 text-sm text-ink"><span className="font-semibold">{review.stage_label}:</span> {review.note || (review.status === 'ok' ? 'No problem found.' : 'No note.')}</p>
                    </div>
                  ))}
                  {requirement.review_files.map((file) => (
                    <div key={file.id}><FileButton url={file.open_url} icon={Paperclip}>{file.name} ({file.stage_label})</FileButton></div>
                  ))}
                </li>
              ))}
            </ul>
          </Card>

          {generalFiles.length > 0 && (
            <Card title="Files from the reviewers">
              <ul className="space-y-1">
                {generalFiles.map((file) => <li key={file.id}><FileButton url={file.open_url} icon={Paperclip}>{file.name} ({file.stage_label})</FileButton></li>)}
              </ul>
            </Card>
          )}

          {returned && (
            <Card title="Fix and send again" description="Your files stay attached unless you choose a new one. It goes back to your Department Head first.">
              {formError && <p role="alert" className="mb-4 text-sm font-semibold text-danger-strong">{formError}</p>}
              <ApplicationForm requirements={application.requirements} initial={application} submitLabel="Send again" busy={busy} errors={errors} onSubmit={resubmit} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
