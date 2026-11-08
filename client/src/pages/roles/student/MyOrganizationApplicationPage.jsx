import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Paperclip } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonCard, StatusBadge } from '../../../components/ui';
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

const LINK_BUTTON = 'inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

// The one word on a requirement row. A problem outranks an acceptance, so a row any reviewer
// flagged never reads as OK. A file nobody has looked at yet is "Not reviewed yet", not a problem.
function requirementState(requirement) {
  if (requirement.reviews.some((review) => review.status === 'needs_changes')) return 'needs_changes';
  if (!requirement.document || requirement.reviews.some((review) => review.status === 'missing')) return 'missing';
  if (requirement.reviews.length > 0 && requirement.reviews.every((review) => review.status === 'ok')) return 'ok';
  return '';
}

// Rows that need nothing from the applicant stay on one line; the rest show their notes and files.
function needsAction(requirement) {
  const state = requirementState(requirement);
  return state === 'needs_changes' || state === 'missing';
}

function RequirementRow({ requirement }) {
  const [open, setOpen] = useState(false);
  const state = requirementState(requirement);
  const flagged = needsAction(requirement);
  const hasDetail = requirement.reviews.some((review) => review.note) || requirement.review_files.length > 0;
  const toggle = !flagged && hasDetail;
  const expanded = flagged || open;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          <p className="min-w-0 break-words text-sm font-semibold text-ink">{requirement.name}</p>
          {state ? <StatusBadge status={state} /> : <StatusBadge status="pending" tone="neutral" label="Not reviewed yet" />}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 sm:justify-end">
          {requirement.document
            ? <FileButton url={requirement.document.open_url}>{requirement.document.name}</FileButton>
            : <p className="text-sm font-medium text-ink-muted">No file yet.</p>}
          {toggle && (
            <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide details' : 'Details'} ${requirement.name}`} onClick={() => setOpen(!open)} className={LINK_BUTTON}>{open ? 'Hide details' : 'Details'}</button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          {requirement.reviews.map((review) => (
            <p key={review.stage} className="min-w-0 text-sm text-ink"><span className="font-semibold">{review.stage_label}:</span> {review.note || (review.status === 'ok' ? 'No problem found.' : 'No note.')}</p>
          ))}
          {requirement.review_files.map((file) => (
            <div key={file.id}><FileButton url={file.open_url} icon={Paperclip}>{file.name} ({file.stage_label})</FileButton></div>
          ))}
        </div>
      )}
    </li>
  );
}

function Note({ who, children }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs font-semibold text-ink-muted">Note from {who}</p>
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
  const [allFiles, setAllFiles] = useState(false);

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
  // Only the files that need changes get an upload while sending again. An accepted file stays
  // attached, and the applicant can still ask for every upload.
  const uploads = (application?.requirements || []).filter((requirement) => allFiles || needsAction(requirement) || errors[`files.${requirement.id}`]);
  const hiddenUploads = (application?.requirements?.length || 0) - uploads.length;
  const returnedBy = application?.returned_by_role === 'DEPARTMENT_HEAD' ? 'your Department Head' : 'the SAO';

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title={application?.name} />

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
            {application.requirements.length === 0 && (
              <div className="px-5">
                <EmptyState title="Nothing to submit yet" description="No requirements are listed for this application." />
              </div>
            )}
            {application.requirements.length > 0 && <ul className="divide-y divide-line-soft">
              {application.requirements.map((requirement) => <RequirementRow key={requirement.id} requirement={requirement} />)}
            </ul>}
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
              {hiddenUploads > 0 && (
                <p className="mb-4 text-sm text-ink-muted-strong">
                  {uploads.length === 0 ? 'Every file was accepted.' : `Showing the ${uploads.length === 1 ? '1 file that needs' : `${uploads.length} files that need`} changes.`}
                  {' '}
                  <button type="button" onClick={() => setAllFiles(true)} className={LINK_BUTTON}>Show all {application.requirements.length} uploads</button>
                </p>
              )}
              <ApplicationForm requirements={uploads} initial={application} submitLabel="Send again" busy={busy} errors={errors} onSubmit={resubmit} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
