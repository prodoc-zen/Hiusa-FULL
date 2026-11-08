import { useEffect, useState } from 'react';
import { getOrganizationApplications } from '../../../services/organizationApplicationService';
import { Button, ErrorState, Skeleton } from '../../../components/ui';
import { headCollegeName, storedUser } from '../../../utils/collegeIdentity';
import { formatDisplayText } from '../../../utils/displayText.js';

const APPLICATIONS_PATH = '/dashboard/organization-applications';

// What the dean's office staff land on. Their one job is reviewing the college's applications, so
// this page says how many are waiting and links to them. It carries nothing of an organization head's setup.
export default function OfficeStaffHomePage() {
  const user = storedUser();
  const college = formatDisplayText(headCollegeName(user) || user?.organization?.name) || 'your college';
  const [state, setState] = useState({ loading: true, error: false, waiting: 0 });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: false }));
    getOrganizationApplications({ status: 'pending_dean', per_page: 1 })
      .then((response) => { if (active) setState({ loading: false, error: false, waiting: Number(response.data?.counts?.pending_dean ?? 0) }); })
      .catch(() => { if (active) setState({ loading: false, error: true, waiting: 0 }); });
    return () => { active = false; };
  }, [reload]);

  return (
    <div className="w-full space-y-6">
      <section className="rounded-card border border-line bg-surface p-4 sm:p-5" aria-label="Applications to review">
        <h2 className="text-base font-semibold text-ink">Applications for {college}</h2>
        {state.loading && <div role="status" className="mt-3"><Skeleton className="h-4 w-2/3" /><span className="sr-only">Loading applications</span></div>}
        {state.error && <ErrorState title="Applications could not be loaded." description="Check your connection and try again." onRetry={() => setReload((value) => value + 1)} />}
        {!state.loading && !state.error && (
          <p className="mt-2 text-sm text-ink-muted-strong">
            {state.waiting === 0
              ? 'Nothing is waiting for review. Applications show here once a student the dean allowed to apply sends one.'
              : `${state.waiting} ${state.waiting === 1 ? 'application is' : 'applications are'} waiting for your review.`}
          </p>
        )}
        <Button to={APPLICATIONS_PATH} className="mt-4">Review applications</Button>
      </section>
    </div>
  );
}
