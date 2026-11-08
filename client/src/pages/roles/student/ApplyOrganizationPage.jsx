import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonCard, StatusBadge } from '../../../components/ui';
import ApplicationForm from '../../../components/org/ApplicationForm';
import { APPLICATION_LABELS } from '../../../components/org/applicationStatus';
import notify from '../../../lib/notify';
import { manilaDate } from '../../../lib/format';
import { getMyOrganizationApplications, submitOrganizationApplication } from '../../../services/organizationApplicationService';
import { getApiErrorMessage } from '../../../utils/apiError';

export default function ApplyOrganizationPage() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    return getMyOrganizationApplications()
      .then((res) => setState({ loading: false, error: null, data: res.data }))
      .catch((err) => setState({ loading: false, error: getApiErrorMessage(err, 'Could not load your applications.'), data: null }));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(fields, files) {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const { data } = await submitOrganizationApplication(fields, files);
      notify.success('Application sent to your Department Head.');
      navigate(`/dashboard/student/organization-applications/${data.id}`);
    } catch (err) {
      setErrors(err?.response?.data?.errors || {});
      setFormError(getApiErrorMessage(err, 'Could not send the application. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const { loading, error, data } = state;
  const applications = data?.applications || [];
  const closed = Boolean(data?.can_apply) && (!data.academic_semester || data.requirements.length === 0);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader />

      {loading && <SkeletonCard />}
      {!loading && error && <Card><ErrorState description={error} onRetry={load} /></Card>}

      {!loading && !error && applications.length > 0 && (
        <Card title="Your applications" bodyClassName="p-0" className="max-w-3xl">
          <ul className="divide-y divide-line-soft">
            {applications.map((application) => (
              <li key={application.id}>
                <Link to={`/dashboard/student/organization-applications/${application.id}`} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-3 hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-ink">{application.name}</span>
                    <span className="block text-xs text-ink-muted">{application.acronym}{application.submitted_at ? ` · Sent ${manilaDate(application.submitted_at, 'long')}` : ''}</span>
                  </span>
                  <span className="col-start-1 row-start-2 justify-self-start sm:col-start-auto sm:row-start-auto sm:justify-self-auto">
                    <StatusBadge status={application.status} label={APPLICATION_LABELS[application.status]} />
                  </span>
                  <ChevronRight size={16} className="col-start-2 row-start-1 text-ink-soft sm:col-start-auto sm:row-start-auto" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!loading && !error && data?.can_apply && !closed && (
        <Card className="max-w-3xl" title={applications.length > 0 ? 'Apply for another organization' : undefined} description={`${data.college?.name}. Academic year ${data.academic_semester.academic_year}, semester ${data.academic_semester.number}.`}>
          {formError && <p role="alert" className="mb-4 text-sm font-semibold text-danger-strong">{formError}</p>}
          <ApplicationForm requirements={data.requirements} submitLabel="Send application" busy={busy} errors={errors} onSubmit={submit} />
        </Card>
      )}

      {!loading && !error && closed && (
        <Card><EmptyState title="Applications are closed" description="The SAO has not opened a semester with its requirements yet. Try again later." /></Card>
      )}

      {!loading && !error && !data?.can_apply && applications.length === 0 && (
        <Card><EmptyState title="You cannot apply yet" description="Ask your Department Head to allow you." /></Card>
      )}
      {!loading && !error && !data?.can_apply && applications.length > 0 && (
        <p className="max-w-3xl text-sm text-ink-muted">You cannot apply for another organization yet. Ask your Department Head to allow you.</p>
      )}
    </div>
  );
}
