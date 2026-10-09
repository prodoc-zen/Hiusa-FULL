import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, Check, ClipboardList, FolderSearch, ShieldCheck, Wallet } from 'lucide-react';
import { Card, EmptyState, PageHeader, Tabs } from '../../../components/ui';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getComplianceStatus } from '../../../services/complianceService';
import AccreditationTab from './AccreditationTab';
import DocumentsTab from './DocumentsTab';
import EventRequirementsTab from './EventRequirementsTab';
import FinancialReportsTab from './FinancialReportsTab';
import RequirementsTab from './RequirementsTab';
import ReviewQueueTab from './ReviewQueueTab';

const PANEL_ID = 'sao-compliance-panel';
const DEFAULT_TAB = 'accreditation';
const DEFAULT_REVIEW_FILTERS = { organizationId: '', status: 'submitted' };

const TABS = [
  { key: 'accreditation', label: 'Accreditation', icon: ShieldCheck, panelId: PANEL_ID },
  { key: 'requirements', label: 'Requirements', icon: ClipboardList, panelId: PANEL_ID },
  { key: 'review', label: 'Review queue', icon: Check, panelId: PANEL_ID },
  { key: 'events', label: 'Event requirements', icon: CalendarCheck, panelId: PANEL_ID },
  { key: 'financial', label: 'Financial reports', icon: Wallet, panelId: PANEL_ID },
  { key: 'documents', label: 'Track documents', icon: FolderSearch, panelId: PANEL_ID },
];

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
  const activeTab = TABS.some((tab) => tab.key === requestedTab) ? requestedTab : DEFAULT_TAB;

  const [overview, setOverview] = useState({ loading: true, error: null, academicYear: null, organizations: [] });
  const [reviewFilters, setReviewFilters] = useState(DEFAULT_REVIEW_FILTERS);

  const loadOverview = useCallback(() => {
    setOverview((current) => ({ ...current, loading: true, error: null }));
    getComplianceStatus()
      .then((response) => {
        setOverview({
          loading: false,
          error: null,
          academicYear: response.data?.academic_year ?? null,
          organizations: Array.isArray(response.data?.organizations) ? response.data.organizations : [],
        });
      })
      .catch((err) => setOverview((current) => ({ ...current, loading: false, error: getApiErrorMessage(err, 'Could not load accreditation status.') })));
  }, []);

  useEffect(() => { if (role === 'SUPER_ADMIN') loadOverview(); }, [loadOverview, role]);

  const changeTab = useCallback((key) => setSearchParams({ tab: key }), [setSearchParams]);

  function reviewOrganization(organizationId) {
    setReviewFilters({ organizationId: String(organizationId), status: 'submitted' });
    changeTab('review');
  }

  if (role !== 'SUPER_ADMIN') {
    return (
      <div className="space-y-5">
        <PageHeader title="Compliance and accreditation" description="Track every organization's accreditation status and review submitted documents." />
        <Card><EmptyState kind="restricted" title="SAO access only" description="Only the Student Affairs Office can review organization compliance." /></Card>
      </div>
    );
  }

  const awaitingReview = overview.organizations.reduce((total, org) => total
    + org.requirements.filter((requirement) => requirement.status === 'submitted').length, 0);
  const tabs = TABS.map((tab) => (tab.key === 'review' && awaitingReview > 0
    ? { ...tab, label: `${tab.label} (${awaitingReview})` }
    : tab));
  const activeLabel = TABS.find((tab) => tab.key === activeTab).label;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Compliance and accreditation"
        description="See who is behind on their requirements, manage what every organization must submit, and review everything that has come in."
      />

      <Tabs value={activeTab} onChange={changeTab} tabs={tabs} />

      <div role="tabpanel" id={PANEL_ID} aria-label={activeLabel} className="space-y-5">
        {activeTab === 'accreditation' && (
          <AccreditationTab overview={overview} onRetry={loadOverview} onReviewOrganization={reviewOrganization} />
        )}
        {activeTab === 'requirements' && (
          <RequirementsTab currentAcademicYear={overview.academicYear} onChanged={loadOverview} />
        )}
        {activeTab === 'review' && (
          <ReviewQueueTab
            organizations={overview.organizations}
            filters={reviewFilters}
            onFiltersChange={setReviewFilters}
            onChanged={loadOverview}
          />
        )}
        {activeTab === 'events' && <EventRequirementsTab />}
        {activeTab === 'financial' && <FinancialReportsTab />}
        {activeTab === 'documents' && <DocumentsTab />}
      </div>
    </div>
  );
}
