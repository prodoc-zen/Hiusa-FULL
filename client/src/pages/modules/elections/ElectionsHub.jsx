import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import ElectionBreadcrumb from '../../../components/elections/ElectionBreadcrumb';
import ElectionPickerPage from './ElectionPickerPage';
import CastVoteRedirectPage from './CastVoteRedirectPage';
import { getElectionDetails } from '../../../services/electionService';

export default function ElectionsHub({ startCreateElection = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeElection, setActiveElection] = useState(null);
  const [loading, setLoading] = useState(true);

  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const role = currentUser?.role || 'SBO_OFFICER';
  const selectionKey = `hiusa-election-${currentUser?.organization_id ?? 'organization'}-${currentUser?.school_id ?? 'user'}`;

  const [activeElectionId, setActiveElectionId] = useState(() => sessionStorage.getItem(selectionKey));

  useEffect(() => {
    let cancelled = false;

    async function loadElection() {
      if (!activeElectionId) {
        setActiveElection(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const election = await getElectionDetails(activeElectionId);
        if (!cancelled) {
          setActiveElection(election);
        }
      } catch {
        if (!cancelled) {
          setActiveElection(null);
          sessionStorage.removeItem(selectionKey);
          setActiveElectionId(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadElection();

    return () => {
      cancelled = true;
    };
  }, [activeElectionId, selectionKey]);

  const refreshElection = async () => {
    if (!activeElectionId) return;

    try {
      const election = await getElectionDetails(activeElectionId);
      setActiveElection(election);
    } catch {
      setActiveElection(null);
    }
  };

  const handleSelect = (id) => {
    sessionStorage.setItem(selectionKey, String(id));
    setActiveElectionId(id);
  };

  const handleClear = () => {
    sessionStorage.removeItem(selectionKey);
    setActiveElectionId(null);
    navigate('/dashboard/elections');
  };

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading election workspace">
        <div className="animate-pulse rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="h-4 w-44 rounded bg-slate-200" />
          <div className="mt-3 h-8 w-2/3 rounded bg-slate-200" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-lg border border-[#DDE7EF] bg-slate-100" />)}
        </div>
        <span className="sr-only">Loading election workspace...</span>
      </div>
    );
  }

  if (!activeElection) {
    const askingToVote = location.pathname.endsWith('/cast-vote');
    const askingForResults = location.pathname.endsWith('/election-results');
    if (askingToVote) return <CastVoteRedirectPage />;
    return <div className="space-y-4">{(askingToVote || askingForResults) && <div className="relative overflow-hidden rounded-lg border border-[#DDE7EF] bg-white p-6 text-center"><div aria-hidden="true" className="pointer-events-none h-20 rounded-lg bg-[#EEF6FB] opacity-40 blur-sm" /><div className="absolute inset-0 grid place-items-center bg-white/70 p-4"><div><h2 className="text-lg font-black text-[#0F172A]">{askingToVote ? 'No election is currently open.' : 'Election results are not available yet.'}</h2><p className="mt-1 text-sm text-[#64748B]">{askingToVote ? 'Select an open election when voting begins.' : 'Select an open election with visible live totals or a closed election with released results.'}</p></div></div></div>}<ElectionPickerPage onSelect={handleSelect} startCreate={startCreateElection} /></div>;
  }

  return (
    <div className="space-y-5">
      <ElectionBreadcrumb election={activeElection} onClear={handleClear} />
      <Outlet context={{ election: activeElection, role, refreshElection, selectElection: handleSelect }} />
    </div>
  );
}
