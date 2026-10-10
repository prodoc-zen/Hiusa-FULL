import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ClipboardCheck, Megaphone } from 'lucide-react';
import { getBriefing } from '../../services/dashboardService';
import { ErrorState } from '../ui';
import AiInsightCard from './AiInsightCard';
import AttentionList from './AttentionList';
import BriefingHeader from './BriefingHeader';
import BriefingSkeleton from './BriefingSkeleton';
import OrganizationsHealthTable from './OrganizationsHealthTable';
import PillarPulse from './PillarPulse';
import ReviewInbox from './ReviewInbox';
import SetupChecklist from './SetupChecklist';
import { buildReviewAreas, reviewHeadline } from './reviewQueues';
import { readSetupHidden, setupDescription, shapeSetup, writeSetupHidden } from './setupSteps';

// Pillar order per role, from docs/api/dashboard-briefing.md. Students have no tasks, so no Tasks pillar.
const PILLAR_ORDER = {
  SUPER_ADMIN: ['finance', 'elections', 'events', 'communication'],
  ADMIN: ['finance', 'events', 'tasks', 'elections', 'merchandise', 'communication'],
  SBO_OFFICER: ['events', 'tasks', 'merchandise', 'communication', 'finance'],
  DEPARTMENT_HEAD: ['finance', 'events', 'elections', 'communication'],
  STUDENT: ['elections', 'events', 'merchandise', 'communication'],
};

const ATTENTION_TITLE = { SBO_OFFICER: 'Your work queue', SUPER_ADMIN: 'Review inbox' };
const SETUP_TITLE = { STUDENT: 'Next for you' };

// Registration work leads every attention list: nothing else about an organization can move until it is decided.
const REGISTRATION_TYPES = new Set(['registrations_pending', 'registration_returned', 'organization_awaiting_admin']);
const TASK_TYPES = new Set(['task_overdue', 'task_due_soon']);

function storedSchoolId() {
  try { return JSON.parse(localStorage.getItem('user') ?? '{}')?.school_id ?? 'me'; } catch { return 'me'; }
}

const ACTIONS = {
  ADMIN: [{ label: 'New announcement', to: '/dashboard/announcements/create-announcement', icon: Megaphone }],
  DEPARTMENT_HEAD: [{ label: 'Review approvals', to: '/dashboard/department-head/approvals', icon: ClipboardCheck }],
};

function BriefingBody({ data }) {
  const { user, summary, attention: rawAttention = [], pillars = {}, insights = [], organizations } = data;
  const role = user?.role;
  const userKey = `${storedSchoolId()}.${role}.${user?.organization?.id ?? 'sao'}`;
  const [setupHidden, setSetupHidden] = useState(() => readSetupHidden(userKey));

  let attention = [...rawAttention].sort((a, b) => Number(REGISTRATION_TYPES.has(b.type)) - Number(REGISTRATION_TYPES.has(a.type)));
  let headline = summary.headline;

  if (role === 'STUDENT') {
    const withoutTasks = attention.filter((item) => !TASK_TYPES.has(item.type));
    if (withoutTasks.length !== attention.length) {
      attention = withoutTasks;
      headline = attention.length === 0 ? "You're all caught up." : `${attention.length} ${attention.length === 1 ? 'item needs' : 'items need'} you today.`;
    }
  }

  const reviewAreas = role === 'SUPER_ADMIN' ? buildReviewAreas(attention) : [];
  if (reviewAreas.length > 0) headline = reviewHeadline(reviewAreas);

  const setup = shapeSetup(role, data.setup);
  const setupOpen = Boolean(setup) && setup.completed < setup.total && !setupHidden;

  // One filled button leads the page: the SAO's first queue, else the first open setup step, else the role's usual action.
  let actions = [];
  if (role === 'SUPER_ADMIN') {
    if (reviewAreas[0]?.href) actions = [{ label: reviewAreas[0].action, to: reviewAreas[0].href, icon: ClipboardCheck }];
  } else if (!setupOpen) {
    actions = ACTIONS[role] || [];
  }

  const inboxFirst = role === 'SUPER_ADMIN' && reviewAreas.length > 0;
  const attentionTitle = ATTENTION_TITLE[role] || 'Needs attention';

  const setupCard = setupOpen && (
    <SetupChecklist
      setup={setup}
      title={SETUP_TITLE[role]}
      description={setupDescription(role, user?.organization)}
      primaryFirst={actions.length === 0}
      onHide={() => { writeSetupHidden(userKey); setSetupHidden(true); }}
    />
  );
  const attentionCard = (
    <section aria-labelledby="briefing-attention" className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      <h2 id="briefing-attention" className="border-b border-line px-4 py-3 text-base font-bold text-ink sm:px-5">{attentionTitle}</h2>
      <div className="max-h-72 overflow-y-auto px-4 sm:px-5">
        {role === 'SUPER_ADMIN' ? <ReviewInbox areas={reviewAreas} /> : <AttentionList items={attention} />}
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      <BriefingHeader user={user} summary={{ ...summary, headline }} actions={actions} />
      {inboxFirst ? <>{attentionCard}{setupCard}</> : <>{setupCard}{attentionCard}</>}
      <details className="group overflow-hidden rounded-card border border-line bg-surface">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-ink marker:content-none hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700 sm:px-5">
          <span>Organization indicators</span>
          <ChevronDown size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-line"><PillarPulse pillars={pillars} order={PILLAR_ORDER[role] || Object.keys(pillars)} /></div>
      </details>
      {insights.length > 0 && (
        <section aria-labelledby="briefing-insights" className="overflow-hidden rounded-card border border-line bg-surface">
          <h2 id="briefing-insights" className="border-b border-line px-5 py-4 text-base font-bold text-ink sm:px-6">What HIUSA noticed</h2>
          <div className="divide-y divide-line-soft px-5 sm:px-6">
            {insights.map((insight) => <AiInsightCard key={`${insight.engine}-${insight.title}`} insight={insight} />)}
          </div>
        </section>
      )}
      {role === 'SUPER_ADMIN' && Array.isArray(organizations) && <OrganizationsHealthTable organizations={organizations} />}
    </div>
  );
}

/**
 * The role-aware briefing that opens every home page: greeting and headline, the first-run
 * checklist (above the work queue until it is finished), what needs this person now, the study's
 * areas, and what the AI noticed (with the "Why?" disclosure). Composed above each home page's own content.
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

  return <BriefingBody data={state.data} />;
}
