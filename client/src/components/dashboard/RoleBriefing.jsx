import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, FileText, Megaphone, Target } from 'lucide-react';
import { getBriefing } from '../../services/dashboardService';
import { ErrorState } from '../ui';
import AiInsightCard from './AiInsightCard';
import AttentionList from './AttentionList';
import BriefingHeader from './BriefingHeader';
import BriefingSkeleton from './BriefingSkeleton';
import OrganizationsHealthTable from './OrganizationsHealthTable';
import PillarPulse from './PillarPulse';
import SetupChecklist from './SetupChecklist';

// Pillar order per role, from docs/api/dashboard-briefing.md.
const PILLAR_ORDER = {
  SUPER_ADMIN: ['finance', 'elections', 'events', 'communication'],
  ADMIN: ['finance', 'events', 'tasks', 'elections', 'merchandise', 'communication'],
  SBO_OFFICER: ['events', 'tasks', 'merchandise', 'communication', 'finance'],
  DEPARTMENT_HEAD: ['finance', 'events', 'elections', 'communication'],
  STUDENT: ['elections', 'events', 'merchandise', 'tasks', 'communication'],
};

const objectivesAction = { label: 'Study objectives', to: '/dashboard/objectives', icon: Target };

function storedSchoolId() {
  try { return JSON.parse(localStorage.getItem('user') ?? '{}')?.school_id ?? 'me'; } catch { return 'me'; }
}

const ACTIONS = {
  SUPER_ADMIN: [{ label: 'Review financial reports', to: '/dashboard/super-admin/financial-reports', icon: FileText }, objectivesAction],
  ADMIN: [{ label: 'Create announcement', to: '/dashboard/announcements/create-announcement', icon: Megaphone }, objectivesAction],
  DEPARTMENT_HEAD: [{ label: 'Review approvals', to: '/dashboard/department-head/approvals', icon: ClipboardCheck }, objectivesAction],
  SBO_OFFICER: [objectivesAction],
  STUDENT: [objectivesAction],
};

/**
 * The role-aware briefing that opens every home page: greeting and headline,
 * what needs this person now, the study's six areas, and what the AI noticed
 * (with the "Why?" disclosure). Composed above each home page's own content.
 */
export default function RoleBriefing() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(() => {
    setState({ loading: true, error: null, data: null });
    getBriefing()
      .then((response) => setState({ loading: false, error: null, data: response.data }))
      .catch(() => setState({ loading: false, error: true, data: null }));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.loading) return <BriefingSkeleton />;
  if (state.error) {
    return (
      <ErrorState
        title="Your briefing could not load"
        description="The rest of this page still works. Check your connection and try again."
        onRetry={load}
      />
    );
  }

  const { user, summary, setup, attention = [], pillars = {}, insights = [], organizations } = state.data;
  const role = user?.role;

  return (
    <div className="space-y-5">
      <BriefingHeader user={user} summary={summary} actions={ACTIONS[role] || [objectivesAction]} />
      <SetupChecklist setup={setup} userKey={`${storedSchoolId()}.${role}.${user?.organization?.id ?? 'sao'}`} />
      <div className={insights.length > 0 ? 'grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]' : undefined}>
        <AttentionList items={attention} />
        {insights.length > 0 && (
          <section aria-labelledby="briefing-insights" className="space-y-3">
            <h2 id="briefing-insights" className="text-base font-bold text-ink">What HIUSA noticed</h2>
            {insights.map((insight) => <AiInsightCard key={`${insight.engine}-${insight.title}`} insight={insight} />)}
          </section>
        )}
      </div>
      <PillarPulse pillars={pillars} order={PILLAR_ORDER[role] || Object.keys(pillars)} />
      {role === 'SUPER_ADMIN' && Array.isArray(organizations) && <OrganizationsHealthTable organizations={organizations} />}
    </div>
  );
}
