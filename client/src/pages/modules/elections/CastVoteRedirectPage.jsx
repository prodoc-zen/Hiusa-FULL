import { Navigate, useOutletContext } from 'react-router-dom';

export default function CastVoteRedirectPage() {
  const { election } = useOutletContext() || {};

  if (!election) {
    return <div className="rounded-lg border border-dashed border-[#B9CBD8] bg-white p-10 text-center text-sm font-medium text-[#64748B]">Select an active election first to enter secure voting.</div>;
  }

  return <Navigate to={`/elections/${election.id}/vote`} replace />;
}
