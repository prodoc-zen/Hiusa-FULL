export function isVotingOpen(election) {
  const now = Date.now();
  const start = new Date(election?.start_time).getTime();
  const end = new Date(election?.end_time).getTime();
  return election?.status === 'active' && Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
}

export function canViewElectionResults(election, role) {
  return election?.status === 'closed' && (role === 'ADMIN' || Boolean(election?.results_visible));
}
