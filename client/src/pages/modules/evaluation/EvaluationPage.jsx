import { useMemo, useState } from 'react';
import { PageHeader, Tabs } from '../../../components/ui';
import SurveyPanel from './components/SurveyPanel';
import OrgResultsTab from './components/OrgResultsTab';

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

export default function EvaluationPage() {
  const user = useMemo(() => getCurrentUser(), []);
  const canSeeResults = user?.role === 'ADMIN' || user?.role === 'DEPARTMENT_HEAD';
  const [tab, setTab] = useState('survey');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Evaluation"
        description="This is the study's own evaluation instrument: what current practice looks like without HIUSA, and whether HIUSA's features are acceptable to the people who use them."
      />

      {canSeeResults && (
        <Tabs
          tabs={[
            { key: 'survey', label: 'Evaluation survey' },
            { key: 'results', label: 'Results for my organization' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}

      {tab === 'survey' || !canSeeResults ? <SurveyPanel user={user} /> : <OrgResultsTab />}
    </div>
  );
}
