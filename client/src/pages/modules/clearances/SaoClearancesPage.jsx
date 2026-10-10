import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, IconButton, PageHeader, SkeletonCard, StatusBadge } from '../../../components/ui';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Meter } from '../../../components/charts';
import PaginationControls from '../../../components/PaginationControls';
import { deleteClearancePeriod, getClearancePeriods, getClearancePeriodStudents } from '../../../services/clearanceService';
import { listMeta, unwrapList, fetchAllPages } from '../../../services/pagination';
import { manilaDate } from '../../../lib/format';
import useRecordParam from '../../../lib/useRecordParam';
import CreateClearancePeriodModal from './CreateClearancePeriodModal';
import ClearancePeriodStudentsDrawer from './ClearancePeriodStudentsDrawer';
import { humanizeRole } from './clearanceLabels';

export default function SaoClearancesPage() {
  const [periods, setPeriods] = useState([]);
  const [meta, setMeta] = useState({ total: 0, currentPage: 1, lastPage: 1, perPage: 20 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const [recordId, setRecordId] = useRecordParam();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getClearancePeriods({ page })
      .then((res) => {
        setPeriods(unwrapList(res.data));
        setMeta(listMeta(res.data));
      })
      .catch(() => setError('Failed to load clearance periods.'))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { load(); }, [load]);

  // Completion progress has no aggregate endpoint, so each period's full
  // roster is fetched once (paginated at 100/page) and counted client-side.
  useEffect(() => {
    let cancelled = false;
    periods.forEach((period) => {
      if (progress[period.id]) return;
      fetchAllPages((params) => getClearancePeriodStudents(period.id, params).then((res) => res.data), {}, { perPage: 100 })
        .then((rows) => {
          if (cancelled) return;
          const total = rows.length;
          const cleared = rows.filter((row) => row.is_complete).length;
          setProgress((current) => ({ ...current, [period.id]: { total, cleared } }));
        })
        .catch(() => { if (!cancelled) setProgress((current) => ({ ...current, [period.id]: { total: 0, cleared: 0 } })); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods]);

  const selectedPeriod = recordId ? periods.find((period) => String(period.id) === recordId) ?? null : null;

  // A deep link can name a period on a later page, so walk the pages until it turns up.
  useEffect(() => {
    if (!recordId || selectedPeriod || loading || error) return;
    if (page < meta.lastPage) {
      setPage(page + 1);
      return;
    }
    notify.error('That clearance period no longer exists.');
    setRecordId(null);
  }, [recordId, selectedPeriod, loading, error, page, meta.lastPage, setRecordId]);

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteClearancePeriod(deleteTarget.id);
      notify.success(`"${deleteTarget.title}" deleted.`);
      setDeleteTarget(null);
      setProgress({});
      if (page > 1 && periods.length === 1) setPage(page - 1);
      else load();
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, 'This clearance period could not be deleted.'));
    } finally {
      setDeleteBusy(false);
    }
  }

  const firstRun = !loading && !error && periods.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader primary={firstRun ? undefined : <Button leftIcon={Plus} onClick={() => setCreateOpen(true)}>New clearance period</Button>} />

      {loading && (
        <div className="flex flex-col gap-3">
          <SkeletonCard /><SkeletonCard />
        </div>
      )}

      {!loading && error && <ErrorState description={error} onRetry={load} />}

      {firstRun && (
        <EmptyState
          kind="first-run"
          icon={ClipboardCheck}
          title="No clearance periods yet"
          description="Open a clearance period to generate a pending signature line for every active student, for each role you require."
          action={<Button leftIcon={Plus} onClick={() => setCreateOpen(true)}>New clearance period</Button>}
        />
      )}

      {!loading && !error && periods.length > 0 && (
        <div className="flex flex-col gap-3">
          {periods.map((period) => {
            const stats = progress[period.id];
            return (
              <Card key={period.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink">{formatDisplayText(period.title)}</p>
                    <p className="text-xs font-medium text-ink-muted">{period.academic_year} · Deadline {period.deadline_at ? manilaDate(period.deadline_at) : 'not set'}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {period.required_roles.map((role) => <StatusBadge key={role} tone="neutral" label={humanizeRole(role)} />)}
                    </div>
                  </div>
                  <div className="w-full lg:w-64 lg:shrink-0">
                    {stats ? (
                      <Meter value={stats.cleared} limit={stats.total} label="Students fully cleared" format={(value) => `${value}`} tone={stats.total > 0 && stats.cleared === stats.total ? 'success' : 'neutral'} />
                    ) : (
                      <p className="text-xs font-medium text-ink-muted">Calculating progress...</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setRecordId(period.id)}>View students</Button>
                    <IconButton icon={Trash2} label={`Delete ${formatDisplayText(period.title)}`} variant="danger" onClick={() => { setDeleteError(null); setDeleteTarget(period); }} />
                  </div>
                </div>
              </Card>
            );
          })}
          <PaginationControls currentPage={meta.currentPage} totalItems={meta.total} pageSize={meta.perPage} onPageChange={setPage} label="clearance periods" />
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete this clearance period?"
        message="The period and its unsigned clearance rows are removed. This cannot be undone. A period that already has signed entries cannot be deleted."
        recordName={deleteTarget?.title}
        confirmText="Delete period"
        variant="danger"
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
      <CreateClearancePeriodModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setProgress({}); if (page === 1) load(); else setPage(1); }} />
      <ClearancePeriodStudentsDrawer period={selectedPeriod} onClose={() => setRecordId(null)} onSignatureChanged={() => setProgress((current) => { const next = { ...current }; if (selectedPeriod) delete next[selectedPeriod.id]; return next; })} />
    </div>
  );
}
