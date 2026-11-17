export function isVotingOpen(election) {
  // The server names the open round (1, 2 or null) once it knows the phase; older payloads fall back to the window.
  if (election?.open_round !== undefined) return election.open_round === 1 || election.open_round === 2;
  const now = Date.now();
  const start = new Date(election?.start_time).getTime();
  const end = new Date(election?.end_time).getTime();
  return election?.status === 'active' && Boolean(election?.finalized_at) && Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
}

// The dean, or the SAO for a university-wide organization, reads a tie waiting for a decision before the results are published.
function awaitsTieDecision(election, role) {
  return ['DEPARTMENT_HEAD', 'SUPER_ADMIN'].includes(role) && election?.status === 'closed' && election?.phase === 'tie_resolution';
}

export function canViewElectionResults(election, role) {
  return ['active', 'closed'].includes(election?.status) && (election?.status === 'closed' || Boolean(election?.finalized_at)) && (role === 'ADMIN' || Boolean(election?.results_visible) || awaitsTieDecision(election, role));
}
