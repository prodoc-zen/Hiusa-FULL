import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import ElectionBreadcrumb from '../../components/elections/ElectionBreadcrumb';
import ElectionPickerPage from './ElectionPickerPage';
import { getElectionDetails } from '../../services/electionService';

export default function ElectionsHub() {
  const navigate = useNavigate();
  const [activeElection, setActiveElection] = useState(null);
  const [loading, setLoading] = useState(true);

  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const role = currentUser?.role || 'officer';

  const [activeElectionId, setActiveElectionId] = useState(() => {
    const saved = sessionStorage.getItem('activeElectionId');
    return saved ? Number(saved) : null;
  });

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
      } catch (error) {
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
    sessionStorage.setItem('activeElectionId', id);
    setActiveElectionId(id);
  };

  const handleClear = () => {
    sessionStorage.removeItem('activeElectionId');
    setActiveElectionId(null);
    navigate('/dashboard/elections');
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">Loading election workspace...</p>
      </div>
    );
  }

  if (!activeElection) {
    return <ElectionPickerPage onSelect={handleSelect} />;
  }

  return (
    <div className="space-y-5">
      <ElectionBreadcrumb election={activeElection} onClear={handleClear} />
      <div className="mt-5">
        <Outlet context={{ election: activeElection, role, refreshElection }} />
      </div>
    </div>
  );
}
