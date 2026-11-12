import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Paperclip } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonCard, StatusBadge } from '../../../components/ui';
import ApplicationForm from '../../../components/org/ApplicationForm';
import { APPLICATION_LABELS, applicantStatusLine } from '../../../components/org/applicationStatus';
import FileReviewList, { FileLink } from '../../../components/reviews/FileReviewList';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { getMyOrganizationApplication, resubmitOrganizationApplication } from '../../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../../utils/apiError';

const LINK_BUTTON = 'inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

// The one word on a requirement row. A problem outranks an acceptance, so a row any reviewer
// flagged never reads as OK. A file nobody has looked at yet is "Not reviewed yet", not a problem.
function requirementState(requirement) {
  if (requirement.reviews.some((review) => review.status === 'needs_changes')) return 'needs_changes';
  if (!requirement.document || requirement.reviews.some((review) => review.status === 'missing')) return 'missing';
  if (requirement.reviews.length > 0 && requirement.reviews.every((review) => review.status === 'ok')) return 'ok';
  return '';
}

// An acceptance from an earlier round still holds on a file the applicant did not replace.
function acceptedEarlier(requirement) {
  return requirementState(requirement) === 'ok' && requirement.reviews.every((review) => review.carried);
}

// Rows that need nothing from the applicant stay on one line; the rest show their notes and files.
function needsAction(requirement) {
  const state = requirementState(requirement);
  return state === 'needs_changes' || state === 'missing';
}

function requirementRow(requirement, open, onToggle) {
  const state = requirementState(requirement);
  const flagged = needsAction(requirement);
  const hasDetail = requirement.reviews.some((review) => review.note) || requirement.review_files.length > 0;
  const toggle = !flagged && hasDetail;
  const label = open ? 'Hide details' : 'Details';

  return {
    id: requirement.id,
    name: requirement.name,
    status: acceptedEarlier(requirement) ? { status: 'ok', label: 'Accepted earlier' } : state ? { status: state } : { status: 'pending', tone: 'neutral', label: 'Not reviewed yet' },
    file: requirement.document ? { name: requirement.document.name, url: requirement.document.open_url } : null,
    emptyFile: 'No file yet.',
    actions: toggle ? [{ label, ariaLabel: `${label} ${requirement.name}`, expanded: open, onClick: onToggle }] : [],
    expanded: flagged || open,
    note: requirement.reviews.length > 0 && (
      <div className="space-y-2">
        {requirement.reviews.map((review) => (
          <p key={review.stage} className={`min-w-0 ${review.status === 'needs_changes' || review.status === 'missing' ? 'rounded-control border border-warning/40 bg-warning-tint px-3 py-2 text-warning-strong' : ''}`}>
            <span className="font-semibold">{review.stage_label}:</span> {review.note || (review.carried ? 'Accepted earlier.' : review.status === 'ok' ? 'No problem found.' : 'No note.')}
          </p>
        ))}
      </div>
    ),
    detail: requirement.review_files.length > 0 && (
      <div className="space-y-2">
        {requirement.review_files.map((file) => (
          <div key={file.id}><FileLink url={file.open_url} name={`${file.name} (${file.stage_label})`} icon={Paperclip} /></div>
        ))}
      </div>
    ),
  };
}

// A returned note stands apart from the requirement text in the same danger tint the Admin sees on a returned event.
function Note({ who, returned = false, children }) {
  return (
    <div className={returned ? 'mt-3 rounded-control border border-danger/30 bg-danger-tint p-3 text-danger-strong' : 'mt-3 border-t border-line pt-3'}>
      <p className={`text-xs font-semibold ${returned ? '' : 'text-ink-muted'}`}>Note from {who}</p>
      <p className={`mt-1 whitespace-pre-wrap text-sm ${returned ? '' : 'text-ink'}`}>{children}</p>
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
  const [openRows, setOpenRows] = useState({});

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
  // attached, and the applicant can still ask for every upload. A return on a general note alone
  // flags no file, so then every upload shows: the note may ask for any of them to be replaced.
  const requirements = application?.requirements || [];
  const flaggedUploads = requirements.filter((requirement) => needsAction(requirement) || errors[`files.${requirement.id}`]);
  const everyFileAccepted = requirements.length > 0 && requirements.every((requirement) => requirementState(requirement) === 'ok');
  const uploads = allFiles || (flaggedUploads.length === 0 && !everyFileAccepted) ? requirements : flaggedUploads;
  const hiddenUploads = requirements.length - uploads.length;
  const returnedBy = application?.returned_by_role === 'DEPARTMENT_HEAD' ? 'your Department Head' : 'the SAO';

  return (
    <div className="max-w-5xl space-y-5 pb-8">
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
            {application.remarks && <Note who={returned ? returnedBy : 'the SAO'} returned={returned}>{application.remarks}</Note>}
            {application.endorsement_note && <Note who="your Department Head">{application.endorsement_note}</Note>}
          </Card>

          <Card title="Requirements" bodyClassName="p-0">
            {application.requirements.length === 0 && (
              <div className="px-5">
                <EmptyState title="Nothing to submit yet" description="No requirements are listed for this application." />
              </div>
            )}
            {application.requirements.length > 0 && (
              <FileReviewList rows={application.requirements.map((requirement) => requirementRow(requirement, Boolean(openRows[requirement.id]), () => setOpenRows((current) => ({ ...current, [requirement.id]: !current[requirement.id] }))))} />
            )}
          </Card>

          {generalFiles.length > 0 && (
            <Card title="Files from the reviewers">
              <ul className="space-y-1">
                {generalFiles.map((file) => <li key={file.id}><FileLink url={file.open_url} name={`${file.name} (${file.stage_label})`} icon={Paperclip} /></li>)}
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
