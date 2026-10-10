import { canViewElectionResults, isVotingOpen } from '../../utils/electionAccess';

const BASE = '/dashboard/elections';

export const ROLE_BANNERS = {
  ADMIN: 'You run this election: build the ballot, finalize it, open voting, and release the results.',
  SBO_OFFICER: 'Manage the candidates and voters. The Admin finalizes the ballot and runs the vote.',
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

export function isReturned(election) {
  return election?.status === 'pending_approval' && withApprovalState(election)?.approval_status === 'rejected';
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

// Process order: party lists come before candidates because finalizing needs a candidate in a party
// list. The strip is only worth showing when a role has more than one place to go.
export function workspaceSteps(role, election, pathname = '', view = null) {
  const params = (step) => new URLSearchParams({ record: String(election?.id ?? ''), ...(step.params?.(role) ?? {}) });
  return WORKSPACE_STEPS
    .filter((step) => step.roles.includes(role))
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
export function finalizeChecklist(election) {
  const positions = election?.positions ?? [];
  const candidates = election?.candidates ?? [];
  const withoutCandidates = positions.filter((position) => !candidates.some((candidate) => candidate.position_id === position.id));
  const partyListed = candidates.filter((candidate) => candidate.partylist_id != null || candidate.partylist).length;

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
    {
      key: 'partylist',
      ok: partyListed > 0,
      label: partyListed > 0 ? `Party list candidates: ${partyListed}` : 'Party list candidates missing',
      fix: 'Assign at least one candidate to a party list first.',
    },
  ];
  const blocker = items.find((item) => !item.ok);

  return { items, ready: !blocker, disabledReason: blocker?.fix };
}

export function electionStatusChip(election) {
  if (isReturned(election)) return { label: 'Returned', tone: 'danger' };
  switch (election?.status) {
    case 'pending_approval': return { label: 'Pending approval', tone: 'warning' };
    case 'upcoming': return { label: 'Upcoming', tone: 'info' };
    case 'active': return { label: 'Voting open', tone: 'success' };
    case 'closed': return { label: 'Closed', tone: 'neutral' };
    default: return { label: String(election?.status ?? 'Unknown'), tone: 'neutral' };
  }
}

export function studentVoteState(election, now = Date.now()) {
  if ((election?.my_votes ?? []).length > 0) return { key: 'voted', label: 'Voted' };
  if (isVotingOpen(election)) return { key: 'open', label: 'Open' };
  const end = new Date(election?.end_time).getTime();
  if (election?.status === 'closed' || (Number.isFinite(end) && now > end)) return { key: 'closed', label: 'Closed' };
  return { key: 'upcoming', label: 'Upcoming' };
}

export function resultsLink(election, role) {
  if (canViewElectionResults(election, role)) {
    return { available: true, label: election.status === 'closed' ? 'View results' : 'View live totals', to: `${BASE}/election-results?record=${election.id}` };
  }
  if (election?.status === 'closed') return { available: false, text: 'Available when the Admin releases the results' };
  return { available: false, text: 'Available when voting closes' };
}
