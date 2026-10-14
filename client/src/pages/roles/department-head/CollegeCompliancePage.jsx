import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../../components/ui';
import { getComplianceStatus } from '../../../services/complianceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import AccreditationTab from '../../modules/sao/AccreditationTab';

export default function CollegeCompliancePage() {
  const [overview, setOverview] = useState({ loading: true, error: null, academicYear: null, organizations: [] });
  const load = useCallback(() => {
    setOverview((current) => ({ ...current, loading: true, error: null }));
    getComplianceStatus().then(({ data }) => setOverview({ loading: false, error: null, academicYear: data.academic_year, organizations: data.organizations || [] }))
      .catch((error) => setOverview((current) => ({ ...current, loading: false, error: getApiErrorMessage(error, 'Could not load college compliance.') })));
  }, []);
  useEffect(() => { load(); }, [load]);
  return <div className="space-y-5"><PageHeader title="College compliance" description="Track each organization's requirements and send reminders to its members." /><AccreditationTab role="DEPARTMENT_HEAD" overview={overview} onRetry={load} /></div>;
}
