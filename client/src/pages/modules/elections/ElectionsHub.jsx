import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import ElectionWorkspaceHeader from '../../../components/elections/ElectionWorkspaceHeader';
import { SkeletonTable } from '../../../components/ui/Skeleton';
import ErrorState from '../../../components/ui/ErrorState';
import ElectionPickerPage from './ElectionPickerPage';
import CastVoteRedirectPage from './CastVoteRedirectPage';
import { getElectionDetails } from '../../../services/electionService';
import useRecordParam from '../../../lib/useRecordParam';
import notify from '../../../lib/notify';

// The picker is the same list for every election screen, so it is told which screen the user asked
// for. Only the Elections screen manages elections.
function pickerMode(pathname) {
  if (pathname.endsWith('/manage-candidates')) return 'candidates';
  if (pathname.endsWith('/manage-partylists')) return 'partylists';
  if (pathname.endsWith('/manage-voters')) return 'voters';
  if (pathname.endsWith('/election-results')) return 'results';
  return 'manage';
}

export default function ElectionsHub({ startCreateElection = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [recordId, setRecordId] = useRecordParam();
  const [activeElection, setActiveElection] = useState(null);
  const [loading, setLoading] = useState(true);

  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('user')); } catch {}
  const role = currentUser?.role || 'SBO_OFFICER';
  const selectionKey = `hiusa-election-${currentUser?.organization_id ?? 'organization'}-${currentUser?.school_id ?? 'user'}`;
  const askingToVote = location.pathname.endsWith('/cast-vote');

  // Links made before the election moved into the URL carry no record, so the last selection in this
  // browser tab stands in for it once, and is then written to the URL.
  const [fallbackId, setFallbackId] = useState(() => sessionStorage.getItem(selectionKey) || sessionStorage.getItem('activeElectionId'));
  const [failedId, setFailedId] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const editElectionId = searchParams.get('edit');
  const showingPicker = Boolean(editElectionId) || startCreateElection;
  const activeElectionId = recordId ?? (showingPicker ? null : fallbackId);

  useEffect(() => {
    if (recordId || !fallbackId || askingToVote || showingPicker) return;
    const next = new URLSearchParams(searchParams);
    next.set('record', fallbackId);
    setSearchParams(next, { replace: true });
  }, [askingToVote, fallbackId, recordId, searchParams, setSearchParams, showingPicker]);

  const forgetSelection = useCallback(() => {
    sessionStorage.removeItem(selectionKey);
    sessionStorage.removeItem('activeElectionId');
    setFallbackId(null);
  }, [selectionKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadElection() {
      if (!activeElectionId || askingToVote) {
        setActiveElection(null);
        setLoadFailed(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadFailed(false);
      try {
        const election = await getElectionDetails(activeElectionId);
        if (!cancelled) {
          setActiveElection(election);
        }
      } catch (error) {
        if (!cancelled) {
          setActiveElection(null);
          // Only an election that is gone or off limits is forgotten; any other failure keeps the selection so Try again can reload it.
          if ([403, 404].includes(error?.response?.status)) {
            forgetSelection();
            setFailedId(activeElectionId);
          } else {
            setLoadFailed(true);
          }
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
  }, [activeElectionId, askingToVote, forgetSelection, reloadKey]);

  useEffect(() => {
    if (failedId && recordId === failedId) {
      setFailedId(null);
      setRecordId(null);
    }
  }, [failedId, recordId, setRecordId]);

  const refreshElection = async () => {
    if (!activeElectionId) return;

    try {
      const election = await getElectionDetails(activeElectionId);
      setActiveElection(election);
    } catch {
      notify.error('Could not refresh this election. You are seeing the last version that loaded.');
    }
  };

  const handleSelect = (id) => {
    sessionStorage.setItem(selectionKey, String(id));
    sessionStorage.setItem('activeElectionId', String(id));
    setFallbackId(String(id));
    setRecordId(id);
  };

  const handleClear = () => {
    forgetSelection();
    navigate('/dashboard/elections');
  };

  const handleEditClosed = (updated) => {
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    if (updated?.id) {
      sessionStorage.setItem(selectionKey, String(updated.id));
      setFallbackId(String(updated.id));
      next.set('record', String(updated.id));
    }
    setSearchParams(next, { replace: true });
  };

  if (askingToVote) {
    if (role === 'DEPARTMENT_HEAD') return <Navigate to="/dashboard/elections/election-results" replace />;
    return <CastVoteRedirectPage />;
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading election workspace">
        <SkeletonTable columns={4} rows={5} />
        <span className="sr-only">Loading election workspace</span>
      </div>
    );
  }

  if (loadFailed) {
    return <ErrorState title="Could not load this election" description="Check your connection and try again. Your selected election is kept." onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  if (!activeElection) {
    return <ElectionPickerPage mode={pickerMode(location.pathname)} onSelect={handleSelect} startCreate={startCreateElection} editElectionId={editElectionId} onEditClosed={handleEditClosed} />;
  }

  return (
    <div className="space-y-5">
      <ElectionWorkspaceHeader election={activeElection} role={role} onClear={handleClear} onChanged={refreshElection} />
      <Outlet context={{ election: activeElection, role, refreshElection, selectElection: handleSelect }} />
    </div>
  );
}
