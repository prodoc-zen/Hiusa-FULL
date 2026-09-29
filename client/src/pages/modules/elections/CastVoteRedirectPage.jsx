import { Navigate, useOutletContext } from 'react-router-dom';
import { isVotingOpen } from '../../../utils/electionAccess';

export default function CastVoteRedirectPage() {
  const { election } = useOutletContext() || {};

  if (!isVotingOpen(election)) {
    return <div className="relative overflow-hidden rounded-lg border border-[#DDE7EF] bg-white p-8 text-center"><div aria-hidden="true" className="pointer-events-none space-y-3 opacity-30 blur-sm"><div className="h-8 rounded-lg bg-[#DDE7EF]" /><div className="h-24 rounded-lg bg-[#EEF6FB]" /></div><div className="absolute inset-0 grid place-items-center bg-white/65 p-4"><div><h2 className="text-lg font-black text-[#0F172A]">No election is currently open.</h2><p className="mt-2 text-sm text-[#64748B]">Voting becomes available during the approved election period.</p></div></div></div>;
  }

  return <Navigate to={`/elections/${election.id}/vote`} replace />;
}
