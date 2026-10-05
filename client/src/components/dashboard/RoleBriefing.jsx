import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ClipboardCheck, FileText, Megaphone } from 'lucide-react';
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

function storedSchoolId() {
  try { return JSON.parse(localStorage.getItem('user') ?? '{}')?.school_id ?? 'me'; } catch { return 'me'; }
}

const ACTIONS = {
  SUPER_ADMIN: [{ label: 'Review financial reports', to: '/dashboard/super-admin/financial-reports', icon: FileText }],
  ADMIN: [{ label: 'Create announcement', to: '/dashboard/announcements/create-announcement', icon: Megaphone }],
  DEPARTMENT_HEAD: [{ label: 'Review approvals', to: '/dashboard/department-head/approvals', icon: ClipboardCheck }],
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
    <div className="space-y-4">
      <BriefingHeader user={user} summary={summary} actions={ACTIONS[role] || []} />
      <details className="group overflow-hidden rounded-card border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-ink marker:content-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700 sm:px-5">
          <span>Organization indicators</span>
          <ChevronDown size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-line"><PillarPulse pillars={pillars} order={PILLAR_ORDER[role] || Object.keys(pillars)} /></div>
      </details>
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <SetupChecklist setup={setup} userKey={`${storedSchoolId()}.${role}.${user?.organization?.id ?? 'sao'}`} />
        <section aria-labelledby="briefing-attention" className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
          <h2 id="briefing-attention" className="border-b border-line px-4 py-3 text-base font-bold text-ink sm:px-5">Needs attention</h2>
          <div className="max-h-72 overflow-y-auto px-4 sm:px-5"><AttentionList items={attention} /></div>
        </section>
      </div>
      {insights.length > 0 && (
          <section aria-labelledby="briefing-insights" className="overflow-hidden rounded-card border border-line bg-surface">
            <h2 id="briefing-insights" className="border-b border-line px-4 py-3 text-base font-bold text-ink sm:px-5">What HIUSA noticed</h2>
            <div className="divide-y divide-line-soft px-4 sm:px-5">
              {insights.map((insight) => <AiInsightCard key={`${insight.engine}-${insight.title}`} insight={insight} />)}
            </div>
          </section>
        )}
      {role === 'SUPER_ADMIN' && Array.isArray(organizations) && <OrganizationsHealthTable organizations={organizations} />}
    </div>
  );
}
