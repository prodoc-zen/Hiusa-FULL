import { formatDisplayText } from '../../../utils/displayText.js';
import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Lock, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, PageHeader, SkeletonCard, StatusBadge } from '../../../components/ui';
import TableRowActions from '../../../components/TableRowActions';
import ConfirmModal from '../../../components/ConfirmModal';
import notify from '../../../lib/notify';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Meter } from '../../../components/charts';
import PaginationControls from '../../../components/PaginationControls';
import { closeClearancePeriod, deleteClearancePeriod, getClearancePeriods, getClearancePeriodStudents, syncClearancePeriod } from '../../../services/clearanceService';
import { listMeta, unwrapList, fetchAllPages } from '../../../services/pagination';
import { manilaDate } from '../../../lib/format';
import useRecordParam from '../../../lib/useRecordParam';
import CreateClearancePeriodModal from './CreateClearancePeriodModal';
import ClearancePeriodStudentsDrawer from './ClearancePeriodStudentsDrawer';
import EditClearancePeriodDrawer from './EditClearancePeriodDrawer';
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
  const [editTarget, setEditTarget] = useState(null);
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState(null);
  const [syncingId, setSyncingId] = useState(null);
  // Read when the list loads, so a render never depends on the clock.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return getClearancePeriods({ page })
      .then((res) => {
        setPeriods(unwrapList(res.data));
        setLoadedAt(Date.now());
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

  async function syncStudents(period) {
    setSyncingId(period.id);
    try {
      const { data } = await syncClearancePeriod(period.id);
      notify.success(data?.message || 'Students added.');
      setProgress({});
      load();
    } catch (err) {
      notify.error(getApiErrorMessage(err, 'Students could not be added. Try again.'));
    } finally {
      setSyncingId(null);
    }
  }

  async function confirmClose() {
    setCloseBusy(true);
    setCloseError(null);
    try {
      await closeClearancePeriod(closeTarget.id);
      notify.success(`"${closeTarget.title}" closed.`);
      setCloseTarget(null);
      load();
    } catch (err) {
      setCloseError(getApiErrorMessage(err, 'This clearance period could not be closed.'));
    } finally {
      setCloseBusy(false);
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
          description="Open a period to give every active student a signature line for each role you require."
          action={<Button leftIcon={Plus} onClick={() => setCreateOpen(true)}>New clearance period</Button>}
        />
      )}

      {!selectedPeriod && !loading && !error && periods.length > 0 && (
        <div className="flex flex-col gap-3">
          {periods.map((period) => {
            const stats = progress[period.id];
            const closed = Boolean(period.deadline_at) && new Date(period.deadline_at).getTime() <= loadedAt;
            return (
              <Card key={period.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-ink">{formatDisplayText(period.title)}</p>
                    <p className="text-xs text-ink-muted">{period.academic_year} · Deadline {period.deadline_at ? manilaDate(period.deadline_at) : 'not set'}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {closed && <StatusBadge tone="neutral" label="Closed" />}
                      {period.required_roles.map((role) => <StatusBadge key={role} tone="neutral" label={humanizeRole(role)} />)}
                    </div>
                  </div>
                  <div className="w-full lg:w-64 lg:shrink-0">
                    {stats ? (
                      <Meter value={stats.cleared} limit={stats.total} label="Students fully cleared" format={(value) => `${value}`} tone={stats.total > 0 && stats.cleared === stats.total ? 'success' : 'neutral'} />
                    ) : (
                      <p className="text-xs text-ink-muted">Calculating progress</p>
                    )}
                  </div>
                  <TableRowActions subject={formatDisplayText(period.title)} actions={[
                    { label: 'View students', icon: ClipboardCheck, onClick: () => setRecordId(period.id) },
                    { label: 'Add students who joined since', icon: UserPlus, disabled: syncingId === period.id, onClick: () => syncStudents(period) },
                    { label: 'Edit period', icon: Pencil, onClick: () => setEditTarget(period) },
                    ...(closed ? [] : [{ label: 'Close period', icon: Lock, onClick: () => { setCloseError(null); setCloseTarget(period); } }]),
                    { label: 'Delete period', icon: Trash2, danger: true, onClick: () => { setDeleteError(null); setDeleteTarget(period); } },
                  ]} />
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
      <ConfirmModal
        open={Boolean(closeTarget)}
        title="Close this clearance period?"
        message="The deadline moves to now. Signers can still finish the lines already open, but no more students can be added until you set a later deadline."
        recordName={closeTarget?.title}
        confirmText="Close period"
        variant="primary"
        busy={closeBusy}
        error={closeError}
        onCancel={() => setCloseTarget(null)}
        onConfirm={confirmClose}
      />
      <EditClearancePeriodDrawer period={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); setProgress({}); load(); }} />
      <CreateClearancePeriodModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setProgress({}); if (page === 1) load(); else setPage(1); }} />
      {selectedPeriod && <ClearancePeriodStudentsDrawer period={selectedPeriod} onClose={() => setRecordId(null)} onSignatureChanged={() => { setProgress({}); load(); }} />}
    </div>
  );
}
