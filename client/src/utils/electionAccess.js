export function isVotingOpen(election) {
  // The server names the open round (1, 2 or null) once it knows the phase; older payloads fall back to the window.
  if (election?.open_round !== undefined) return election.open_round === 1 || election.open_round === 2;
  const now = Date.now();
  const start = new Date(election?.start_time).getTime();
  const end = new Date(election?.end_time).getTime();
  return election?.status === 'active' && Boolean(election?.finalized_at) && Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
}

export function canViewElectionResults(election, role) {
  return ['active', 'closed'].includes(election?.status) && (election?.status === 'closed' || Boolean(election?.finalized_at)) && (role === 'ADMIN' || Boolean(election?.results_visible));
}
