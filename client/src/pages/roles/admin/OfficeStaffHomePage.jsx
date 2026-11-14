import { useEffect, useState } from 'react';
import { getOrganizationApplications } from '../../../services/organizationApplicationService';
import { getBriefing } from '../../../services/dashboardService';
import SetupChecklist from '../../../components/dashboard/SetupChecklist';
import { readSetupHidden, shapeSetup, writeSetupHidden } from '../../../components/dashboard/setupSteps.js';
import { Button, ErrorState, Skeleton } from '../../../components/ui';
import { headCollegeName, storedUser } from '../../../utils/collegeIdentity';
import { formatDisplayText } from '../../../utils/displayText.js';

const APPLICATIONS_PATH = '/dashboard/organization-applications';

// What the dean's office staff land on. Their one job is reviewing the college's applications, so
// this page says how many are waiting and links to them. It carries nothing of an organization head's setup,
// only its own short first-run list (a contact number, then the applications).
export default function OfficeStaffHomePage() {
  const user = storedUser();
  const college = formatDisplayText(headCollegeName(user) || user?.organization?.name) || 'your college';
  const [state, setState] = useState({ loading: true, error: false, waiting: 0 });
  const [reload, setReload] = useState(0);
  const userKey = `${user?.school_id ?? 'me'}.OFFICE_STAFF`;
  const [checklist, setChecklist] = useState({ loading: true, error: false, setup: null });
  const [checklistReload, setChecklistReload] = useState(0);
  const [checklistHidden, setChecklistHidden] = useState(() => readSetupHidden(userKey));

  useEffect(() => {
    let active = true;
    setChecklist((current) => ({ ...current, loading: true, error: false }));
    getBriefing()
      .then((response) => { if (active) setChecklist({ loading: false, error: false, setup: shapeSetup('OFFICE_STAFF', response.data?.setup) }); })
      .catch(() => { if (active) setChecklist({ loading: false, error: true, setup: null }); });
    return () => { active = false; };
  }, [checklistReload]);

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
      {checklist.loading && <div role="status" className="rounded-card border border-line bg-surface p-4 sm:p-5"><Skeleton className="h-4 w-1/2" /><span className="sr-only">Loading your checklist</span></div>}
      {checklist.error && <ErrorState title="Your checklist could not load." description="The rest of this page still works. Check your connection and try again." onRetry={() => setChecklistReload((value) => value + 1)} />}
      {!checklist.loading && !checklist.error && !checklistHidden && (
        <SetupChecklist
          setup={checklist.setup}
          title="Your first steps"
          description="Each step checks itself off once the work is done."
          primaryFirst={false}
          onHide={() => { writeSetupHidden(userKey); setChecklistHidden(true); }}
        />
      )}
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
