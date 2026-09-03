import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import ElectionBreadcrumb from '../../../components/elections/ElectionBreadcrumb';
import ElectionPickerPage from './ElectionPickerPage';
import { getElectionDetails } from '../../../services/electionService';

export default function ElectionsHub() {
  const navigate = useNavigate();
  const [activeElection, setActiveElection] = useState(null);
  const [loading, setLoading] = useState(true);

  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const role = currentUser?.role || 'SBO_OFFICER';

  const [activeElectionId, setActiveElectionId] = useState(null);

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
  }, [activeElectionId]);

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
    setActiveElectionId(id);
  };

  const handleClear = () => {
    setActiveElectionId(null);
    navigate('/dashboard/elections');
  };

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading election workspace">
        <div className="animate-pulse rounded-xl border border-[#DDE7EF] bg-white p-5 shadow-sm">
          <div className="h-4 w-44 rounded bg-slate-200" />
          <div className="mt-3 h-8 w-2/3 rounded bg-slate-200" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-[#DDE7EF] bg-slate-100" />)}
        </div>
        <span className="sr-only">Loading election workspace...</span>
      </div>
    );
  }

  if (!activeElection) {
    return <ElectionPickerPage onSelect={handleSelect} />;
  }

  return (
    <div className="space-y-5">
      <ElectionBreadcrumb election={activeElection} onClear={handleClear} />
      <Outlet context={{ election: activeElection, role, refreshElection }} />
    </div>
  );
}
