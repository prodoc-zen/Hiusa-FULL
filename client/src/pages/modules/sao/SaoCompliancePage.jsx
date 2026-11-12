import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { EmptyState, PageHeader } from '../../../components/ui';
import ResponsiveTabs from './ResponsiveTabs';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getComplianceStatus } from '../../../services/complianceService';
import { fetchAllPages } from '../../../services/pagination';
import * as systemAdminService from '../../../services/systemAdministrationService';
import AccreditationTab from './AccreditationTab';
import EventRequirementsTab from './EventRequirementsTab';
import FinancialReportsTab from './FinancialReportsTab';
import RequirementsTab from './RequirementsTab';
import ReviewQueueTab from './ReviewQueueTab';
import OrganizationReviewFolders from './OrganizationReviewFolders';
import { reportsWaiting, submissionsWaiting } from './waiting';

const PANEL_ID = 'sao-compliance-panel';
const SUB_PANEL_ID = 'sao-compliance-subpanel';
const DEFAULT_TAB = 'accreditation';
const DEFAULT_REVIEW_FILTERS = { organizationId: '', status: 'submitted' };

const TABS = [
  { key: 'organizations', label: 'Organizations', panelId: PANEL_ID, defaultTab: 'accreditation' },
  { key: 'renewal', label: 'Renewal', panelId: PANEL_ID, defaultTab: 'renewal' },
  { key: 'event-reviews', label: 'Event reviews', panelId: PANEL_ID, defaultTab: 'event-reviews' },
  { key: 'financial', label: 'Semestral and financial report', panelId: PANEL_ID },
  { key: 'settings', label: 'Requirement settings', panelId: PANEL_ID, defaultTab: 'requirements' },
];
const ORGANIZATION_TABS = [
  { key: 'accreditation', label: 'Organization accreditation', panelId: SUB_PANEL_ID },
  { key: 'review', label: 'Review submissions', panelId: SUB_PANEL_ID },
];
const SETTING_TABS = [
  { key: 'requirements', label: 'Organization requirements', panelId: SUB_PANEL_ID },
  { key: 'renewal-requirements', label: 'Renewal requirements', panelId: SUB_PANEL_ID },
  { key: 'events', label: 'Event requirements', panelId: SUB_PANEL_ID },
  { key: 'semestral-requirements', label: 'Semestral and financial report requirements', panelId: SUB_PANEL_ID },
];
const TAB_GROUP = {
  accreditation: 'organizations',
  review: 'organizations',
  renewal: 'renewal',
  requirements: 'settings',
  'renewal-requirements': 'settings',
  events: 'settings',
  'semestral-requirements': 'settings',
  'event-reviews': 'event-reviews',
  financial: 'financial',
};

function getCurrentRole() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')?.role || '';
  } catch {
    return '';
  }
}

export default function SaoCompliancePage() {
  const role = useMemo(() => getCurrentRole(), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const hasRecord = Boolean(searchParams.get('record'));
  const activeTab = Object.hasOwn(TAB_GROUP, requestedTab) ? requestedTab : (hasRecord ? 'review' : DEFAULT_TAB);
  const activeGroup = TAB_GROUP[activeTab];

  const [overview, setOverview] = useState({ loading: true, error: null, academicYear: null, semester: null, noSemester: false, organizations: [] });
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
  const [reviewFilters, setReviewFilters] = useState(hasRecord ? { organizationId: '', status: '' } : { ...DEFAULT_REVIEW_FILTERS, organizationId: searchParams.get('organization') || '' });

  const statusCategory = activeTab === 'renewal' ? 'renewal' : undefined;

  const loadOverview = useCallback(() => {
    setOverview((current) => ({ ...current, loading: true, error: null }));
    const request = statusCategory ? getComplianceStatus({ category: statusCategory }) : getComplianceStatus();
    request
      .then((response) => {
        setOverview({
          loading: false,
          error: null,
          academicYear: response.data?.academic_year ?? null,
          semester: response.data?.academic_semester_id ? { id: response.data.academic_semester_id, starts_on: response.data.semester_starts_on, ends_on: response.data.semester_ends_on } : null,
          noSemester: response.data?.no_semester === true,
          organizations: Array.isArray(response.data?.organizations) ? response.data.organizations : [],
        });
      })
      .catch((err) => setOverview((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load accreditation status.') })));
  }, [statusCategory]);

  useEffect(() => { if (role === 'SUPER_ADMIN') loadOverview(); }, [loadOverview, role]);

  useEffect(() => {
    if (role !== 'SUPER_ADMIN') return;
    Promise.all(['pending', 'returned'].map((lifecycleStatus) => fetchAllPages((params) => systemAdminService.getSystemOrganizations({ ...params, lifecycle_status: lifecycleStatus }))))
      .then(([pending, returned]) => setPendingRegistrations([...pending, ...returned].map((organization) => ({ organization_id: organization.id, organization_name: `${organization.name} (registration)` }))))
      .catch(() => setPendingRegistrations([]));
  }, [role]);

  const changeTab = useCallback((key) => setSearchParams({ tab: key }), [setSearchParams]);

  function changeReviewFilters(filters) {
    setReviewFilters(filters);
    setSearchParams((current) => { const next = new URLSearchParams(current); if (filters.organizationId) next.set('organization', filters.organizationId); else next.delete('organization'); return next; });
  }

  function reviewOrganization(organizationId) {
    setReviewFilters({ organizationId: String(organizationId), status: 'submitted' });
    changeTab('review');
  }

  if (role !== 'SUPER_ADMIN') {
    return (
      <div className="space-y-5">
        <PageHeader />
        <EmptyState kind="restricted" title="SAO access only" description="Only the Student Affairs Office can review organization compliance." />
      </div>
    );
  }

  const awaitingReview = overview.organizations.reduce((total, org) => total + submissionsWaiting(org), 0);
  const organizationTabs = ORGANIZATION_TABS.map((tab) => (tab.key === 'review' && awaitingReview > 0
    ? { ...tab, label: `${tab.label} (${awaitingReview})` }
    : tab));
  const activeLabel = [...ORGANIZATION_TABS, ...SETTING_TABS, ...TABS].find((tab) => tab.key === activeTab)?.label || 'Compliance';

  if (requestedTab === 'documents') return <Navigate to="/dashboard/super-admin/documents" replace />;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader />

      <ResponsiveTabs label="Compliance section" value={activeGroup} onChange={(key) => changeTab(TABS.find((tab) => tab.key === key).defaultTab || key)} tabs={TABS} />

      <div role="tabpanel" id={PANEL_ID} aria-label={TABS.find((tab) => tab.key === activeGroup).label} className="space-y-5">
        {activeGroup === 'organizations' && <ResponsiveTabs label="Organizations view" value={activeTab} onChange={changeTab} tabs={organizationTabs} />}
        {activeGroup === 'settings' && <ResponsiveTabs label="Requirement settings view" value={activeTab} onChange={changeTab} tabs={SETTING_TABS} />}
        <div role={activeGroup === 'organizations' || activeGroup === 'settings' ? 'tabpanel' : undefined} id={SUB_PANEL_ID} aria-label={activeLabel} className="space-y-5">
          {activeTab === 'accreditation' && (
            <AccreditationTab overview={overview} onRetry={loadOverview} onReviewOrganization={reviewOrganization} onChanged={loadOverview} />
          )}
          {activeTab === 'renewal' && (
            <AccreditationTab title="Annual organization renewal" overview={overview} onRetry={loadOverview} onReviewOrganization={reviewOrganization} onChanged={loadOverview} />
          )}
          {activeTab === 'requirements' && (
            <RequirementsTab currentAcademicYear={overview.academicYear} noSemester={overview.noSemester} semester={overview.semester} onChanged={loadOverview} />
          )}
          {activeTab === 'renewal-requirements' && (
            <RequirementsTab key="renewal" category="renewal" currentAcademicYear={overview.academicYear} noSemester={overview.noSemester} semester={overview.semester} onChanged={loadOverview} />
          )}
          {activeTab === 'semestral-requirements' && (
            <RequirementsTab key="semestral" category="semestral_report" currentAcademicYear={overview.academicYear} noSemester={overview.noSemester} semester={overview.semester} onChanged={loadOverview} />
          )}
          {activeTab === 'review' && (
            <ReviewQueueTab
              organizations={[...overview.organizations, ...pendingRegistrations]}
              organizationsLoading={overview.loading}
              organizationsError={overview.error}
              onRetryOrganizations={loadOverview}
              filters={reviewFilters}
              onFiltersChange={changeReviewFilters}
              onChanged={loadOverview}
            />
          )}
          {activeTab === 'events' && <EventRequirementsTab noSemester={overview.noSemester} />}
          {activeTab === 'event-reviews' && <OrganizationReviewFolders overview={overview} onRetry={loadOverview} title="Event reviews">{(organizationId) => <EventRequirementsTab key={organizationId} mode="reviews" organizationId={organizationId} />}</OrganizationReviewFolders>}
          {activeTab === 'financial' && <OrganizationReviewFolders overview={overview} onRetry={loadOverview} title="Semestral and financial report" waiting={reportsWaiting}>{(organizationId, waiting) => <FinancialReportsTab key={organizationId} initialOrganizationId={organizationId} initialStatus={waiting > 0 ? 'pending_sao' : ''} />}</OrganizationReviewFolders>}
        </div>
      </div>
    </div>
  );
}
