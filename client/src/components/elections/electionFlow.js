import { canViewElectionResults, isVotingOpen } from '../../utils/electionAccess';

const BASE = '/dashboard/elections';

export const ROLE_BANNERS = {
  ADMIN: 'You run this election: build the ballot, finalize it, open voting, and release the results.',
  SBO_OFFICER: 'You can follow the candidates, the voters and the results. The Admin runs the election.',
  DEPARTMENT_HEAD: 'You approve elections for your college and read their results.',
  STUDENT: 'Vote while the election is open. Results appear after voting closes and they are released.',
};

export function roleBanner(role) {
  return ROLE_BANNERS[role] ?? ROLE_BANNERS.STUDENT;
}

// The server marks a Department Head rejection with approval_status, or a returned flag; the
// lifecycle reads only approval_status. Both are absent on a payload without them.
export function withApprovalState(election) {
  if (!election || election.approval_status || election.returned !== true) return election;
  return { ...election, approval_status: 'rejected' };
}

// A final rejection (declined_at) is not a return: nothing can be edited and resubmitted.
export function isReturned(election) {
  return election?.status === 'pending_approval' && !election?.declined_at && withApprovalState(election)?.approval_status === 'rejected';
}

// The Admin reaches the voter turnout through the Overview route because the voters route is
// Officer only in App.jsx, while the API already lets the Admin read it.
const WORKSPACE_STEPS = [
  {
    key: 'overview',
    label: 'Overview',
    roles: ['ADMIN'],
    path: () => `${BASE}/manage-elections`,
    isActive: (pathname, view) => pathname.endsWith('/manage-elections') && view !== 'voters',
  },
  {
    key: 'applications',
    label: 'Applications',
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: () => `${BASE}/applications`,
    isActive: (pathname) => pathname.endsWith('/applications'),
    // Only an election where students file their own candidacy has applications to screen.
    shown: (election) => Boolean(election?.filing_starts_at),
  },
  {
    key: 'partylists',
    label: 'Party lists',
    roles: ['ADMIN'],
    path: () => `${BASE}/manage-partylists`,
    isActive: (pathname) => pathname.endsWith('/manage-partylists'),
  },
  {
    key: 'candidates',
    label: 'Candidates',
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: () => `${BASE}/manage-candidates`,
    isActive: (pathname) => pathname.endsWith('/manage-candidates'),
  },
  {
    key: 'voters',
    label: 'Voters',
    roles: ['ADMIN', 'SBO_OFFICER'],
    path: (role) => (role === 'ADMIN' ? `${BASE}/manage-elections` : `${BASE}/manage-voters`),
    params: (role) => (role === 'ADMIN' ? { view: 'voters' } : {}),
    isActive: (pathname, view, role) => (role === 'ADMIN' ? pathname.endsWith('/manage-elections') && view === 'voters' : pathname.endsWith('/manage-voters')),
  },
  {
    key: 'results',
    label: 'Results',
    roles: ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'],
    path: () => `${BASE}/election-results`,
    isActive: (pathname) => pathname.endsWith('/election-results'),
    available: (election, role) => canViewElectionResults(election, role),
    reason: 'Results appear after voting opens on a finalized ballot and they are released.',
  },
];

// Process order: applications are screened before the official list of candidates is read. The strip is
// only worth showing when a role has more than one place to go.
export function workspaceSteps(role, election, pathname = '', view = null) {
  const params = (step) => new URLSearchParams({ record: String(election?.id ?? ''), ...(step.params?.(role) ?? {}) });
  return WORKSPACE_STEPS
    .filter((step) => step.roles.includes(role) && (!step.shown || step.shown(election)))
    .map((step, index) => ({
      key: step.key,
      label: step.label,
      number: index + 1,
      to: `${step.path(role)}?${params(step).toString()}`,
      active: step.isActive(pathname, view, role),
      available: step.available ? step.available(election, role) : true,
      reason: step.reason,
    }));
}

// Mirrors what ElectionController::finalize refuses, so the button can say why before the request.
// A party list is optional, so an all-independent ballot is ready.
export function finalizeChecklist(election) {
  const positions = election?.positions ?? [];
  const candidates = election?.candidates ?? [];
  const withoutCandidates = positions.filter((position) => !candidates.some((candidate) => candidate.position_id === position.id));

  const items = [
    {
      key: 'positions',
      ok: positions.length > 0,
      label: positions.length > 0 ? `Positions on the ballot: ${positions.length}` : 'Positions on the ballot: none yet',
      fix: 'Add a position to the ballot first.',
    },
    {
      key: 'candidates',
      ok: positions.length > 0 && withoutCandidates.length === 0,
      label: `Positions without candidates: ${withoutCandidates.length}`,
      fix: `Add a candidate to ${withoutCandidates.length === 1 ? 'the 1 position' : `each of the ${withoutCandidates.length} positions`} that has none first.`,
    },
  ];
  const blocker = items.find((item) => !item.ok);

  return { items, ready: !blocker, disabledReason: blocker?.fix };
}

const PHASE_CHIPS = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  filing: { label: 'Filing open', tone: 'success' },
  screening: { label: 'Screening', tone: 'info' },
  campaign: { label: 'Campaign', tone: 'info' },
  voting: { label: 'Voting open', tone: 'success' },
  canvassing: { label: 'Canvassing', tone: 'neutral' },
  runoff: { label: 'Runoff voting', tone: 'success' },
  tie_resolution: { label: 'Pending tie resolution', tone: 'warning' },
  completed: { label: 'Completed', tone: 'neutral' },
};

export function electionStatusChip(election) {
  if (election?.cancelled_at || election?.phase === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  if (election?.declined_at) return { label: 'Rejected', tone: 'danger' };
  if (election?.suspended_at) return { label: 'Suspended', tone: 'warning' };
  if (isReturned(election)) return { label: 'Returned', tone: 'danger' };
  if (election?.filing_starts_at && election.status === 'pending_approval' && election.submitted_at === null) return { label: 'Draft', tone: 'neutral' };
  if (PHASE_CHIPS[election?.phase]) return PHASE_CHIPS[election.phase];
  switch (election?.status) {
    case 'pending_approval': return { label: 'Pending approval', tone: 'warning' };
    case 'upcoming': return { label: 'Upcoming', tone: 'info' };
    case 'active': return { label: 'Voting open', tone: 'success' };
    case 'closed': return { label: 'Closed', tone: 'neutral' };
    default: return { label: String(election?.status ?? 'Unknown'), tone: 'neutral' };
  }
}

export function studentVoteState(election, now = Date.now()) {
  // has_voted is the answer now that a ballot no longer lists the voter's choices; older payloads still send my_votes.
  const voted = election?.has_voted !== undefined ? election.has_voted === true : (election?.my_votes ?? []).length > 0;
  if (voted) return { key: 'voted', label: 'Voted' };
  if (isVotingOpen(election)) return { key: 'open', label: 'Open' };
  const end = new Date(election?.end_time).getTime();
  if (election?.status === 'closed' || (Number.isFinite(end) && now > end)) return { key: 'closed', label: 'Closed' };
  return { key: 'upcoming', label: 'Upcoming' };
}

export function resultsLink(election, role) {
  if (canViewElectionResults(election, role)) {
    return { available: true, label: election.status === 'closed' ? 'View results' : 'View turnout', to: `${BASE}/election-results?record=${election.id}` };
  }
  if (election?.status === 'closed') return { available: false, text: 'Available when the Admin releases the results' };
  return { available: false, text: 'Available when voting closes' };
}

const DEADLINES = [
  ['filing_starts_at', 'Filing opens'],
  ['filing_ends_at', 'Filing closes'],
  ['screening_starts_at', 'Screening opens'],
  ['screening_ends_at', 'Screening closes'],
  ['campaign_starts_at', 'Campaign opens'],
  ['campaign_ends_at', 'Campaign closes'],
  ['start_time', 'Voting opens'],
  ['end_time', 'Voting closes'],
  ['results_publish_at', 'Results publish'],
  ['runoff_starts_at', 'Runoff opens'],
  ['runoff_ends_at', 'Runoff closes'],
  ['runoff_publish_at', 'Runoff results publish'],
];

// The first scheduled date that is still ahead, so the Admin sees what is coming next without reading the whole schedule.
export function nextDeadline(election, now = Date.now()) {
  const ahead = DEADLINES
    .map(([field, name]) => ({ name, at: election?.[field] }))
    .filter(({ at }) => at && Date.parse(at) > now)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return ahead[0] ?? null;
}

const UNRESOLVED_RESULTS = ['runoff_required', 'runoff_scheduled', 'runoff_voting', 'tie_pending'];

// Positions the count could not settle yet: a runoff is still to come or the tie waits for the reviewer.
export function unresolvedTies(election) {
  return (election?.positions ?? []).filter((position) => UNRESOLVED_RESULTS.includes(position.result_status)).length;
}
